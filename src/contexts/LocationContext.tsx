import React, { createContext, useContext, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useTranslation } from '../i18n/useTranslation';

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

  const requestLocation = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('error');
      setError(t('locationCtx.errUnsupported'));
      return;
    }

    setStatus('requesting');
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords: Coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCoordinates(coords);
        setStatus('granted');
        setError(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          setError(t('locationCtx.errDenied'));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setStatus('error');
          setError(t('locationCtx.errUnavailable'));
        } else if (err.code === err.TIMEOUT) {
          setStatus('error');
          setError(t('locationCtx.errTimeout'));
        } else {
          setStatus('error');
          setError(t('locationCtx.errUnknown'));
        }
      },
      { enableHighAccuracy: true, timeout: GEOCODE_TIMEOUT_MS, maximumAge: 60000 },
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
    setCoordinates(coords);
    setStatus('granted');
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setCoordinates(null);
    setError(null);
  }, []);

  // Sync from profile on mount / profile change
  React.useEffect(() => {
    if (profile?.latitude != null && profile?.longitude != null) {
      setCoordinates({ latitude: profile.latitude, longitude: profile.longitude });
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
