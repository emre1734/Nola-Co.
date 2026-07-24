/**
 * Minimal Google Maps JavaScript API type declarations.
 * Only covers the APIs used by WishWash.
 */

export declare namespace google {
  namespace maps {
    class Map {
      constructor(el: HTMLElement, opts: MapOptions);
      setCenter(latlng: LatLng | LatLngLiteral): void;
      getCenter(): LatLng;
      setZoom(zoom: number): void;
      getZoom(): number;
      panTo(latlng: LatLng | LatLngLiteral): void;
      fitBounds(bounds: LatLngBounds | LatLngBoundsLiteral, padding?: number): void;
      addListener(eventName: string, handler: (...args: any[]) => void): void;
      setOptions(opts: MapOptions): void;
    }

    interface MapOptions {
      center?: LatLng | LatLngLiteral;
      zoom?: number;
      mapTypeId?: string;
      disableDefaultUI?: boolean;
      zoomControl?: boolean;
      mapTypeControl?: boolean;
      scaleControl?: boolean;
      streetViewControl?: boolean;
      rotateControl?: boolean;
      fullscreenControl?: boolean;
      styles?: MapStyle[];
      gestureHandling?: string;
      clickableIcons?: boolean;
    }

    interface LatLng {
      lat(): number;
      lng(): number;
    }

    interface LatLngLiteral {
      lat: number;
      lng: number;
    }

    class Marker {
      constructor(opts: MarkerOptions);
      setPosition(latlng: LatLng | LatLngLiteral): void;
      getPosition(): LatLng | null;
      setMap(map: Map | null): void;
      addListener(eventName: string, handler: (...args: any[]) => void): void;
      setIcon(icon: string | Icon | null): void;
      setTitle(title: string): void;
    }

    interface MarkerOptions {
      map?: Map;
      position?: LatLng | LatLngLiteral;
      title?: string;
      icon?: string | Icon | null;
      draggable?: boolean;
      animation?: number;
    }

    interface Icon {
      url?: string;
      scaledSize?: Size;
      origin?: Point;
      anchor?: Point;
    }

    class Size {
      constructor(width: number, height: number, widthUnit?: string, heightUnit?: string);
    }

    class Point {
      constructor(x: number, y: number);
    }

    class Circle {
      constructor(opts: CircleOptions);
      setCenter(latlng: LatLng | LatLngLiteral): void;
      setRadius(radius: number): void;
      setMap(map: Map | null): void;
    }

    interface CircleOptions {
      map?: Map;
      center?: LatLng | LatLngLiteral;
      radius?: number;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeWeight?: number;
      fillColor?: string;
      fillOpacity?: number;
    }

    class LatLngBounds {
      constructor(sw?: LatLng | LatLngLiteral, ne?: LatLng | LatLngLiteral);
      extend(latlng: LatLng | LatLngLiteral): void;
    }

    type LatLngBoundsLiteral = LatLngBounds;

    class Geocoder {
      geocode(
        request: GeocoderRequest,
        callback: (results: GeocoderResult[] | null, status: string) => void,
      ): void;
    }

    interface GeocoderRequest {
      location?: LatLng | LatLngLiteral;
      address?: string;
    }

    interface GeocoderResult {
      formatted_address: string;
      address_components: GeocoderAddressComponent[];
      geometry: {
        location: LatLng;
        location_type: string;
        viewport: LatLngBounds;
      };
    }

    interface GeocoderAddressComponent {
      long_name: string;
      short_name: string;
      types: string[];
    }

    interface MapStyle {
      featureType?: string;
      elementType?: string;
      stylers: Record<string, string | number>[];
    }

    const Animation: {
      BOUNCE: number;
      DROP: number;
    };

    const MapTypeId: {
      ROADMAP: string;
      SATELLITE: string;
      HYBRID: string;
      TERRAIN: string;
    };

    // Directions API (future: route drawing, ETA calculation)
    class DirectionsService {
      route(
        request: DirectionsRequest,
        callback: (result: DirectionsResult | null, status: string) => void,
      ): void;
    }

    class DirectionsRenderer {
      constructor(opts?: { map?: Map });
      setMap(map: Map | null): void;
      setDirections(result: DirectionsResult): void;
      setOptions(opts: { polylineOptions?: any; suppressMarkers?: boolean }): void;
    }

    interface DirectionsRequest {
      origin: LatLng | LatLngLiteral | string;
      destination: LatLng | LatLngLiteral | string;
      travelMode?: string;
    }

    interface DirectionsResult {
      routes: DirectionsRoute[];
    }

    interface DirectionsRoute {
      legs: DirectionsLeg[];
      overview_polyline: { points: string };
    }

    interface DirectionsLeg {
      distance: { text: string; value: number };
      duration: { text: string; value: number };
      start_location: LatLng;
      end_location: LatLng;
      steps: DirectionsStep[];
    }

    interface DirectionsStep {
      instructions: string;
      distance: { text: string; value: number };
      duration: { text: string; value: number };
      start_location: LatLng;
      end_location: LatLng;
      polyline: { points: string };
    }

    // Places API (future: nearby search, place autocomplete)
    class PlacesService {
      constructor(attrContainer: Map);
      nearbySearch(
        request: PlacesSearchRequest,
        callback: (results: PlacesResult[] | null, status: string) => void,
      ): void;
    }

    interface PlacesSearchRequest {
      location?: LatLng | LatLngLiteral;
      radius?: number;
      type?: string;
      keyword?: string;
    }

    interface PlacesResult {
      place_id: string;
      name: string;
      geometry: { location: LatLng };
      vicinity: string;
      rating?: number;
    }

    const TravelMode: {
      DRIVING: string;
      WALKING: string;
      BICYCLING: string;
      TRANSIT: string;
    };
  }
}
