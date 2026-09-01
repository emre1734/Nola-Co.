import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Modal as RNModal,
  Platform,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import {
  pickSupportPhoto,
  validateSupportPhoto,
  uploadSupportPhoto,
  SUPPORT_PHOTO_MAX,
} from '../lib/support-photo';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

export const PROBLEM_CATEGORIES = [
  'Vehicle was not cleaned properly',
  'New damage',
  'Missing item',
  'Wrong service',
  'Partner behaviour',
  'Other',
] as const;

export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

const categoryKeyMap: Record<string, string> = {
  'Vehicle was not cleaned properly': 'support.catNotCleaned',
  'New damage': 'support.catNewDamage',
  'Missing item': 'support.catMissingItem',
  'Wrong service': 'support.catWrongService',
  'Partner behaviour': 'support.catPartnerBehaviour',
  'Other': 'support.catOther',
};

const DESC_MIN = 20;
const DESC_MAX = 1000;

interface SupportRequestFormProps {
  visible: boolean;
  bookingId: string | null;
  jobContext: { service_name: string | null; vehicle: { brand: string; model: string; plate: string } | null } | null;
  onClose: () => void;
  onSubmitted: () => void;
}

interface PendingPhoto {
  file: File;
  previewUrl: string;
}

export function SupportRequestForm({
  visible,
  bookingId,
  jobContext,
  onClose,
  onSubmitted,
}: SupportRequestFormProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const [category, setCategory] = useState<ProblemCategory | ''>('');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Prefill contact phone from the customer's profile and reset fields
  // whenever the form is (re)opened.
  useEffect(() => {
    if (visible) {
      setCategory('');
      setCategoryOpen(false);
      setDescription('');
      setPhone(profile?.phone ?? '');
      setPhotos([]);
    }
  }, [visible, profile?.phone]);

  const descLen = description.trim().length;
  const descValid = descLen >= DESC_MIN && descLen <= DESC_MAX;
  const phoneValid = phone.trim().length > 0;
  const canSubmit = !!category && descValid && phoneValid && !submitting && !!bookingId;

  const handlePickPhoto = async () => {
    if (photos.length >= SUPPORT_PHOTO_MAX) {
      showToast(t('support.errPhotoLimit', { max: SUPPORT_PHOTO_MAX }), 'error');
      return;
    }
    const file = await pickSupportPhoto();
    if (!file) return;
    const validationError = validateSupportPhoto(file);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setPhotos(prev => [...prev, { file, previewUrl }]);
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async () => {
    if (!bookingId) {
      showToast(t('support.errMissingJob'), 'error');
      return;
    }
    if (!category) {
      showToast(t('support.errNoCategory'), 'error');
      return;
    }
    if (!descValid) {
      showToast(
        descLen < DESC_MIN
          ? t('support.errDescShort', { min: DESC_MIN })
          : t('support.errDescLong', { max: DESC_MAX }),
        'error',
      );
      return;
    }
    if (!phoneValid) {
      showToast(t('support.errNoPhone'), 'error');
      return;
    }

    const userId = profile?.id;
    if (!userId) {
      showToast(t('support.errNoSession'), 'error');
      return;
    }

    setSubmitting(true);

    // Upload attached photos (up to 3) to the existing job-images bucket.
    let photoUrls: string[] = [];
    if (photos.length > 0) {
      setUploadingPhoto(true);
      const uploaded: string[] = [];
      let uploadFailed = false;
      for (const p of photos) {
        const result = await uploadSupportPhoto(userId, bookingId, p.file);
        if (result.error || !result.path) {
          uploadFailed = true;
          break;
        }
        uploaded.push(result.path);
      }
      setUploadingPhoto(false);
      if (uploadFailed) {
        setSubmitting(false);
        showToast(t('support.errPhotoUpload'), 'error');
        return;
      }
      photoUrls = uploaded;
    }

    // Submit the support request via the edge function. The job stays
    // in pending_approval and the booking status is not modified.
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: {
          action: 'submit_support_request',
          booking_id: bookingId,
          category,
          description: description.trim(),
          phone: phone.trim(),
          photo_urls: photoUrls,
        },
      });
      if (error || !data) {
        const err = error as { message?: string } | null;
        const msg = err?.message?.includes('does not belong')
          ? t('support.errNotYours')
          : err?.message?.includes('valid problem category')
            ? t('support.errInvalidCategory')
            : err?.message?.includes('at least 20')
              ? t('support.errDescShort', { min: DESC_MIN })
              : err?.message?.includes('at most 1000')
                ? t('support.errDescLong', { max: DESC_MAX })
                : t('support.errSubmit');
        setSubmitting(false);
        showToast(msg, 'error');
        return;
      }
      // Revoke preview object URLs before closing.
      for (const p of photos) URL.revokeObjectURL(p.previewUrl);
      setSubmitting(false);
      onSubmitted();
    } catch (err) {
      const e = err as { message?: string };
      console.error('[support-form] submit error:', e.message);
      setSubmitting(false);
      showToast(t('support.errNetwork'), 'error');
    }
  };

  const handleClose = () => {
    if (submitting) return;
    for (const p of photos) URL.revokeObjectURL(p.previewUrl);
    setCategoryOpen(false);
    onClose();
  };

  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>{t('support.title')}</Text>
              <Text style={styles.headerSubtitle}>
                {jobContext?.service_name ? `${jobContext.service_name}` : t('support.washServiceFallback')}
                {jobContext?.vehicle
                  ? ` · ${jobContext.vehicle.brand} ${jobContext.vehicle.model}${
                      jobContext.vehicle.plate ? ` · ${jobContext.vehicle.plate}` : ''
                    }`
                  : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose} disabled={submitting}>
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.formContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Category dropdown */}
            <Text style={styles.label}>{t('support.categoryLabel')}</Text>
            <TouchableOpacity
              style={[styles.selectBox, categoryOpen && styles.selectBoxOpen]}
              onPress={() => setCategoryOpen(o => !o)}
              activeOpacity={0.85}
            >
              <Text
                style={[styles.selectText, !category && styles.selectPlaceholder]}
                numberOfLines={1}
              >
                {category ? (categoryKeyMap[category] ? t(categoryKeyMap[category]) : category) : t('support.categoryPlaceholder')}
              </Text>
              <Text style={styles.selectChevron}>{categoryOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {categoryOpen && (
              <View style={styles.selectList}>
                {PROBLEM_CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.selectItem, category === c && styles.selectItemSelected]}
                    onPress={() => {
                      setCategory(c);
                      setCategoryOpen(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.selectItemText,
                        category === c && styles.selectItemTextSelected,
                      ]}
                    >
                      {categoryKeyMap[c] ? t(categoryKeyMap[c]) : c}
                    </Text>
                    {category === c && <Text style={styles.checkIcon}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Description */}
            <View style={styles.labelRow}>
              <Text style={styles.label}>{t('support.descriptionLabel')}</Text>
              <Text
                style={[
                  styles.counter,
                  descLen < DESC_MIN
                    ? styles.counterWarn
                    : descLen > DESC_MAX
                      ? styles.counterError
                      : styles.counterOk,
                ]}
              >
                {descLen}/{DESC_MAX}
              </Text>
            </View>
            <TextInput
              style={[styles.textarea, !descValid && description.length > 0 && styles.inputError]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('support.descriptionPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={5}
              maxLength={DESC_MAX}
              textAlignVertical="top"
              editable={!submitting}
            />
            {descLen < DESC_MIN && description.length > 0 && (
              <Text style={styles.hintError}>
                {t('support.descHint', { min: DESC_MIN, current: descLen })}
              </Text>
            )}

            {/* Contact phone */}
            <Text style={styles.label}>{t('support.phoneLabel')}</Text>
            <TextInput
              style={[styles.input, !phoneValid && phone.length > 0 && styles.inputError]}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('support.phonePlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
            />
            <Text style={styles.hint}>{t('support.phoneHint')}</Text>

            {/* Attach photos (optional, up to 3) */}
            <View style={styles.labelRow}>
              <Text style={styles.label}>{t('support.photoLabel')}</Text>
              <Text style={styles.counter}>{photos.length}/{SUPPORT_PHOTO_MAX}</Text>
            </View>
            <View style={styles.photoRow}>
              {photos.map((p, i) => (
                <View key={i} style={styles.photoTile}>
                  <Image source={{ uri: p.previewUrl }} style={styles.photoImg} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={() => handleRemovePhoto(i)}
                    disabled={submitting}
                  >
                    <Text style={styles.photoRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < SUPPORT_PHOTO_MAX && (
                <TouchableOpacity
                  style={styles.photoAdd}
                  onPress={handlePickPhoto}
                  disabled={submitting || uploadingPhoto}
                  activeOpacity={0.85}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <>
                      <Text style={styles.photoAddIcon}>+</Text>
                      <Text style={styles.photoAddText}>{t('common.add')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.hint}>
              {t('support.photoHint', { max: SUPPORT_PHOTO_MAX })}
            </Text>

            {/* Submit */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.cancelBtn, submitting && styles.btnDisabled]}
                onPress={handleClose}
                disabled={submitting}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelBtnText}>{t('support.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, (!canSubmit || submitting) && styles.btnDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit || submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <View style={styles.submitRow}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.submitBtnText}>{t('support.submitting')}</Text>
                  </View>
                ) : (
                  <Text style={styles.submitBtnText}>{t('support.submit')}</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.footerNote}>
              {t('support.footerNote')}
            </Text>
          </ScrollView>
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? spacing.lg : spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: { flex: 1, paddingRight: spacing.md },
  headerTitle: { ...typography.h3, marginBottom: 4 },
  headerSubtitle: { ...typography.bodySmall, color: colors.textSecondary },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },

  formContent: { padding: spacing.lg },

  label: { ...typography.bodySmall, fontWeight: '700', marginBottom: spacing.sm, marginTop: spacing.md },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  counter: { ...typography.caption, color: colors.textMuted },
  counterWarn: { color: colors.warning },
  counterError: { color: colors.error },
  counterOk: { color: colors.success },

  selectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectBoxOpen: { borderColor: colors.primary },
  selectText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  selectPlaceholder: { color: colors.textMuted },
  selectChevron: { color: colors.textMuted, fontSize: 10, marginLeft: spacing.sm },
  selectList: {
    marginTop: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  selectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  selectItemSelected: { backgroundColor: colors.primary + '12' },
  selectItemText: { ...typography.body, color: colors.textPrimary },
  selectItemTextSelected: { color: colors.primary, fontWeight: '700' },
  checkIcon: { color: colors.primary, fontWeight: '800', fontSize: 16 },

  textarea: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 110,
    ...typography.body,
    color: colors.textPrimary,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
  },
  inputError: { borderColor: colors.error },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  hintError: { ...typography.caption, color: colors.error, marginTop: spacing.xs },

  photoRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  photoTile: {
    width: 80,
    height: 80,
    borderRadius: radii.md,
    overflow: 'hidden',
    position: 'relative',
  },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  photoAdd: {
    width: 80,
    height: 80,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.primary + '60',
    borderStyle: 'dashed',
    backgroundColor: colors.primary + '0D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddIcon: { color: colors.primary, fontSize: 28, fontWeight: '300', lineHeight: 30 },
  photoAddText: { ...typography.caption, color: colors.primary, fontWeight: '600' },

  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  submitBtn: {
    flex: 1.4,
    backgroundColor: colors.error,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.55 },

  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
