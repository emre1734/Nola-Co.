import React, { useEffect, useState } from 'react';
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
import { supabase } from '../../lib/supabase';
import { colors, spacing, typography, radii } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';

interface HomeScreenProps {
  onNavigate: (dest: 'customerHome' | 'providerDashboard' | 'providerOnboarding' | 'myVehicles' | 'booking' | 'approvalCenter' | 'bookingHistory' | 'settings') => void;
  onSignOut: () => void;
  onUpdateLocation: () => void;
}

export function HomeScreen({ onNavigate, onSignOut, onUpdateLocation }: HomeScreenProps) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const { coordinates } = useLocation();
  const [checkingProvider, setCheckingProvider] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

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

  useEffect(() => {
    fetchPendingCount();
  }, []);

  const handleApprovalTap = () => {
    if (pendingCount > 0) onNavigate('approvalCenter');
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
