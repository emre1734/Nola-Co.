/**
 * Native-aware geolocation helper.
 *
 * On Capacitor native Android/iOS this uses @capacitor/geolocation, which
 * correctly requests and checks OS-level location permissions before
 * reading GPS. On regular web browsers it delegates to the standard
 * navigator.geolocation API so existing web behavior is unchanged.
 *
 * The public functions mirror the small subset of the W3C Geolocation
 * API the app already uses (getCurrentPosition / watchPosition), so
 * callers can swap `navigator.geolocation` for this module with no other
 * changes.
 */

import { Capacitor } from '@capacitor/core';
import { Geolocation, type PermissionStatus } from '@capacitor/geolocation';

export interface GpsCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
}

export interface GpsPosition {
  coords: GpsCoordinates;
  timestamp: number;
}

export interface GpsOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export type GpsSuccessCallback = (pos: GpsPosition) => void;
export type GpsErrorCallback = (err: { code: number; message: string }) => void;

const GPS_ERR_PERMISSION_DENIED = 1;
const GPS_ERR_POSITION_UNAVAILABLE = 2;
const GPS_ERR_TIMEOUT = 3;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Ensure location permission is granted on native platforms. On web this
 * is a no-op — the browser prompts automatically on getCurrentPosition.
 * Returns true if permission is granted (or already granted), false
 * otherwise. When false, the supplied error callback is invoked with a
 * PERMISSION_DENIED error code so callers behave exactly as they do on
 * the web when the user denies the browser prompt.
 */
async function ensureNativePermission(
  onError: GpsErrorCallback,
): Promise<boolean> {
  if (!isNativePlatform()) return true;

  let status: PermissionStatus;
  try {
    status = await Geolocation.checkPermissions();
  } catch {
    // checkPermissions can throw on older Capacitor versions; fall
    // through to requestPermissions which is the authoritative path.
    status = { location: 'prompt', coarseLocation: 'prompt' } as PermissionStatus;
  }

  if (status.location === 'granted') {
    return true;
  }

  // If only coarse/approximate location is granted, or any permission is
  // still promptable, request both permissions so the user can upgrade to
  // precise/fine location. Coarse-only is NOT sufficient for live tracking.
  if (status.location === 'prompt' || status.location === 'prompt-with-rationale'
      || status.coarseLocation === 'prompt' || status.coarseLocation === 'prompt-with-rationale'
      || status.coarseLocation === 'granted') {
    try {
      status = await Geolocation.requestPermissions({
        permissions: ['location', 'coarseLocation'],
      });
    } catch {
      onError({ code: GPS_ERR_PERMISSION_DENIED, message: 'Location permission request failed' });
      return false;
    }
  }

  if (status.location === 'granted') {
    return true;
  }

  if (status.coarseLocation === 'granted') {
    onError({ code: GPS_ERR_PERMISSION_DENIED, message: 'Precise location permission is required for accurate live tracking. Please grant precise location in Settings.' });
    return false;
  }

  onError({ code: GPS_ERR_PERMISSION_DENIED, message: 'Location permission denied' });
  return false;
}

function toGpsPosition(lat: number, lng: number, acc: number | null, ts: number): GpsPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: acc,
      altitude: null,
      heading: null,
      speed: null,
    },
    timestamp: ts,
  };
}

/**
 * Get the current GPS position once.
 *
 * On native: requests OS permission if needed, then reads GPS via
 * @capacitor/geolocation.
 * On web: delegates to navigator.geolocation.getCurrentPosition with the
 * same success/error/options semantics the app already relied on.
 */
export function getCurrentPosition(
  onSuccess: GpsSuccessCallback,
  onError: GpsErrorCallback,
  options: GpsOptions = {},
): void {
  if (!isNativePlatform()) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError({ code: GPS_ERR_POSITION_UNAVAILABLE, message: 'Geolocation not supported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        onSuccess(
          toGpsPosition(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy ?? null,
            pos.timestamp,
          ),
        ),
      (err) => onError({ code: err.code, message: err.message }),
      {
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 10000,
        maximumAge: options.maximumAge ?? 0,
      },
    );
    return;
  }

  ensureNativePermission(onError).then((granted) => {
    if (!granted) return;
    Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: options.timeout ?? 10000, maximumAge: options.maximumAge ?? 0 })
      .then((pos) => {
        onSuccess(
          toGpsPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null, pos.timestamp),
        );
      })
      .catch((err: unknown) => {
        const e = err as { code?: string; message?: string };
        const message = e?.message ?? 'Geolocation error';
        let code = GPS_ERR_POSITION_UNAVAILABLE;
        if (/denied|permission/i.test(message)) code = GPS_ERR_PERMISSION_DENIED;
        else if (/timeout/i.test(message)) code = GPS_ERR_TIMEOUT;
        onError({ code, message });
      });
  });
}

/**
 * Watch the GPS position for live updates. Returns a watch id (number on
 * web, string on native) that can be passed to clearWatch.
 *
 * On native: requests OS permission if needed, then uses Capacitor
 * Geolocation.watchPosition for efficient native live updates.
 * On web: delegates to navigator.geolocation.watchPosition.
 */
export async function watchPosition(
  onSuccess: GpsSuccessCallback,
  onError: GpsErrorCallback,
  options: GpsOptions = {},
): Promise<string | number | null> {
  if (!isNativePlatform()) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError({ code: GPS_ERR_POSITION_UNAVAILABLE, message: 'Geolocation not supported' });
      return null;
    }
    return navigator.geolocation.watchPosition(
      (pos) =>
        onSuccess(
          toGpsPosition(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy ?? null,
            pos.timestamp,
          ),
        ),
      (err) => onError({ code: err.code, message: err.message }),
      {
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 10000,
        maximumAge: options.maximumAge ?? 0,
      },
    );
  }

  const granted = await ensureNativePermission(onError);
  if (!granted) return null;

  try {
    const watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: options.timeout ?? 10000, maximumAge: options.maximumAge ?? 0 },
      (pos, err) => {
        if (err) {
          onError({ code: GPS_ERR_POSITION_UNAVAILABLE, message: err.message ?? 'Geolocation error' });
          return;
        }
        if (pos) {
          onSuccess(
            toGpsPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null, pos.timestamp),
          );
        }
      },
    );
    return watchId;
  } catch (err: unknown) {
    const e = err as { message?: string };
    onError({ code: GPS_ERR_POSITION_UNAVAILABLE, message: e?.message ?? 'watchPosition failed' });
    return null;
  }
}

/**
 * Clear a previously registered position watch.
 */
export async function clearWatch(watchId: string | number | null): Promise<void> {
  if (watchId == null) return;
  if (!isNativePlatform()) {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId as number);
    }
    return;
  }
  try {
    await Geolocation.clearWatch({ id: String(watchId) });
  } catch {
    // non-fatal
  }
}
