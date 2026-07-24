import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useGoogleMaps } from '../../hooks/useGoogleMaps';
import {
  reverseGeocode,
  forwardGeocode,
  type LatLng,
  type ReverseGeocodeResult,
} from '../../lib/google-maps';
import { useLocation } from '../../contexts/LocationContext';
import { useToast } from '../../contexts/ToastContext';
import { colors, spacing, typography, radii } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';

interface GoogleMapViewProps {
  /** Called when the user confirms a location */
  onConfirm: (location: { lat: number; lng: number; address: ReverseGeocodeResult }) => void;
  /** Whether to show the search bar */
  showSearch?: boolean;
  /** Whether to show the confirm button at the bottom */
  showConfirmButton?: boolean;
  /** Confirm button label */
  confirmLabel?: string;
  /** Whether the confirm button is in a loading state */
  confirmLoading?: boolean;
  /** Title shown in the top bar */
  title?: string;
  /** Back button handler */
  onBack?: () => void;
}

const DEFAULT_CENTER: LatLng = { lat: 39.9334, lng: 32.8597 };

export function GoogleMapView({
  onConfirm,
  showSearch = true,
  showConfirmButton = true,
  confirmLabel,
  confirmLoading = false,
  title,
  onBack,
}: GoogleMapViewProps) {
  const { coordinates, requestLocation, status: gpsStatus } = useLocation();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t('mapView.confirmDefault');
  const resolvedTitle = title ?? t('mapView.selectDefault');

  const { status, error, attachMap, map, google: g } = useGoogleMaps();

  const [selectedPos, setSelectedPos] = useState<LatLng | null>(null);
  const [address, setAddress] = useState<ReverseGeocodeResult | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [usingGPS, setUsingGPS] = useState(false);

  const accuracyCircleRef = useRef<google.maps.Circle | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Custom WishWash marker SVG (data URI) — fixed center pin
  const WISHWASH_MARKER_ICON = React.useMemo(() => {
    if (!g) return null;
    const svg = `<svg width="40" height="52" viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 0C8.95 0 0 8.95 0 20c0 15 20 32 20 32s20-17 20-32c0-11.05-8.95-20-20-20z" fill="#06B6D4"/>
      <circle cx="20" cy="20" r="12" fill="#0A0F1E"/>
      <path d="M13 20l5 5 9-9" stroke="#06B6D4" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(40, 52),
      anchor: new g.maps.Point(20, 52),
    } as google.maps.Icon;
  }, [g]);

  // Initialize map once ready
  useEffect(() => {
    if (!map || !g) return;

    const initialPos = coordinates
      ? { lat: coordinates.latitude, lng: coordinates.longitude }
      : DEFAULT_CENTER;

    setSelectedPos(initialPos);

    // Auto-center on user's GPS location with smooth animation
    map.panTo(initialPos);

    // Listen for map drag end → reverse geocode center
    const dragListener = map.addListener('dragend', () => {
      const center = map.getCenter();
      if (center) {
        const pos = { lat: center.lat(), lng: center.lng() };
        setSelectedPos(pos);
        reverseGeocodeAndUpdate(pos);
      }
    });

    // Also listen for map click → recenter there
    const clickListener = map.addListener('click', (e: any) => {
      if (e?.latLng) {
        const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        map.panTo(pos);
        setSelectedPos(pos);
        reverseGeocodeAndUpdate(pos);
      }
    });

    return () => {
      // Listeners are cleaned up by Google Maps on map dispose
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, g]);

  // Update accuracy circle when GPS coordinates change
  useEffect(() => {
    if (!map || !g || !coordinates) return;

    const pos = { lat: coordinates.latitude, lng: coordinates.longitude };

    if (!accuracyCircleRef.current) {
      const circle = new g.maps.Circle({
        map,
        center: pos,
        radius: gpsAccuracy ?? 100,
        strokeColor: colors.primary,
        strokeOpacity: 0.3,
        strokeWeight: 1,
        fillColor: colors.primary,
        fillOpacity: 0.06,
      });
      accuracyCircleRef.current = circle;
    } else {
      accuracyCircleRef.current.setCenter(pos);
      if (gpsAccuracy != null) {
        accuracyCircleRef.current.setRadius(gpsAccuracy);
      }
    }
  }, [map, g, coordinates, gpsAccuracy]);

  // Watch GPS accuracy
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setGpsAccuracy(pos.coords.accuracy),
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Reverse geocode initial position once map is ready
  useEffect(() => {
    if (map && selectedPos && !address) {
      reverseGeocodeAndUpdate(selectedPos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedPos]);

  const reverseGeocodeAndUpdate = useCallback(async (pos: LatLng) => {
    // Debounce geocoding calls
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    geocodeTimerRef.current = setTimeout(async () => {
      setGeocoding(true);
      try {
        const result = await reverseGeocode(pos.lat, pos.lng);
        setAddress(result);
      } catch {
        setAddress(null);
      }
      setGeocoding(false);
    }, 300);
  }, []);

  const handleUseCurrentLocation = useCallback(() => {
    if (!map || !g) return;
    if (!coordinates) {
      // Request GPS if not available
      setUsingGPS(true);
      requestLocation();
      return;
    }
    const pos = { lat: coordinates.latitude, lng: coordinates.longitude };
    map.panTo(pos);
    setSelectedPos(pos);
    reverseGeocodeAndUpdate(pos);
    showToast(t('mapView.centered'), 'success');
  }, [map, g, coordinates, requestLocation, showToast, reverseGeocodeAndUpdate]);

  // When GPS coordinates become available after requesting, center the map
  useEffect(() => {
    if (usingGPS && coordinates && map) {
      const pos = { lat: coordinates.latitude, lng: coordinates.longitude };
      map.panTo(pos);
      setSelectedPos(pos);
      reverseGeocodeAndUpdate(pos);
      setUsingGPS(false);
    }
  }, [usingGPS, coordinates, map, reverseGeocodeAndUpdate]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const result = await forwardGeocode(searchQuery);
      if (result) {
        if (map) map.panTo(result);
        setSelectedPos(result);
        reverseGeocodeAndUpdate(result);
      } else {
        showToast(t('mapView.notFound'), 'error');
      }
    } catch {
      showToast(t('mapView.searchFailed'), 'error');
    }
    setSearching(false);
  };

  const handleConfirm = () => {
    if (!selectedPos) {
      showToast(t('mapView.noSelection'), 'error');
      return;
    }
    const addr = address ?? {
      street: null,
      district: null,
      city: null,
      fullAddress: `${selectedPos.lat.toFixed(6)}, ${selectedPos.lng.toFixed(6)}`,
    };
    onConfirm({ lat: selectedPos.lat, lng: selectedPos.lng, address: addr });
  };

  const handleRetryGPS = () => {
    setUsingGPS(true);
    requestLocation();
  };

  return (
    <View style={styles.container}>
      {onBack && <TopBar title={resolvedTitle} onBack={onBack} />}

      {/* Search bar — hidden until map is ready */}
      {showSearch && status === 'ready' && (
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('mapView.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={searching}>
            {searching ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.searchBtnText}>{t('mapView.searchBtn')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Map container — always rendered so attachMap ref fires */}
      <View style={styles.mapWrap}>
        <div ref={attachMap} style={styles.iframe as any} />

        {/* Loading overlay */}
        {(status === 'idle' || status === 'loading') && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>{t('mapView.loadingMap')}</Text>
          </View>
        )}

        {/* Error overlay */}
        {status === 'error' && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>{t('mapView.mapUnavailable')}</Text>
            <Text style={styles.errorMsg}>{error ?? t('mapView.mapError')}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => window.location.reload()}
              activeOpacity={0.85}
            >
              <Text style={styles.retryBtnText}>{t('mapView.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Center pin overlay — only when ready */}
        {status === 'ready' && (
          <View style={styles.centerPinWrap} pointerEvents="none">
            <Text style={styles.centerPinEmoji}>📍</Text>
          </View>
        )}

        {/* GPS accuracy badge */}
        {gpsAccuracy != null && (
          <View style={styles.accuracyBadge}>
            <Text style={styles.accuracyText}>
              {t('mapView.gpsAccuracy', { m: Math.round(gpsAccuracy) })}
            </Text>
          </View>
        )}

        {/* GPS status indicator */}
        {(gpsStatus === 'requesting' || usingGPS) && (
          <View style={styles.gpsStatusBadge}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.gpsStatusText}>{t('mapView.locating')}</Text>
          </View>
        )}

        {/* Recenter button */}
        <TouchableOpacity
          style={styles.recenterBtn}
          onPress={handleUseCurrentLocation}
          activeOpacity={0.85}
        >
          <Text style={styles.recenterIcon}>📡</Text>
        </TouchableOpacity>
      </View>

      {/* Address card */}
      <View style={styles.addressCard}>
        <View style={styles.addressHeader}>
          <Text style={styles.addressLabel}>{t('mapView.addressLabel')}</Text>
          <TouchableOpacity onPress={() => selectedPos && reverseGeocodeAndUpdate(selectedPos)}>
            {geocoding ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.refreshText}>{t('mapView.refresh')}</Text>
            )}
          </TouchableOpacity>
        </View>
        {address ? (
          <>
            {address.street && <Text style={styles.addressStreet}>{address.street}</Text>}
            {address.district && <Text style={styles.addressLine}>{address.district}</Text>}
            {address.city && <Text style={styles.addressLine}>{address.city}</Text>}
            <Text style={styles.addressCoords}>
              {selectedPos?.lat.toFixed(6)}, {selectedPos?.lng.toFixed(6)}
            </Text>
          </>
        ) : geocoding ? (
          <Text style={styles.addressLine}>{t('mapView.retrievingAddress')}</Text>
        ) : (
          <Text style={styles.addressLine}>{t('mapView.dragHint')}</Text>
        )}
      </View>

      {/* GPS error retry */}
      {(gpsStatus === 'denied' || gpsStatus === 'error') && (
        <View style={styles.gpsErrorBar}>
          <Text style={styles.gpsErrorText}>
            {gpsStatus === 'denied'
              ? t('mapView.gpsDenied')
              : t('mapView.gpsUnavailable')}
          </Text>
          <TouchableOpacity onPress={handleRetryGPS}>
            <Text style={styles.retryText}>{t('mapView.retryGps')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={styles.useCurrentBtn}
          onPress={handleUseCurrentLocation}
          activeOpacity={0.85}
        >
          <Text style={styles.useCurrentBtnText}>{t('mapView.useCurrent')}</Text>
        </TouchableOpacity>

        {showConfirmButton && (
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={handleConfirm}
            disabled={confirmLoading || !selectedPos}
            activeOpacity={0.85}
          >
            {confirmLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.confirmBtnText}>{resolvedConfirmLabel}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backIcon}>‹</Text>
      </TouchableOpacity>
      <Text style={styles.topTitle}>{title}</Text>
      <View style={styles.backBtnPlaceholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '300' },
  topTitle: { ...typography.h4 },
  backBtnPlaceholder: { width: 36 },

  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    zIndex: 10,
  },
  loadingText: { ...typography.body, color: colors.textSecondary },
  errorIcon: { fontSize: 48, marginBottom: spacing.sm },
  errorTitle: { ...typography.h3, textAlign: 'center' },
  errorMsg: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  errorHint: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  retryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  searchBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  mapWrap: {
    flex: 1,
    position: 'relative',
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  iframe: {
    width: '100%',
    height: '100%',
  },

  centerPinWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -16,
    marginTop: -28,
    zIndex: 10,
  },
  centerPinEmoji: { fontSize: 32 },

  recenterBtn: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  recenterIcon: { fontSize: 20 },

  accuracyBadge: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.md,
    backgroundColor: colors.surfaceAlt + 'E6',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  accuracyText: { ...typography.caption, color: colors.textSecondary, fontSize: 10 },

  gpsStatusBadge: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.md + 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceAlt + 'E6',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  gpsStatusText: { ...typography.caption, color: colors.primary, fontSize: 10 },

  addressCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  addressLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  refreshText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  addressStreet: { ...typography.body, fontWeight: '600', marginBottom: 2 },
  addressLine: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: 2 },
  addressCoords: { ...typography.caption, color: colors.textMuted, marginTop: 4 },

  gpsErrorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.warning + '15',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.warning + '30',
    gap: spacing.sm,
  },
  gpsErrorText: { ...typography.bodySmall, color: colors.warning, flex: 1 },
  retryText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },

  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  useCurrentBtn: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  useCurrentBtnText: { color: colors.primary, fontWeight: '700', fontSize: 15 },

  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
});
