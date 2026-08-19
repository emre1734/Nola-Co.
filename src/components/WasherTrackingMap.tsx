import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useGoogleMaps } from '../hooks/useGoogleMaps';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

interface WasherTrackingMapProps {
  bookingId: string;
  onClose: () => void;
}

interface LiveLocation {
  lat: number;
  lng: number;
  updated_at: string;
}

const POLL_INTERVAL_MS = 5000;

export function WasherTrackingMap({ bookingId, onClose }: WasherTrackingMapProps) {
  const { t } = useTranslation();
  const { status, error, attachMap, map, google: g } = useGoogleMaps();

  const [location, setLocation] = useState<LiveLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [arrived, setArrived] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  console.log('CUSTOMER_TRACKING_BOOKING_ID', { bookingId });

  const fetchLiveLocation = useCallback(async () => {
    const { data, error: dbError } = await supabase
      .from('provider_live_locations')
      .select('lat, lng, updated_at')
      .eq('booking_id', bookingId)
      .maybeSingle();

    console.log('CUSTOMER_TRACKING_FETCH_RESULT', {
      bookingId,
      found: !!data,
      lat: data?.lat ?? null,
      lng: data?.lng ?? null,
      updatedAt: data?.updated_at ?? null,
      errorCode: dbError?.code ?? null,
      errorMessage: dbError?.message ?? null,
    });

    if (dbError) {
      setLocError(t('customerHome.trackingUnavailable'));
      return;
    }

    if (!data) {
      return;
    }

    setLocation({ lat: data.lat, lng: data.lng, updated_at: data.updated_at });
    setLocError(null);
  }, [bookingId, t]);

  // Initial fetch + Realtime subscription + 5-second polling fallback.
  useEffect(() => {
    fetchLiveLocation().finally(() => setLoading(false));

    const channel = supabase
      .channel(`tracking-${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'provider_live_locations',
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          const row = payload.new as { lat: number; lng: number; updated_at: string } | null;
          console.log('CUSTOMER_TRACKING_REALTIME_PAYLOAD', {
            bookingId,
            eventType: payload.eventType,
            lat: row?.lat ?? null,
            lng: row?.lng ?? null,
            updatedAt: row?.updated_at ?? null,
          });
          if (row && row.lat != null && row.lng != null) {
            setLocation({ lat: row.lat, lng: row.lng, updated_at: row.updated_at });
            setLocError(null);
          }
        },
      )
      .subscribe();

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchLiveLocation();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, [bookingId, fetchLiveLocation]);

  // Realtime: listen for job status changes to stop tracking when the washer arrives.
  useEffect(() => {
    const channel = supabase
      .channel(`job-status:${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          const updated = payload.new as { status: string };
          if (updated.status !== 'on_the_way') {
            setArrived(true);
            setLocation(null);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId]);

  // Update the marker when location changes.
  useEffect(() => {
    if (!map || !g || !location) return;
    const pos = { lat: location.lat, lng: location.lng };
    console.log('CUSTOMER_TRACKING_MARKER_RENDER', { latitude: pos.lat, longitude: pos.lng });

    if (!markerRef.current) {
      const svg = `<svg width="40" height="52" viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 0C8.95 0 0 8.95 0 20c0 15 20 32 20 32s20-17 20-32c0-11.05-8.95-20-20-20z" fill="#06B6D4"/>
        <circle cx="20" cy="20" r="12" fill="#0A0F1E"/>
        <path d="M10 24h20l-4-6-4 4-4-6-4 4-4-4z" fill="#06B6D4" stroke="none"/>
      </svg>`;
      const icon = {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new g.maps.Size(40, 52),
        anchor: new g.maps.Point(20, 52),
      } as google.maps.Icon;
      markerRef.current = new g.maps.Marker({ map, position: pos, icon });
    } else {
      markerRef.current.setPosition(pos);
    }
    map.panTo(pos);
  }, [map, g, location]);

  // Cleanup marker on unmount.
  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t('customerHome.trackingLoading')}</Text>
        </View>
      </View>
    );
  }

  if (arrived) {
    return (
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.arrivedIcon}>✅</Text>
          <Text style={styles.arrivedTitle}>{t('customerHome.washerArrived')}</Text>
          <Text style={styles.arrivedSubtitle}>{t('customerHome.trackingEnded')}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>{t('customerHome.trackingClose')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>{t('mapView.mapUnavailable')}</Text>
          <Text style={styles.errorMsg}>{error ?? t('mapView.mapError')}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>{t('customerHome.trackingClose')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (locError) {
    return (
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.errorIcon}>📍</Text>
          <Text style={styles.errorTitle}>{t('customerHome.trackingUnavailable')}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>{t('customerHome.trackingClose')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // While the map is ready but no live location has been received yet,
  // show a waiting state instead of presenting the Ankara default center
  // as though it were the provider's location.
  if (status === 'ready' && !location) {
    return (
      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>{t('customerHome.trackingTitle')}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t('customerHome.trackingWaiting')}</Text>
        </View>
        <View style={styles.footer}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>{t('customerHome.trackingClose')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('customerHome.trackingTitle')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.mapWrap}>
        <div ref={attachMap} style={styles.iframe as any} />

        {(status === 'idle' || status === 'loading') && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>{t('mapView.loadingMap')}</Text>
          </View>
        )}

        {status === 'ready' && location && (
          <View style={styles.infoBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{t('customerHome.trackingLive')}</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerHint}>{t('customerHome.trackingHint')}</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
          <Text style={styles.closeBtnText}>{t('customerHome.trackingClose')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    zIndex: 100,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '300' },
  topTitle: { ...typography.h4 },

  mapWrap: {
    flex: 1,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    position: 'relative',
  },
  iframe: { width: '100%', height: '100%' },

  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg,
    zIndex: 10,
  },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },

  infoBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    backgroundColor: colors.surfaceAlt + 'F2',
    borderRadius: radii.lg,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.success,
  },
  liveText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  footerHint: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  arrivedIcon: { fontSize: 56 },
  arrivedTitle: { ...typography.h2, textAlign: 'center' },
  arrivedSubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  errorIcon: { fontSize: 48 },
  errorTitle: { ...typography.h3, textAlign: 'center' },
  errorMsg: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },

  closeBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    minWidth: 200,
  },
  closeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
