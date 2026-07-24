import React, { useEffect, useState } from 'react';
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

export function CustomerHome({ onBack, onSignOut }: CustomerHomeProps) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const { showToast } = useToast();

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  const fetchData = async () => {
    const [{ data: svcData, error: svcErr }, { data: bkData, error: bkErr }] = await Promise.all([
      supabase.from('services').select('id, name, description, base_price, estimated_duration').eq('is_active', true).limit(6),
      supabase
        .from('bookings')
        .select('id, status, estimated_price, created_at, services(name)')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
    if (svcErr || bkErr) {
      showToast(t('customerHome.errLoadData'), 'error');
      return;
    }
    setServices((svcData as ServiceItem[]) ?? []);
    setBookings((bkData as BookingItem[]) ?? []);
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
});
