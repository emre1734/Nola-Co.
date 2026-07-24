import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { EmptyState, Loading } from '../../components/ui';
import { Modal } from '../../components/ui/Modal';
import { SupportRequestForm } from '../../components/SupportRequestForm';
import { PhotoViewer, BeforeAfterCompare } from '../../components/PhotoViewer';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, typography, radii } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';

interface SupportRequestSummary {
  id: string;
  status: string;
  created_at: string;
}

interface ApprovalJob {
  id: string;
  booking_id: string;
  status: 'pending_approval';
  before_photo_url: string | null;
  after_photo_url: string | null;
  completed_at: string | null;
  updated_at: string | null;
  estimated_price: number | null;
  service_name: string | null;
  vehicle: { brand: string; model: string; plate: string; color: string | null } | null;
  provider_name: string | null;
  has_support_request: boolean;
  support_request: SupportRequestSummary | null;
}

interface ApprovalCenterScreenProps {
  onBack: () => void;
  onSignOut: () => void;
}

export function ApprovalCenterScreen({ onBack, onSignOut }: ApprovalCenterScreenProps) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const { showToast } = useToast();

  const [jobs, setJobs] = useState<ApprovalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [problemTarget, setProblemTarget] = useState<ApprovalJob | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [submittedIds, setSubmittedIds] = useState<Record<string, SupportRequestSummary | true>>({});
  // Tracks jobs approved during this session — shows the completion state
  // until the server refresh removes them from the pending list.
  const [completedIds, setCompletedIds] = useState<Record<string, boolean>>({});
  const [viewer, setViewer] = useState<{ images: { uri: string; label: string }[]; index: number } | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { action: 'list_customer_approvals' },
      });
      if (error || !data) {
        const err = error as { message?: string } | null;
        console.error('[approval-center] load failed:', err?.message);
        setJobs([]);
        return;
      }
      const result = data as { success?: boolean; jobs?: ApprovalJob[] };
      setJobs(result.jobs ?? []);
      setSubmittedIds(prev => {
        const next = { ...prev };
        for (const j of result.jobs ?? []) {
          if (j.has_support_request) next[j.id] = j.support_request ?? true;
          else delete next[j.id];
        }
        return next;
      });
    } catch (err) {
      const e = err as { message?: string };
      console.error('[approval-center] load error:', e.message);
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    fetchJobs().finally(() => setLoading(false));
  }, [fetchJobs]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchJobs();
    setRefreshing(false);
  };

  const handleApprove = async (job: ApprovalJob) => {
    if (approvingId || job.status !== 'pending_approval') return;
    setApprovingId(job.id);
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { action: 'approve_job', booking_id: job.booking_id },
      });
      if (error || !data) {
        const err = error as { message?: string } | null;
        const msg = err?.message?.includes('does not belong')
          ? t('approvals.errNotYours')
          : err?.message?.includes('expected pending_approval')
            ? t('approvals.errAlreadyApproved')
            : t('approvals.errApproveFailed');
        showToast(msg, 'error');
        return;
      }
      setCompletedIds(prev => ({ ...prev, [job.id]: true }));
      showToast(t('approvals.successApproved'), 'success');
      await fetchJobs();
    } catch (err) {
      const e = err as { message?: string };
      console.error('[approval-center] approve error:', e.message);
      showToast(t('approvals.errNetwork'), 'error');
    } finally {
      setApprovingId(null);
    }
  };

  const handleReportSubmitted = async () => {
    if (!problemTarget) return;
    const job = problemTarget;
    setProblemTarget(null);
    setSubmittedIds(prev => ({ ...prev, [job.id]: true }));
    showToast(t('approvals.successReport'), 'success');
    await fetchJobs();
  };

  const handleLogout = async () => {
    setShowLogout(false);
    await signOut();
    onSignOut();
  };

  const openPhotoViewer = (images: { uri: string; label: string }[], index: number) => {
    if (images.length === 0) {
      showToast(t('approvals.noPhoto'), 'info');
      return;
    }
    setViewer({ images, index });
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  if (loading) return <Loading fullScreen message={t('approvals.loading')} />;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('approvals.title')}</Text>
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
        {jobs.length === 0 && Object.keys(completedIds).length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="✅"
              title={t('approvals.emptyTitle')}
              subtitle={t('approvals.emptySubtitle')}
            />
          </View>
        ) : (
          <>
            <Text style={styles.countLine}>
              {jobs.length} {jobs.length === 1 ? t('approvals.serviceSingular') : t('approvals.servicePlural')} {t('approvals.waitingSuffix')}
            </Text>
            <View style={styles.cardList}>
              {jobs.map(job => {
                const submitted = !!submittedIds[job.id] || job.has_support_request;
                const justCompleted = !!completedIds[job.id];
                const photos: { uri: string; label: string }[] = [];
                if (job.before_photo_url) photos.push({ uri: job.before_photo_url, label: t('approvals.before') });
                if (job.after_photo_url) photos.push({ uri: job.after_photo_url, label: t('approvals.after') });
                const hasPhotos = photos.length > 0;

                return (
                  <View key={job.id} style={styles.approvalCard}>
                    {justCompleted ? (
                      <View style={styles.completedState}>
                        <View style={styles.completedIconWrap}>
                          <Text style={styles.completedIcon}>✅</Text>
                        </View>
                        <Text style={styles.completedTitle}>{t('approvals.completedTitle')}</Text>
                        <Text style={styles.completedText}>
                          {t('approvals.completedBody')}
                        </Text>
                        <Text style={styles.completedSub}>{t('approvals.completedSub')}</Text>
                      </View>
                    ) : (
                      <>
                        {/* Card header */}
                        <View style={styles.cardHeader}>
                          <View style={styles.cardHeaderLeft}>
                            <Text style={styles.cardEyebrow}>{t('approvals.readyEyebrow')}</Text>
                            <Text style={styles.cardTitle}>
                              {job.service_name ?? t('approvals.washServiceFallback')}
                            </Text>
                          </View>
                          <View style={styles.statusPill}>
                            <View style={styles.statusDot} />
                            <Text style={styles.statusPillText}>{t('approvals.statusPending')}</Text>
                          </View>
                        </View>

                        {/* Swipeable before/after comparison */}
                        <BeforeAfterCompare
                          beforeUrl={job.before_photo_url}
                          afterUrl={job.after_photo_url}
                          onPhotoPress={openPhotoViewer}
                        />

                        {/* Details grid */}
                        <View style={styles.detailsGrid}>
                          {job.vehicle && (
                            <View style={styles.detailRow}>
                              <Text style={styles.detailIcon}>🚗</Text>
                              <View style={styles.detailBody}>
                                <Text style={styles.detailLabel}>{t('approvals.detailVehicle')}</Text>
                                <Text style={styles.detailValue}>
                                  {job.vehicle.brand} {job.vehicle.model}
                                  {job.vehicle.plate ? ` · ${job.vehicle.plate}` : ''}
                                </Text>
                              </View>
                            </View>
                          )}
                          {job.service_name && (
                            <View style={styles.detailRow}>
                              <Text style={styles.detailIcon}>🧽</Text>
                              <View style={styles.detailBody}>
                                <Text style={styles.detailLabel}>{t('approvals.detailService')}</Text>
                                <Text style={styles.detailValue}>{job.service_name}</Text>
                              </View>
                            </View>
                          )}
                          {job.provider_name && (
                            <View style={styles.detailRow}>
                              <Text style={styles.detailIcon}>👤</Text>
                              <View style={styles.detailBody}>
                                <Text style={styles.detailLabel}>{t('approvals.detailPartner')}</Text>
                                <Text style={styles.detailValue}>{job.provider_name}</Text>
                              </View>
                            </View>
                          )}
                          {job.updated_at && (
                            <View style={styles.detailRow}>
                              <Text style={styles.detailIcon}>🕐</Text>
                              <View style={styles.detailBody}>
                                <Text style={styles.detailLabel}>{t('approvals.detailCompletedAt')}</Text>
                                <Text style={styles.detailValue}>{formatTime(job.updated_at)}</Text>
                              </View>
                            </View>
                          )}
                        </View>

                        {/* Price */}
                        {job.estimated_price != null && (
                          <View style={styles.priceBar}>
                            <Text style={styles.priceLabel}>{t('approvals.totalLabel')}</Text>
                            <Text style={styles.priceValue}>₺{job.estimated_price}</Text>
                          </View>
                        )}

                        {/* Actions or submitted state */}
                        {submitted ? (
                          <View style={styles.submittedBox}>
                            <Text style={styles.submittedTitle}>{t('approvals.submittedTitle')}</Text>
                            <Text style={styles.submittedText}>
                              {t('approvals.submittedBody1')}{'\n'}{t('approvals.submittedBody2')}
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.actions}>
                            <TouchableOpacity
                              style={[styles.approveBtn, approvingId === job.id && styles.btnDisabled]}
                              onPress={() => handleApprove(job)}
                              disabled={approvingId === job.id}
                              activeOpacity={0.85}
                            >
                              {approvingId === job.id ? (
                                <View style={styles.btnRow}>
                                  <ActivityIndicator color="#fff" size="small" />
                                  <Text style={styles.approveBtnText}>{t('approvals.approving')}</Text>
                                </View>
                              ) : (
                                <Text style={styles.approveBtnText}>{t('approvals.approve')}</Text>
                              )}
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.reportBtn}
                              onPress={() => setProblemTarget(job)}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.reportBtnText}>{t('approvals.report')}</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {!hasPhotos && !submitted && (
                          <Text style={styles.missingPhotoNote}>
                            {t('approvals.noPhotos')}
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <SupportRequestForm
        visible={!!problemTarget}
        bookingId={problemTarget?.booking_id ?? null}
        jobContext={
          problemTarget
            ? {
                service_name: problemTarget.service_name,
                vehicle: problemTarget.vehicle
                  ? {
                      brand: problemTarget.vehicle.brand,
                      model: problemTarget.vehicle.model,
                      plate: problemTarget.vehicle.plate,
                    }
                  : null,
              }
            : null
        }
        onClose={() => setProblemTarget(null)}
        onSubmitted={handleReportSubmitted}
      />

      <PhotoViewer
        visible={!!viewer}
        images={viewer?.images ?? []}
        startIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />

      <Modal
        visible={showLogout}
        onClose={() => setShowLogout(false)}
        title={t('approvals.logoutTitle')}
        message={t('approvals.logoutMessage')}
        confirmLabel={t('approvals.logoutConfirm')}
        cancelLabel={t('approvals.logoutCancel')}
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
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '300' },
  topTitle: { ...typography.h4 },
  avatarPlaceholder: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '700', fontSize: 16 },

  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  emptyWrap: { flex: 1, minHeight: 400 },
  countLine: { ...typography.body, color: colors.textSecondary, fontWeight: '600', marginBottom: spacing.md },
  cardList: { gap: spacing.lg },

  // Premium card
  approvalCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.primary + '35',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cardHeaderLeft: { flex: 1, paddingRight: spacing.sm },
  cardEyebrow: {
    ...typography.caption, color: colors.primary, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4,
  },
  cardTitle: { ...typography.h3, fontSize: 18 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.warning + '20',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.full,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
  statusPillText: { color: colors.warning, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },

  // Details grid
  detailsGrid: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailIcon: { fontSize: 18 },
  detailBody: { flex: 1 },
  detailLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.8 },
  detailValue: { ...typography.body, fontWeight: '600' },

  // Price bar
  priceBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primary + '12',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  priceLabel: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  priceValue: { ...typography.h3, color: colors.primary, fontSize: 22 },

  // Actions
  actions: { flexDirection: 'row', gap: spacing.sm },
  approveBtn: {
    flex: 1.5,
    backgroundColor: colors.success,
    borderRadius: radii.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center', justifyContent: 'center',
  },
  approveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  reportBtn: {
    flex: 1,
    backgroundColor: colors.error + '18',
    borderRadius: radii.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.error + '50',
  },
  reportBtnText: { color: colors.error, fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.55 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  missingPhotoNote: { ...typography.caption, color: colors.warning, textAlign: 'center', marginTop: spacing.sm },

  // Submitted state
  submittedBox: {
    backgroundColor: colors.warning + '15',
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.warning + '50',
    alignItems: 'center',
  },
  submittedTitle: { ...typography.body, fontWeight: '700', color: colors.warning, marginBottom: 6, textAlign: 'center' },
  submittedText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  // Completed state
  completedState: { alignItems: 'center', paddingVertical: spacing.xl },
  completedIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.success + '20',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  completedIcon: { fontSize: 36 },
  completedTitle: { ...typography.h3, color: colors.success, marginBottom: 8, textAlign: 'center' },
  completedText: { ...typography.body, color: colors.textPrimary, textAlign: 'center', marginBottom: 6 },
  completedSub: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
