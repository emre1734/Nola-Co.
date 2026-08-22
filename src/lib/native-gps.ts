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
  const native = isNativePlatform();
  console.log('GPS_GET_CURRENT_SOURCE', JSON.stringify({
    platform: Capacitor.getPlatform(),
    isNativePlatform: native,
    source: native ? 'CAPACITOR_NATIVE' : 'WEB_NAVIGATOR',
  }));

  if (!native) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError({ code: GPS_ERR_POSITION_UNAVAILABLE, message: 'Geolocation not supported' });
      return;
    }
    const webOpts = {
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      timeout: options.timeout ?? 10000,
      maximumAge: options.maximumAge ?? 0,
    };
    console.log('GPS_NATIVE_GET_CURRENT_OPTIONS', JSON.stringify(webOpts));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.log('GPS_NATIVE_RAW_POSITION', JSON.stringify({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          timestamp: pos.timestamp,
          ageMs: Date.now() - pos.timestamp,
        }));
        const wrapped = toGpsPosition(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy ?? null,
          pos.timestamp,
        );
        console.log('GPS_WRAPPER_RETURN_POSITION', JSON.stringify({
          latitude: wrapped.coords.latitude,
          longitude: wrapped.coords.longitude,
          accuracy: wrapped.coords.accuracy,
          timestamp: wrapped.timestamp,
        }));
        onSuccess(wrapped);
      },
      (err) => onError({ code: err.code, message: err.message }),
      webOpts,
    );
    return;
  }

  ensureNativePermission(onError).then((granted) => {
    if (!granted) return;
    const nativeOpts = { enableHighAccuracy: true, timeout: options.timeout ?? 10000, maximumAge: options.maximumAge ?? 0 };
    console.log('GPS_NATIVE_GET_CURRENT_OPTIONS', JSON.stringify(nativeOpts));
    Geolocation.getCurrentPosition(nativeOpts)
      .then((pos) => {
        console.log('GPS_NATIVE_RAW_POSITION', JSON.stringify({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          timestamp: pos.timestamp,
          ageMs: Date.now() - pos.timestamp,
        }));
        const wrapped = toGpsPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null, pos.timestamp);
        console.log('GPS_WRAPPER_RETURN_POSITION', JSON.stringify({
          latitude: wrapped.coords.latitude,
          longitude: wrapped.coords.longitude,
          accuracy: wrapped.coords.accuracy,
          timestamp: wrapped.timestamp,
        }));
        onSuccess(wrapped);
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

  // Diagnostic: capture the exact permission state immediately before
  // starting the native watcher.
  let permState: { location: string; coarseLocation: string } = { location: 'unknown', coarseLocation: 'unknown' };
  try {
    const ps = await Geolocation.checkPermissions();
    permState = { location: ps.location ?? 'unknown', coarseLocation: ps.coarseLocation ?? 'unknown' };
  } catch {
    // checkPermissions may throw on older Capacitor versions
  }
  console.log('GPS_NATIVE_WATCH_PERMISSION_STATE', JSON.stringify(permState));

  const watchOptions = {
    enableHighAccuracy: true,
    timeout: options.timeout ?? 15000,
    maximumAge: options.maximumAge ?? 0,
    interval: 5000,
    minimumUpdateInterval: 5000,
  };
  console.log('GPS_NATIVE_WATCH_OPTIONS', JSON.stringify(watchOptions));

  try {
    const watchId = await Geolocation.watchPosition(
      watchOptions,
      (pos, err) => {
        if (err) {
          const errObj = err as { code?: string | number; message?: string; name?: string };
          console.log('GPS_NATIVE_WATCH_ERROR_DETAIL', JSON.stringify({
            code: errObj?.code ?? null,
            message: errObj?.message ?? null,
            name: errObj?.name ?? null,
            rawString: String(err),
            jsonString: (() => { try { return JSON.stringify(err); } catch { return null; } })(),
          }));
          onError({ code: GPS_ERR_POSITION_UNAVAILABLE, message: errObj?.message ?? 'Geolocation error' });
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
    const errObj = err as { code?: string | number; message?: string; name?: string };
    console.log('GPS_NATIVE_WATCH_ERROR_DETAIL', JSON.stringify({
      code: errObj?.code ?? null,
      message: errObj?.message ?? null,
      name: errObj?.name ?? null,
      rawString: String(err),
      jsonString: (() => { try { return JSON.stringify(err); } catch { return null; } })(),
    }));
    onError({ code: GPS_ERR_POSITION_UNAVAILABLE, message: errObj?.message ?? 'watchPosition failed' });
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
