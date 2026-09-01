import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { EmptyState, Loading } from '../../components/ui';
import { PhotoViewer } from '../../components/PhotoViewer';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { createJobImageSignedUrl } from '../../lib/job-image-resolver';
import { colors, spacing, typography, radii } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';

interface HistoryJob {
  id: string;
  booking_id: string;
  status: string;
  before_photo_url: string | null;
  after_photo_url: string | null;
  completed_at: string | null;
  updated_at: string | null;
  estimated_price: number | null;
  booking_date: string | null;
  booking_time: string | null;
  service_name: string | null;
  vehicle: { brand: string; model: string; plate: string; color: string | null } | null;
  provider_name: string | null;
}

interface UpcomingBooking {
  id: string;
  status: string;
  estimated_price: number | null;
  booking_date: string | null;
  booking_time: string | null;
  created_at: string | null;
  services: { name: string } | null;
  vehicles: { brand: string; model: string; plate: string; color: string | null } | null;
}

interface BookingHistoryScreenProps {
  onBack: () => void;
}

// Terminal booking statuses that belong in History (not Upcoming).
const TERMINAL_STATUSES = ['cancelled', 'expired'];

function statusBadgeColor(s: string): string {
  if (s === 'completed') return colors.success;
  if (s === 'cancelled') return colors.error;
  if (s === 'expired') return colors.textMuted;
  return colors.primary;
}

function statusLabelKey(s: string): string {
  if (s === 'completed') return 'history.statusCompleted';
  if (s === 'cancelled') return 'history.statusCancelled';
  if (s === 'expired') return 'history.statusExpired';
  if (s === 'waiting') return 'history.statusWaiting';
  if (s === 'accepted') return 'history.statusAccepted';
  return 'history.statusAccepted';
}

