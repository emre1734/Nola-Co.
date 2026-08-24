import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Avatar } from '../../components/ui';
import { Modal } from '../../components/ui/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation } from '../../contexts/LocationContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, typography, radii } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';
import { WasherTrackingMap } from '../../components/WasherTrackingMap';

interface ActiveBooking {
  id: string;
  status: string;
  estimated_price: number | null;
  created_at: string | null;
  provider_id: string | null;
  services?: { name: string } | null;
}

type ActiveJobPhase =
  | 'waiting'
  | 'accepted'
  | 'on_the_way'
  | 'arrived'
  | 'started'
  | 'pending_approval';

interface HomeScreenProps {
  onNavigate: (dest: 'customerHome' | 'providerDashboard' | 'providerOnboarding' | 'myVehicles' | 'booking' | 'approvalCenter' | 'bookingHistory' | 'settings') => void;
  onSignOut: () => void;
  onUpdateLocation: () => void;
}

export function HomeScreen({ onNavigate, onSignOut, onUpdateLocation }: HomeScreenProps) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const { coordinates } = useLocation();
  const { showToast } = useToast();
  const [checkingProvider, setCheckingProvider] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);
  const [jobPhase, setJobPhase] = useState<ActiveJobPhase>('accepted');
  const [trackingBookingId, setTrackingBookingId] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const activeBookingRef = useRef<ActiveBooking | null>(null);
  activeBookingRef.current = activeBooking;

  const handleWashTap = () => {
    onNavigate('booking');
  };

  const handleEarnTap = async () => {
    if (!profile) return;
    setCheckingProvider(true);
    const { data } = await supabase
      .from('provider_profiles')
      .select('id')
      .eq('profile_id', profile.id)
      .maybeSingle();
    setCheckingProvider(false);
    if (data) {
      onNavigate('providerDashboard');
    } else {
      onNavigate('providerOnboarding');
    }
  };

  const handleLogout = async () => {
    setShowLogout(false);
    await signOut();
    onSignOut();
  };

  const fetchPendingCount = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { action: 'list_customer_approvals' },
      });
      if (error || !data) {
        setPendingCount(0);
        return;
      }
      const result = data as { jobs?: unknown[]; count?: number };
      // The edge function returns { jobs: [...] } for list_customer_approvals.
      // Prefer the array length; fall back to an explicit count field.
      setPendingCount(result.jobs?.length ?? result.count ?? 0);
    } catch {
      setPendingCount(0);
    }
  };

  const fetchActiveBooking = useCallback(async () => {
    if (!profile?.id) {
      setActiveBooking(null);
      setJobPhase('accepted');
      return;
    }
    const { data, error } = await supabase
      .from('bookings')
      .select('id, status, estimated_price, created_at, provider_id, services(name)')
      .eq('customer_id', profile.id)
      .in('status', ['waiting', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      setActiveBooking(null);
      setJobPhase('accepted');
      return;
    }
    const ab = data as unknown as ActiveBooking;
    setActiveBooking(ab);

    if (ab.status === 'waiting') {
      setJobPhase('waiting');
      return;
    }

    // accepted — determine job phase via the customer-safe status RPC.
    // Returns { success, job_status } where job_status may be null (no job yet)
    // or one of: on_the_way, arrived, started, pending_approval, completed, cancelled.
    if (ab.provider_id) {
      const { data: statusData } = await supabase.rpc('get_customer_booking_job_status', {
        p_booking_id: ab.id,
      });
      const statusResult = statusData as { success?: boolean; job_status?: string | null } | null;
      if (statusResult?.success) {
        const js = statusResult.job_status;
        if (js === 'on_the_way') { setJobPhase('on_the_way'); return; }
        if (js === 'arrived') { setJobPhase('arrived'); return; }
        if (js === 'started') { setJobPhase('started'); return; }
        if (js === 'pending_approval') { setJobPhase('pending_approval'); return; }
        if (js === 'completed' || js === 'cancelled') {
          setActiveBooking(null);
          setJobPhase('accepted');
          return;
        }
      }
    }
    setJobPhase('accepted');
  }, [profile?.id]);

  useEffect(() => {
    fetchPendingCount();
    fetchActiveBooking();
  }, [fetchActiveBooking]);

  // Resync when the customer returns to the app (tab becomes visible).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchActiveBooking();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchActiveBooking]);

  // Foreground polling: while an accepted booking is active, poll the
  // customer-safe status RPC every 5 seconds so the reservation card
  // reflects job phase changes (on_the_way, arrived, started, etc.) in
  // near real time. Stops once the phase leaves accepted/waiting or the
  // booking is cleared.
  useEffect(() => {
    if (!activeBooking || activeBooking.status !== 'accepted') return;
    const interval = setInterval(() => {
      (async () => {
        const { data } = await supabase.rpc('get_customer_booking_job_status', {
          p_booking_id: activeBooking.id,
        });
        const result = data as { success?: boolean; job_status?: string | null } | null;
        if (!result?.success) return;
        const js = result.job_status;
        if (js === 'on_the_way') setJobPhase('on_the_way');
        else if (js === 'arrived') setJobPhase('arrived');
        else if (js === 'started') setJobPhase('started');
        else if (js === 'pending_approval') setJobPhase('pending_approval');
        else if (js === 'completed' || js === 'cancelled') {
          setActiveBooking(null);
          setJobPhase('accepted');
        }
      })();
    }, 5000);
    return () => clearInterval(interval);
  }, [activeBooking, fetchActiveBooking]);

  const handleCancelBooking = async () => {
    if (!activeBooking || cancelling) return;
    setCancelling(true);
    try {
      const { data, error } = await supabase.rpc('cancel_booking', {
        p_booking_id: activeBooking.id,
      });
      if (error) {
        showToast(t('home.cancelError'), 'error');
        return;
      }
      const result = data as { success?: boolean; error?: string };
      if (result?.success) {
        setActiveBooking(null);
        setJobPhase('accepted');
        setShowCancelConfirm(false);
        showToast(t('home.cancelSuccess'), 'success');
      } else if (result?.error === 'not_cancellable') {
        setShowCancelConfirm(false);
        showToast(t('home.cancelNotCancellable'), 'error');
        await fetchActiveBooking();
      } else {
        showToast(t('home.cancelError'), 'error');
      }
    } catch {
      showToast(t('home.cancelError'), 'error');
    } finally {
      setCancelling(false);
    }
  };

  const handleApprovalTap = () => {
    if (pendingCount > 0) onNavigate('approvalCenter');
  };

  const phaseLabel = (phase: ActiveJobPhase): string => {
    switch (phase) {
      case 'waiting':
        return t('home.activeWaiting');
      case 'on_the_way':
        return t('home.activeOnTheWay');
      case 'arrived':
        return t('home.activeArrived');
      case 'started':
        return t('home.activeStarted');
      case 'pending_approval':
        return t('home.activePendingApproval');
      default:
        return t('home.activeAccepted');
    }
  };

  const phaseHint = (phase: ActiveJobPhase): string => {
    if (phase === 'waiting') return t('home.activeWaitingHint');
    return t('home.activeAcceptedHint');
  };

  const phaseColor = (phase: ActiveJobPhase): string => {
    if (phase === 'waiting') return colors.warning;
    if (phase === 'on_the_way') return colors.primary;
    if (phase === 'arrived' || phase === 'started') return colors.success;
    if (phase === 'pending_approval') return colors.error;
    return colors.primary;
  };

  const phaseIcon = (phase: ActiveJobPhase): string => {
    if (phase === 'waiting') return '🔍';
    if (phase === 'on_the_way') return '🚗';
    if (phase === 'arrived') return '📍';
    if (phase === 'started') return '🧽';
    if (phase === 'pending_approval') return '✅';
    return '✓';
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandName}>
              Wish<Text style={styles.brandAccent}>Wash</Text>
            </Text>
            <Text style={styles.greeting}>
              {profile?.full_name?.split(' ')[0]
                ? t('home.greeting', { name: profile.full_name.split(' ')[0] })
                : t('home.greetingFallback')}
            </Text>
          </View>
          <Avatar
            uri={profile?.avatar_url}
            name={profile?.full_name}
            size={46}
            onPress={() => setShowLogout(true)}
          />
        </View>

        {/* Tagline */}
        <Text style={styles.tagline}>{t('home.tagline')}</Text>

        {/* Location card */}
        <TouchableOpacity
          style={styles.locationCard}
          onPress={onUpdateLocation}
          activeOpacity={0.85}
        >
          <View style={styles.locationIconWrap}>
            <Text style={styles.locationIcon}>📍</Text>
          </View>
          <View style={styles.locationBody}>
            <Text style={styles.locationLabel}>{t('home.locationLabel')}</Text>
            <Text style={styles.locationValue} numberOfLines={1}>
              {coordinates != null
                ? `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`
                : profile?.latitude != null && profile?.longitude != null
                  ? `${profile.latitude.toFixed(4)}, ${profile.longitude.toFixed(4)}`
                  : t('home.locationSet')}
            </Text>
          </View>
          <Text style={styles.locationArrow}>›</Text>
        </TouchableOpacity>

        {/* Active Reservation — shown when the customer has a current
            booking in waiting or accepted status. Recovered from server
            state on mount and when the app regains visibility. */}
        {activeBooking && (
          <View style={styles.activeCard}>
            <View style={styles.activeHeader}>
              <View style={[styles.activeIconWrap, { backgroundColor: phaseColor(jobPhase) + '18' }]}>
                <Text style={styles.activeIcon}>{phaseIcon(jobPhase)}</Text>
              </View>
              <View style={styles.activeBody}>
                <Text style={styles.activeTitle}>{t('home.activeReservationTitle')}</Text>
                <Text style={styles.activeService}>
                  {(activeBooking.services as any)?.name ?? t('customerHome.washServiceFallback')}
                </Text>
              </View>
              <View style={[styles.activeBadge, { backgroundColor: phaseColor(jobPhase) + '25' }]}>
                <Text style={[styles.activeBadgeText, { color: phaseColor(jobPhase) }]}>
                  {phaseLabel(jobPhase)}
                </Text>
              </View>
            </View>
            <Text style={styles.activeHint}>{phaseHint(jobPhase)}</Text>
            {jobPhase === 'on_the_way' && (
              <TouchableOpacity
                style={styles.activeTrackBtn}
                onPress={() => setTrackingBookingId(activeBooking.id)}
                activeOpacity={0.85}
              >
                <Text style={styles.activeTrackBtnText}>{t('home.activeTrackBtn')}</Text>
              </TouchableOpacity>
            )}
            {(jobPhase === 'waiting' || jobPhase === 'accepted') && (
              <TouchableOpacity
                style={styles.activeCancelBtn}
                onPress={() => setShowCancelConfirm(true)}
                activeOpacity={0.85}
                disabled={cancelling}
              >
                <Text style={styles.activeCancelBtnText}>{t('home.cancelBooking')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Pending Service Approval — shown at the top when there are
            jobs in pending_approval. Premium red banner with View action. */}
        {pendingCount > 0 && (
          <View style={styles.pendingCard}>
            <View style={styles.pendingIconWrap}>
              <View style={styles.pendingDot} />
            </View>
            <View style={styles.pendingBody}>
              <Text style={styles.pendingTitle}>{t('home.pendingTitle')}</Text>
              <Text style={styles.pendingSubtitle}>
                {t('home.pendingSubtitle')}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.pendingViewBtn}
              onPress={handleApprovalTap}
              activeOpacity={0.85}
            >
              <Text style={styles.pendingViewText}>{t('home.pendingView')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action cards */}
        <View style={styles.cardsWrap}>
          {/* Card 1 — Yıkat */}
          <TouchableOpacity
            style={[styles.card, styles.cardWash]}
            onPress={handleWashTap}
            activeOpacity={0.88}
          >
            <View style={styles.cardIconWrap}>
              <Text style={styles.cardIcon}>🚗</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{t('home.cardWashTitle')}</Text>
              <Text style={styles.cardSubtitle}>
                {t('home.cardWashSubtitle')}
              </Text>
            </View>
            <View style={styles.cardArrow}>
              <Text style={styles.cardArrowText}>›</Text>
            </View>
          </TouchableOpacity>

          {/* Card 2 — Kazanmaya Başla */}
          <TouchableOpacity
            style={[styles.card, styles.cardEarn]}
            onPress={handleEarnTap}
            activeOpacity={0.88}
            disabled={checkingProvider}
          >
            <View style={[styles.cardIconWrap, styles.cardIconEarn]}>
              {checkingProvider ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={styles.cardIcon}>💰</Text>
              )}
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{t('home.cardEarnTitle')}</Text>
              <Text style={styles.cardSubtitle}>
                {t('home.cardEarnSubtitle')}
              </Text>
            </View>
            <View style={styles.cardArrow}>
              <Text style={styles.cardArrowText}>›</Text>
            </View>
          </TouchableOpacity>

          {/* Card 3 — My Vehicles */}
          <TouchableOpacity
            style={[styles.card, styles.cardVehicles]}
            onPress={() => onNavigate('myVehicles')}
            activeOpacity={0.88}
          >
            <View style={[styles.cardIconWrap, styles.cardIconVehicles]}>
              <Text style={styles.cardIcon}>🔧</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{t('home.cardVehiclesTitle')}</Text>
              <Text style={styles.cardSubtitle}>
                {t('home.cardVehiclesSubtitle')}
              </Text>
            </View>
            <View style={styles.cardArrow}>
              <Text style={styles.cardArrowText}>›</Text>
            </View>
          </TouchableOpacity>

          {/* Card 4 — Booking History */}
          <TouchableOpacity
            style={[styles.card, styles.cardHistory]}
            onPress={() => onNavigate('bookingHistory')}
            activeOpacity={0.88}
          >
            <View style={[styles.cardIconWrap, styles.cardIconHistory]}>
              <Text style={styles.cardIcon}>📋</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{t('home.cardHistoryTitle')}</Text>
              <Text style={styles.cardSubtitle}>
                {t('home.cardHistorySubtitle')}
              </Text>
            </View>
            <View style={styles.cardArrow}>
              <Text style={styles.cardArrowText}>›</Text>
            </View>
          </TouchableOpacity>
          {/* Card 5 — Settings */}
          <TouchableOpacity
            style={[styles.card, styles.cardSettings]}
            onPress={() => onNavigate('settings')}
            activeOpacity={0.88}
          >
            <View style={[styles.cardIconWrap, styles.cardIconSettings]}>
              <Text style={styles.cardIcon}>⚙️</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{t('settings.title')}</Text>
              <Text style={styles.cardSubtitle}>
                {t('settings.languageSection')}
              </Text>
            </View>
            <View style={styles.cardArrow}>
              <Text style={styles.cardArrowText}>›</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statVal}>4.9 ⭐</Text>
            <Text style={styles.statLbl}>{t('home.statRating')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statVal}>2 min</Text>
            <Text style={styles.statLbl}>{t('home.statMatchTime')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statVal}>100%</Text>
            <Text style={styles.statLbl}>{t('home.statSatisfaction')}</Text>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={showLogout}
        onClose={() => setShowLogout(false)}
        title={t('home.logoutTitle')}
        message={t('home.logoutMessage')}
        confirmLabel={t('home.logoutConfirm')}
        cancelLabel={t('home.logoutCancel')}
        onConfirm={handleLogout}
        confirmVariant="danger"
      />

      <Modal
        visible={showCancelConfirm}
        onClose={() => { if (!cancelling) setShowCancelConfirm(false); }}
        title={t('home.cancelConfirmTitle')}
        message={t('home.cancelConfirmMessage')}
        confirmLabel={cancelling ? t('home.cancelling') : t('home.cancelConfirmConfirm')}
        cancelLabel={t('home.cancelConfirmCancel')}
        onConfirm={handleCancelBooking}
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
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  brandName: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  brandAccent: { color: colors.primary },
  greeting: { ...typography.body, color: colors.textSecondary },

  tagline: {
    ...typography.h2,
    marginBottom: spacing.lg,
  },

  cardsWrap: { gap: spacing.md, marginBottom: spacing.xl },

  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '30',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  locationIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  locationIcon: { fontSize: 20 },
  locationBody: { flex: 1 },
  locationLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  locationValue: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  locationArrow: { color: colors.textSecondary, fontSize: 22, fontWeight: '300' },

  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error + '12',
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.error + '50',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  pendingIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.error + '20',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pendingDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.error,
  },
  pendingBody: { flex: 1 },
  pendingTitle: { ...typography.body, fontWeight: '700', color: colors.error, marginBottom: 2 },
  pendingSubtitle: { ...typography.bodySmall, color: colors.textSecondary },
  pendingViewBtn: {
    backgroundColor: colors.error,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md + 4,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingViewText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  activeCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
  },
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  activeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  activeIcon: { fontSize: 22 },
  activeBody: { flex: 1 },
  activeTitle: { ...typography.h4, marginBottom: 2 },
  activeService: { ...typography.bodySmall, color: colors.textSecondary },
  activeBadge: {
    borderRadius: radii.full,
    paddingVertical: 3,
    paddingHorizontal: 10,
    flexShrink: 0,
  },
  activeBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  activeHint: { ...typography.bodySmall, color: colors.textMuted, marginBottom: spacing.sm },
  activeTrackBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTrackBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  activeCancelBtn: {
    borderRadius: radii.lg,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.error + '50',
  },
  activeCancelBtnText: { color: colors.error, fontWeight: '700', fontSize: 15 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1.5,
    gap: spacing.md,
  },
  cardWash: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.primary + '50',
  },
  cardEarn: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.accent + '50',
  },

  cardIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardIconEarn: {
    backgroundColor: colors.accent + '18',
  },
  cardIconVehicles: {
    backgroundColor: colors.primary + '18',
  },
  cardVehicles: {
    borderColor: colors.primary + '40',
  },
  cardHistory: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.success + '40',
  },
  cardIconHistory: {
    backgroundColor: colors.success + '18',
  },
  cardSettings: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.borderLight + '60',
  },
  cardIconSettings: {
    backgroundColor: colors.borderLight + '30',
  },
  cardIcon: { fontSize: 26 },

  cardBody: { flex: 1 },
  cardTitle: { ...typography.h4, marginBottom: 4 },
  cardSubtitle: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 18 },

  cardArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardArrowText: {
    color: colors.textSecondary,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '600',
  },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  statItem: { flex: 1, padding: spacing.md, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: colors.border },
  statVal: { ...typography.h4, color: colors.primary, marginBottom: 2 },
  statLbl: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
