import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Avatar, EmptyState, Loading } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, typography, radii } from '../../theme';
import { Modal } from '../../components/ui/Modal';
import { useTranslation } from '../../i18n/useTranslation';
import { WasherTrackingMap } from '../../components/WasherTrackingMap';

interface CustomerHomeProps {
  onBack: () => void;
  onSignOut: () => void;
}

interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  base_price: number | null;
  estimated_duration: number | null;
}

interface BookingItem {
  id: string;
  status: string;
  estimated_price: number | null;
  created_at: string | null;
  services?: { name: string } | null;
}

interface ActiveBooking extends BookingItem {
  provider_id: string | null;
}

const ACTIVE_BOOKING_STATUSES = ['accepted', 'on_the_way'];

export function CustomerHome({ onBack, onSignOut }: CustomerHomeProps) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const { showToast } = useToast();

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);
  const [trackingBookingId, setTrackingBookingId] = useState<string | null>(null);
  const [jobOnTheWay, setJobOnTheWay] = useState(false);
  const activeBookingRef = useRef<ActiveBooking | null>(null);
  activeBookingRef.current = activeBooking;

  const fetchData = async () => {
    const [{ data: svcData, error: svcErr }, { data: bkData, error: bkErr }, { data: activeData, error: activeErr }] = await Promise.all([
      supabase.from('services').select('id, name, description, base_price, estimated_duration').eq('is_active', true).limit(6),
      supabase
        .from('bookings')
        .select('id, status, estimated_price, created_at, services(name)')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('bookings')
        .select('id, status, estimated_price, created_at, provider_id, services(name)')
        .in('status', ACTIVE_BOOKING_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (svcErr || bkErr) {
      showToast(t('customerHome.errLoadData'), 'error');
      return;
    }
    setServices((svcData as ServiceItem[]) ?? []);
    setBookings((bkData as BookingItem[]) ?? []);
    if (activeErr || !activeData) {
      setActiveBooking(null);
      setJobOnTheWay(false);
      return;
    }
    const ab = activeData as ActiveBooking;
    setActiveBooking(ab);
    // Check if the assigned job is actually on_the_way via the secure RPC.
    if (ab.provider_id) {
      const { data: rpcData } = await supabase.rpc('get_assigned_washer_location', {
        p_booking_id: ab.id,
      });
      const rows = (rpcData ?? []) as Array<{ job_status: string | null }>;
      setJobOnTheWay(rows.length > 0 && rows[0].job_status === 'on_the_way');
    } else {
      setJobOnTheWay(false);
    }
  };

  useEffect(() => {
    fetchData().finally(() => setLoadingData(false));
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handleLogout = async () => {
    setShowLogout(false);
    await signOut();
    onSignOut();
  };

  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      waiting: colors.warning,
      accepted: colors.primary,
      cancelled: colors.error,
      expired: colors.textMuted,
    };
    return map[s] ?? colors.textMuted;
  };

  const canTrack = jobOnTheWay && !!activeBooking?.provider_id;

  // Realtime: listen for job status changes so the tracking button and
  // tracking view react without a page refresh. When the job transitions
  // away from on_the_way (arrived/completed/cancelled), close the tracking
  // view and clear the button.
  const handleJobUpdate = useCallback((payload: { new?: { status?: string; booking_id?: string } } | null) => {
    const newStatus = payload?.new?.status;
    const bookingId = payload?.new?.booking_id;
    const ab = activeBookingRef.current;
    if (!ab || bookingId !== ab.id) return;
    if (newStatus === 'on_the_way') {
      setJobOnTheWay(true);
    } else {
      setJobOnTheWay(false);
      setTrackingBookingId(null);
      if (newStatus === 'arrived') {
        showToast(t('customerHome.washerArrived'), 'success');
      }
    }
  }, [showToast, t]);

  useEffect(() => {
    if (!activeBooking) return;
    const channel = supabase
      .channel(`customer-job:${activeBooking.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `booking_id=eq.${activeBooking.id}`,
        },
        handleJobUpdate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeBooking, handleJobUpdate]);

  if (loadingData) return <Loading fullScreen message={t('customerHome.loading')} />;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('customerHome.title')}</Text>
        <Avatar
          uri={profile?.avatar_url}
          name={profile?.full_name}
          size={36}
          onPress={() => setShowLogout(true)}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Active booking tracking card */}
        {activeBooking && (
          <View style={styles.trackingCard}>
            <View style={styles.trackingHeader}>
              <Text style={styles.trackingIcon}>🚗</Text>
              <View style={styles.trackingBody}>
                <Text style={styles.trackingTitle}>{t('customerHome.activeBookingTitle')}</Text>
                <Text style={styles.trackingService}>
                  {(activeBooking.services as any)?.name ?? t('customerHome.washServiceFallback')}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: colors.primary + '25' }]}>
                <Text style={[styles.statusText, { color: colors.primary }]}>
                  {jobOnTheWay ? t('customerHome.statusOnTheWay') : t('customerHome.statusAccepted')}
                </Text>
              </View>
            </View>
            {canTrack ? (
              <TouchableOpacity
                style={styles.trackBtn}
                onPress={() => setTrackingBookingId(activeBooking.id)}
                activeOpacity={0.85}
              >
                <Text style={styles.trackBtnText}>{t('customerHome.trackWasher')}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.trackingHint}>{t('customerHome.trackingWaitingHint')}</Text>
            )}
          </View>
        )}

        <View style={styles.heroCard}>
          <View>
            <Text style={styles.heroTitle}>{t('customerHome.heroTitle')}</Text>
            <Text style={styles.heroSubtitle}>
              {t('customerHome.heroSubtitle')}
            </Text>
          </View>
          <Text style={styles.heroEmoji}>✨</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('customerHome.servicesTitle')}</Text>
          {services.length === 0 ? (
            <EmptyState icon="🧹" title={t('customerHome.servicesEmpty')} />
          ) : (
            <View style={styles.servicesGrid}>
              {services.map(svc => (
                <View key={svc.id} style={styles.serviceCard}>
                  <Text style={styles.servicePrice}>
                    {svc.base_price != null ? `₺${svc.base_price}` : t('customerHome.customPrice')}
                  </Text>
                  <Text style={styles.serviceName}>{svc.name}</Text>
                  {svc.description && (
                    <Text style={styles.serviceDesc} numberOfLines={2}>
                      {svc.description}
                    </Text>
                  )}
                  {svc.estimated_duration && (
                    <Text style={styles.serviceDuration}>⏱ {svc.estimated_duration} {t('customerHome.minSuffix')}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('customerHome.recentTitle')}</Text>
          {bookings.length === 0 ? (
            <EmptyState
              icon="📋"
              title={t('customerHome.recentEmptyTitle')}
              subtitle={t('customerHome.recentEmptySubtitle')}
            />
          ) : (
            <View style={styles.bookingList}>
              {bookings.map(b => (
                <View key={b.id} style={styles.bookingRow}>
                  <View style={styles.bookingInfo}>
                    <Text style={styles.bookingService}>
                      {(b.services as any)?.name ?? t('customerHome.washServiceFallback')}
                    </Text>
                    <Text style={styles.bookingDate}>
                      {b.created_at ? new Date(b.created_at).toLocaleDateString() : ''}
                    </Text>
                  </View>
                  <View style={styles.bookingRight}>
                    {b.estimated_price != null && (
                      <Text style={styles.bookingPrice}>₺{b.estimated_price}</Text>
                    )}
                    <View style={[styles.statusBadge, { backgroundColor: statusColor(b.status) + '25' }]}>
                      <Text style={[styles.statusText, { color: statusColor(b.status) }]}>
                        {b.status}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showLogout}
        onClose={() => setShowLogout(false)}
        title={t('customerHome.logoutTitle')}
        message={t('customerHome.logoutMessage')}
        confirmLabel={t('customerHome.logoutConfirm')}
        cancelLabel={t('customerHome.logoutCancel')}
        onConfirm={handleLogout}
        confirmVariant="danger"
      />

      {trackingBookingId && (
        <WasherTrackingMap
          bookingId={trackingBookingId}
          onClose={() => setTrackingBookingId(null)}
        />
      )}
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
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  heroCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.primary + '30',
    overflow: 'hidden',
  },
  heroTitle: { ...typography.h3, marginBottom: 4 },
  heroSubtitle: { ...typography.bodySmall, color: colors.textSecondary, maxWidth: 200 },
  heroEmoji: { fontSize: 42 },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.h4, marginBottom: spacing.md },
  servicesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  serviceCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    width: '48%',
  },
  servicePrice: { ...typography.h3, color: colors.primary, marginBottom: 4 },
  serviceName: { ...typography.h4, marginBottom: 4, fontSize: 14 },
  serviceDesc: { ...typography.bodySmall, marginBottom: 4 },
  serviceDuration: { ...typography.caption, color: colors.textMuted },
  bookingList: { gap: spacing.sm },
  bookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bookingInfo: { flex: 1 },
  bookingService: { ...typography.body, fontWeight: '600', marginBottom: 2 },
  bookingDate: { ...typography.bodySmall },
  bookingRight: { alignItems: 'flex-end', gap: 4 },
  bookingPrice: { ...typography.body, fontWeight: '700', color: colors.primary },
  statusBadge: { borderRadius: radii.full, paddingVertical: 3, paddingHorizontal: 10 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },

  trackingCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.md,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  trackingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  trackingIcon: { fontSize: 28 },
  trackingBody: { flex: 1 },
  trackingTitle: { ...typography.h4, marginBottom: 2 },
  trackingService: { ...typography.bodySmall, color: colors.textSecondary },
  trackingHint: { ...typography.bodySmall, color: colors.textMuted, fontStyle: 'italic' },
  trackBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 12,
    alignItems: 'center',
  },
  trackBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