export function BookingHistoryScreen({ onBack }: BookingHistoryScreenProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([]);
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewer, setViewer] = useState<{ images: { uri: string; label: string }[]; index: number } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    // Upcoming bookings: still active (not terminal). RLS scopes to own rows.
    const { data: upData, error: upErr } = await supabase
      .from('bookings')
      .select('id, status, estimated_price, booking_date, booking_time, created_at, services(name), vehicles(brand, model, plate, color)')
      .not('status', 'in', '("cancelled","expired")')
      .order('booking_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    // Completed jobs (with photos) via the existing edge function.
    const { data, error } = await supabase.functions.invoke('job-progress', {
      body: { action: 'list_completed_jobs' },
    });

    if (upErr) {
      console.error('[history] upcoming load failed:', upErr.message);
      setUpcoming([]);
    } else {
      setUpcoming((upData as unknown as UpcomingBooking[]) ?? []);
    }

    if (error || !data) {
      const err = error as { message?: string } | null;
      console.error('[history] jobs load failed:', err?.message);
      setJobs([]);
    } else {
      const result = data as { success?: boolean; jobs?: HistoryJob[] };
      const jobs = result.jobs ?? [];
      for (const j of jobs) {
        j.before_photo_url = await createJobImageSignedUrl(j.before_photo_url);
        j.after_photo_url = await createJobImageSignedUrl(j.after_photo_url);
      }
      setJobs(jobs);
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const openPhotoViewer = (images: { uri: string; label: string }[], index: number) => {
    if (images.length === 0) {
      showToast(t('history.noPhoto'), 'info');
      return;
    }
    setViewer({ images, index });
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '';
    try {
      // booking_time is stored as a time string (e.g. "09:30:00").
      const parts = iso.split(':');
      return `${parts[0]}:${parts[1]}`;
    } catch {
      return '';
    }
  };

  if (loading) return <Loading fullScreen message={t('history.loading')} />;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('history.title')}</Text>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>
            {profile?.full_name?.charAt(0)?.toUpperCase() ?? '?'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1 — Upcoming Bookings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('history.upcomingTitle')}</Text>
          {upcoming.length === 0 ? (
            <Text style={styles.sectionEmpty}>{t('history.upcomingEmpty')}</Text>
          ) : (
            <View style={styles.cardList}>
              {upcoming.map(b => {
                const svcName = b.services?.name ?? t('history.washServiceFallback');
                const veh = b.vehicles ?? null;
                return (
                  <View key={b.id} style={styles.upcomingCard}>
                    <View style={styles.upcomingLeft}>
                      <Text style={styles.cardTitle}>{svcName}</Text>
                      {veh && (
                        <Text style={styles.cardSub}>
                          {veh.brand} {veh.model}
                          {veh.plate ? ` · ${veh.plate}` : ''}
                        </Text>
                      )}
                      <Text style={styles.cardDate}>
                        {b.booking_date ? formatDate(b.booking_date) : formatDate(b.created_at)}
                        {b.booking_time ? ` · ${formatTime(b.booking_time)}` : ''}
                      </Text>
                    </View>
                    <View style={styles.cardSummaryRight}>
                      {b.estimated_price != null && (
                        <Text style={styles.cardPrice}>₺{b.estimated_price}</Text>
                      )}
                      <View style={[styles.statusBadge, { backgroundColor: statusBadgeColor(b.status) + '25' }]}>
                        <Text style={[styles.statusBadgeText, { color: statusBadgeColor(b.status) }]}>
                          {t(statusLabelKey(b.status))}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Section 2 — History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('history.historyTitle')}</Text>
          {jobs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="📋"
                title={t('history.emptyTitle')}
                subtitle={t('history.emptySubtitle')}
              />
            </View>
          ) : (
            <>
              <Text style={styles.countLine}>
                {jobs.length} {t('history.completed')} {jobs.length === 1 ? t('history.serviceSingular') : t('history.servicePlural')}
              </Text>
              <View style={styles.cardList}>
                {jobs.map(job => {
                  const photos: { uri: string; label: string }[] = [];
                  if (job.before_photo_url) photos.push({ uri: job.before_photo_url, label: t('history.before') });
                  if (job.after_photo_url) photos.push({ uri: job.after_photo_url, label: t('history.after') });
                  const expanded = expandedId === job.id;

                  return (
                    <View key={job.id} style={styles.historyCard}>
                      <TouchableOpacity
                        style={styles.cardSummary}
                        onPress={() => setExpandedId(expanded ? null : job.id)}
                        activeOpacity={0.85}
                      >
                        <View style={styles.cardSummaryLeft}>
                          <Text style={styles.cardTitle}>
                            {job.service_name ?? t('history.washServiceFallback')}
                          </Text>
                          {job.vehicle && (
                            <Text style={styles.cardSub}>
                              {job.vehicle.brand} {job.vehicle.model}
                              {job.vehicle.plate ? ` · ${job.vehicle.plate}` : ''}
                            </Text>
                          )}
                          <Text style={styles.cardDate}>
                            {job.booking_date ? formatDate(job.booking_date) : formatDate(job.completed_at)}
                            {job.booking_time ? ` · ${formatTime(job.booking_time)}` : ''}
                          </Text>
                        </View>
                        <View style={styles.cardSummaryRight}>
                          {job.estimated_price != null && (
                            <Text style={styles.cardPrice}>₺{job.estimated_price}</Text>
                          )}
                          <View style={styles.statusBadge}>
                            <Text style={styles.statusBadgeText}>{t('history.statusCompleted')}</Text>
                          </View>
                          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
                        </View>
                      </TouchableOpacity>

                      {expanded && (
                        <View style={styles.cardDetails}>
                          {/* Before/After thumbnails */}
                          {photos.length > 0 && (
                            <View style={styles.thumbRow}>
                              {photos.map((p, i) => (
                                <TouchableOpacity
                                  key={i}
                                  style={styles.thumb}
                                  activeOpacity={0.9}
                                  onPress={() => openPhotoViewer(photos, i)}
                                >
                                  <Image source={{ uri: p.uri }} style={styles.thumbImg} resizeMode="cover" />
                                  <View style={[styles.thumbTag, i === 0 ? styles.thumbTagBefore : styles.thumbTagAfter]}>
                                    <Text style={styles.thumbTagText}>{p.label}</Text>
                                  </View>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}

                          <View style={styles.detailRows}>
                            <View style={styles.detailRow}>
                              <Text style={styles.detailIcon}>🧽</Text>
                              <View style={styles.detailBody}>
                                <Text style={styles.detailLabel}>{t('history.detailService')}</Text>
                                <Text style={styles.detailValue}>{job.service_name ?? t('history.washServiceFallback')}</Text>
                              </View>
                            </View>
                            <View style={styles.detailRow}>
                              <Text style={styles.detailIcon}>👤</Text>
                              <View style={styles.detailBody}>
                                <Text style={styles.detailLabel}>{t('history.detailPartner')}</Text>
                                <Text style={styles.detailValue}>{job.provider_name ?? t('history.partnerFallback')}</Text>
                              </View>
                            </View>
                            <View style={styles.detailRow}>
                              <Text style={styles.detailIcon}>📅</Text>
                              <View style={styles.detailBody}>
                                <Text style={styles.detailLabel}>{t('history.detailDate')}</Text>
                                <Text style={styles.detailValue}>
                                  {job.booking_date ? formatDate(job.booking_date) : formatDate(job.completed_at) || '—'}
                                </Text>
                              </View>
                            </View>
                            {job.booking_time && (
                              <View style={styles.detailRow}>
                                <Text style={styles.detailIcon}>⏰</Text>
                                <View style={styles.detailBody}>
                                  <Text style={styles.detailLabel}>{t('history.detailTime')}</Text>
                                  <Text style={styles.detailValue}>{formatTime(job.booking_time)}</Text>
                                </View>
                              </View>
                            )}
                            {job.vehicle && (
                              <View style={styles.detailRow}>
                                <Text style={styles.detailIcon}>🚗</Text>
                                <View style={styles.detailBody}>
                                  <Text style={styles.detailLabel}>{t('history.detailVehicle')}</Text>
                                  <Text style={styles.detailValue}>
                                    {job.vehicle.brand} {job.vehicle.model}
                                    {job.vehicle.plate ? ` · ${job.vehicle.plate}` : ''}
                                  </Text>
                                </View>
                              </View>
                            )}
                            <View style={styles.detailRow}>
                              <Text style={styles.detailIcon}>✅</Text>
                              <View style={styles.detailBody}>
                                <Text style={styles.detailLabel}>{t('history.detailStatus')}</Text>
                                <Text style={[styles.detailValue, { color: colors.success }]}>{t('history.statusCompleted')}</Text>
                              </View>
                            </View>
                          </View>

                          {photos.length > 0 && (
                            <TouchableOpacity
                              style={styles.viewPhotosBtn}
                              onPress={() => openPhotoViewer(photos, 0)}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.viewPhotosBtnText}>{t('history.viewPhotos')}</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      <PhotoViewer
        visible={!!viewer}
        images={viewer?.images ?? []}
        startIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '300' },
  topTitle: { ...typography.h4 },
  avatarPlaceholder: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '700', fontSize: 16 },

  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.h4, marginBottom: spacing.md },
  sectionEmpty: { ...typography.bodySmall, color: colors.textSecondary, fontStyle: 'italic' },

  cardList: { gap: spacing.md },

  // Upcoming card (reuses booking row styling from CustomerHome)
  upcomingCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt, borderRadius: radii.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  upcomingLeft: { flex: 1, paddingRight: spacing.sm },

  historyCard: {
    backgroundColor: colors.surfaceAlt, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  cardSummary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.md,
  },
  cardSummaryLeft: { flex: 1, paddingRight: spacing.sm },
  cardTitle: { ...typography.h4, fontSize: 16, marginBottom: 4 },
  cardSub: { ...typography.bodySmall, marginBottom: 4 },
  cardDate: { ...typography.caption, color: colors.textMuted },
  cardSummaryRight: { alignItems: 'flex-end', gap: 6 },
  cardPrice: { ...typography.body, fontWeight: '700', color: colors.primary },
  statusBadge: {
    backgroundColor: colors.success + '20', paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: radii.full,
  },
  statusBadgeText: { color: colors.success, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  chevron: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },

  cardDetails: {
    padding: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  thumbRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  thumb: {
    flex: 1, height: 120, borderRadius: radii.md, overflow: 'hidden', position: 'relative',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbTag: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.full },
  thumbTagBefore: { backgroundColor: 'rgba(245, 158, 11, 0.9)' },
  thumbTagAfter: { backgroundColor: 'rgba(16, 185, 129, 0.9)' },
  thumbTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  detailRows: { gap: spacing.md, marginBottom: spacing.md },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailIcon: { fontSize: 16 },
  detailBody: { flex: 1 },
  detailLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.8 },
  detailValue: { ...typography.body, fontWeight: '600' },

  viewPhotosBtn: {
    backgroundColor: colors.primary + '15', borderRadius: radii.md,
    paddingVertical: spacing.sm + 2, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary + '40',
  },
  viewPhotosBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },

  emptyWrap: { flex: 1, minHeight: 240 },
  countLine: { ...typography.body, color: colors.textSecondary, fontWeight: '600', marginBottom: spacing.md },
});
