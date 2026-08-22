import React, { createContext, useContext, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { getCurrentPosition } from '../lib/native-gps';

export type LocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'error';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

interface LocationContextValue {
  status: LocationStatus;
  coordinates: Coordinates | null;
  error: string | null;
  /** Request GPS permission and retrieve current position */
  requestLocation: () => Promise<void>;
  /** Save coordinates to the user's profile in Supabase */
  saveLocation: (coords: Coordinates) => Promise<{ error: string | null }>;
  /** Manually set coordinates (manual selection fallback) */
  setManualLocation: (coords: Coordinates) => void;
  /** Reset back to idle */
  reset: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

const GEOCODE_TIMEOUT_MS = 12000;

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { session, profile, refreshProfile } = useAuth();
  const { t } = useTranslation();
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track whether a fresh runtime GPS position has been acquired this
  // session. Once true, stale profile/database coordinates must never
  // overwrite the live device position.
  const runtimeGpsAcquiredRef = React.useRef(false);

  const requestLocation = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('error');
      setError(t('locationCtx.errUnsupported'));
      return;
    }

    setStatus('requesting');
    setError(null);

    getCurrentPosition(
      (position) => {
        const coords: Coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        runtimeGpsAcquiredRef.current = true;
        console.log('LOCATION_CONTEXT_GPS_RECEIVED', JSON.stringify({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        }));
        setCoordinates(coords);
        console.log('LOCATION_CONTEXT_STATE_SET', JSON.stringify({
          latitude: coords.latitude,
          longitude: coords.longitude,
          source: 'runtime_gps',
        }));
        setStatus('granted');
        setError(null);
      },
      (err) => {
        if (err.code === 1) {
          setStatus('denied');
          setError(t('locationCtx.errDenied'));
        } else if (err.code === 2) {
          setStatus('error');
          setError(t('locationCtx.errUnavailable'));
        } else if (err.code === 3) {
          setStatus('error');
          setError(t('locationCtx.errTimeout'));
        } else {
          setStatus('error');
          setError(t('locationCtx.errUnknown'));
        }
      },
      { enableHighAccuracy: true, timeout: GEOCODE_TIMEOUT_MS, maximumAge: 0 },
    );
  }, []);

  const saveLocation = useCallback(
    async (coords: Coordinates): Promise<{ error: string | null }> => {
      if (!session) return { error: 'common.notAuthenticated' };
      const { error: dbError } = await supabase
        .from('profiles')
        .update({
          latitude: coords.latitude,
          longitude: coords.longitude,
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.user.id);
      if (dbError) return { error: dbError.message };
      await refreshProfile();
      return { error: null };
    },
    [session, refreshProfile],
  );

  const setManualLocation = useCallback((coords: Coordinates) => {
    console.log('LOCATION_CONTEXT_STATE_OVERWRITE_ATTEMPT', JSON.stringify({
      source: 'manual',
      latitude: coords.latitude,
      longitude: coords.longitude,
      runtimeGpsAlreadyAcquired: runtimeGpsAcquiredRef.current,
    }));
    setCoordinates(coords);
    setStatus('granted');
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setCoordinates(null);
    setError(null);
  }, []);

  // Sync from profile on mount / profile change — but only as initial
  // fallback hydration BEFORE a real runtime GPS position has been
  // acquired. Once fresh device GPS is obtained, stale profile/database
  // coordinates must never overwrite it.
  React.useEffect(() => {
    if (runtimeGpsAcquiredRef.current) {
      console.log('GPS_PROFILE_FALLBACK_SKIPPED');
      return;
    }
    if (profile?.latitude != null && profile?.longitude != null) {
      console.log('LOCATION_CONTEXT_STATE_OVERWRITE_ATTEMPT', JSON.stringify({
        source: 'profile_fallback',
        latitude: profile.latitude,
        longitude: profile.longitude,
        runtimeGpsAlreadyAcquired: runtimeGpsAcquiredRef.current,
      }));
      setCoordinates({ latitude: profile.latitude, longitude: profile.longitude });
      console.log('LOCATION_CONTEXT_STATE_SET', JSON.stringify({
        latitude: profile.latitude,
        longitude: profile.longitude,
        source: 'profile_fallback',
      }));
      setStatus('granted');
    }
  }, [profile?.latitude, profile?.longitude]);

  return (
    <LocationContext.Provider
      value={{ status, coordinates, error, requestLocation, saveLocation, setManualLocation, reset }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used within LocationProvider');
  return ctx;
}
