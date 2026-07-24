/**
 * Google Maps JavaScript API loader, types, and geocoding helpers.
 * The API is loaded lazily — only when a map component mounts.
 * The API key is fetched at runtime from a Supabase Edge Function
 * that reads the GOOGLE_MAPS_API_KEY project secret.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ReverseGeocodeResult {
  street: string | null;
  district: string | null;
  city: string | null;
  fullAddress: string;
}

// Minimal Google Maps JS API type declarations
declare global {
  interface Window {
    google?: typeof google;
  }
}

let loadPromise: Promise<typeof google> | null = null;
let cachedApiKey: string | null = null;

/**
 * Fetch the Google Maps API key from the Supabase Edge Function at runtime.
 * The key is stored as a project secret and is not available in the Vite
 * build environment — only inside Edge Functions via Deno.env.get().
 */
async function fetchApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL or anon key is not configured');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/google-maps-key`, {
    headers: {
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch Google Maps API key (${res.status}): ${body}`);
  }

  const data = await res.json();
  if (!data.apiKey) {
    throw new Error('Google Maps API key not found in edge function response');
  }

  cachedApiKey = data.apiKey as string;
  return cachedApiKey;
}

/**
 * Lazily load the Google Maps JavaScript API.
 * Returns a cached promise so the script is only injected once.
 */
export async function loadGoogleMaps(): Promise<typeof google> {
  if (loadPromise) return loadPromise;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Google Maps can only be loaded in a browser environment');
  }
  if (window.google?.maps) {
    loadPromise = Promise.resolve(window.google);
    return loadPromise;
  }

  let apiKey: string;
  try {
    apiKey = await fetchApiKey();
  } catch (err) {
    loadPromise = null;
    throw err;
  }
  if (!apiKey) {
    throw new Error('Google Maps API key is missing');
  }

  loadPromise = new Promise<typeof google>((resolve, reject) => {
    // Use a JSONP-style callback to guarantee the API is fully initialized
    // before resolving. The script's onload fires before google.maps is ready
    // when loading=async is used, so we rely on an explicit callback instead.
    const callbackName = '__gmaps_init_cb_' + Date.now();
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      if (window.google?.maps) {
        resolve(window.google);
      } else {
        reject(new Error('Google Maps script loaded but google.maps is undefined'));
      }
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&libraries=marker,places&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete (window as any)[callbackName];
      reject(new Error('Failed to load Google Maps script — check network or API restrictions'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Reverse geocode coordinates into street, district, city.
 * Uses the Google Maps Geocoder if available, falls back to Nominatim.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  try {
    const g = await loadGoogleMaps();
    const geocoder = new g.maps.Geocoder();
    return await new Promise<ReverseGeocodeResult>((resolve, reject) => {
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status !== 'OK' || !results || results.length === 0) {
          reject(new Error('Geocoder failed: ' + status));
          return;
        }
        resolve(parseGeocoderResults(results));
      });
    });
  } catch {
    // Fallback to Nominatim (OpenStreetMap) if Google Maps fails
    return await reverseGeocodeNominatim(lat, lng);
  }
}

function parseGeocoderResults(
  results: google.maps.GeocoderResult[],
): ReverseGeocodeResult {
  const r = results[0];
  let street: string | null = null;
  let district: string | null = null;
  let city: string | null = null;

  for (const comp of r.address_components) {
    const types = comp.types;
    if (types.includes('route') || types.includes('street_address')) {
      street = comp.long_name;
    }
    if (types.includes('sublocality') || types.includes('sublocality_level_1') || types.includes('neighborhood')) {
      district = comp.long_name;
    }
    if (types.includes('locality') || types.includes('administrative_area_level_2')) {
      if (!city) city = comp.long_name;
    }
  }

  return {
    street,
    district,
    city,
    fullAddress: r.formatted_address,
  };
}

async function reverseGeocodeNominatim(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
    { headers: { 'Accept-Language': 'en' } },
  );
  if (!res.ok) throw new Error('Reverse geocoding failed');
  const data = await res.json();
  const a = data.address ?? {};
  return {
    street: a.road ?? a.pedestrian ?? a.path ?? null,
    district: a.suburb ?? a.neighbourhood ?? a.city_district ?? null,
    city: a.city ?? a.town ?? a.village ?? a.county ?? null,
    fullAddress: data.display_name ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
  };
}

/**
 * Forward geocode an address string into coordinates.
 */
export async function forwardGeocode(query: string): Promise<LatLng | null> {
  try {
    const g = await loadGoogleMaps();
    const geocoder = new g.maps.Geocoder();
    return await new Promise<LatLng | null>((resolve, reject) => {
      geocoder.geocode({ address: query }, (results, status) => {
        if (status !== 'OK' || !results || results.length === 0) {
          resolve(null);
          return;
        }
        const loc = results[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng() });
      });
    });
  } catch {
    // Fallback to Nominatim
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } },
    );
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  }
}

/**
 * Calculate the Haversine distance between two coordinates in meters.
 * Prepared for future nearby-washer matching.
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
