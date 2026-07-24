import { useState, useEffect, useRef, useCallback } from 'react';
import { loadGoogleMaps, type LatLng } from '../lib/google-maps';

export type MapsLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface UseGoogleMapsResult {
  status: MapsLoadState;
  error: string | null;
  /** Ref callback — attach to the container div where the map should render */
  attachMap: (node: HTMLDivElement | null) => void;
  /** The google.maps.Map instance once ready */
  map: google.maps.Map | null;
  /** The google namespace once loaded */
  google: typeof google | null;
}

const DEFAULT_CENTER: LatLng = { lat: 39.9334, lng: 32.8597 };
const DEFAULT_ZOOM = 14;

/**
 * Lazily loads the Google Maps JS API and renders a map into a container div.
 * The API script is only injected when this hook is first mounted.
 */
export function useGoogleMaps(
  initialCenter?: LatLng,
  initialZoom?: number,
): UseGoogleMapsResult {
  const [status, setStatus] = useState<MapsLoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [googleNs, setGoogleNs] = useState<typeof google | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const initMap = useCallback(
    async (container: HTMLDivElement) => {
      setStatus('loading');
      try {
        const g = await loadGoogleMaps();
        setGoogleNs(g);
        const mapInstance = new g.maps.Map(container, {
          center: initialCenter ?? DEFAULT_CENTER,
          zoom: initialZoom ?? DEFAULT_ZOOM,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          rotateControl: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          clickableIcons: false,
          styles: getDarkMapStyles(),
        });
        setMap(mapInstance);
        setStatus('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Google Maps');
        setStatus('error');
      }
    },
    [initialCenter, initialZoom],
  );

  // Ref callback — called by React when the container div mounts
  const attachMap = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) {
        containerRef.current = null;
        return;
      }
      if (containerRef.current === node) return; // already initialized
      containerRef.current = node;
      // Always initialize if we don't have a map instance yet
      if (!map) {
        initMap(node);
      }
    },
    [map, initMap],
  );

  useEffect(() => {
    return () => {
      setMap(null);
      setGoogleNs(null);
    };
  }, []);

  return { status, error, attachMap, map, google: googleNs };
}

/**
 * Dark theme map styles matching WishWash's dark UI.
 */
function getDarkMapStyles(): google.maps.MapStyle[] {
  return [
    { elementType: 'geometry', stylers: [{ color: '#1a1f2e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1f2e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#7c8a99' }] },
    {
      featureType: 'administrative.locality',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#9ca3af' }],
    },
    {
      featureType: 'poi',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#6b7280' }],
    },
    {
      featureType: 'poi.park',
      elementType: 'geometry',
      stylers: [{ color: '#1e2a1e' }],
    },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#2a3142' }],
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry',
      stylers: [{ color: '#3a4258' }],
    },
    {
      featureType: 'transit',
      elementType: 'geometry',
      stylers: [{ color: '#2a3142' }],
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#0f1929' }],
    },
    {
      featureType: 'water',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#3a4258' }],
    },
  ];
}
