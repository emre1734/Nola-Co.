import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { Button, Input } from '../../components/ui';
import { AvailabilitySection } from '../../components/AvailabilitySection';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from '../../i18n/useTranslation';
import { supabase } from '../../lib/supabase';
import { uploadAvatar, pickImageWeb } from '../../lib/avatar';
import { colors, spacing, typography, radii } from '../../theme';

interface ProviderOnboardingScreenProps {
  onComplete: () => void;
}

const RADIUS_OPTIONS = [5, 10, 15, 20, 30];

export function ProviderOnboardingScreen({ onComplete }: ProviderOnboardingScreenProps) {
  const { session, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [radius, setRadius] = useState(10);
  const [workingDays, setWorkingDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pickAvatar = async () => {
    const file = await pickImageWeb();
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = t('onboarding.provider.errFullNameRequired');
    if (!phone.trim()) errs.phone = t('onboarding.provider.errPhoneRequired');
    if (!bio.trim()) errs.bio = t('onboarding.provider.errBioRequired');
    if (workingDays.length === 0) errs.availability_days = t('availability.errDaysRequired');
    if (endTime <= startTime) errs.availability_time = t('availability.errEndBeforeStart');
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;

    if (!session) return;
    setLoading(true);

    let avatarUrl: string | null = null;
    if (avatarFile) {
      const { url, error } = await uploadAvatar(session.user.id, avatarFile);
      if (error) {
        showToast(t('onboarding.provider.errAvatarUpload') + error, 'error');
        setLoading(false);
        return;
      }
      avatarUrl = url;
    }

    // Update existing profile row to provider role
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ role: 'provider', updated_at: new Date().toISOString() })
      .eq('id', session.user.id);

    if (profileError) {
      showToast(t('onboarding.provider.errSaveProfile') + profileError.message, 'error');
      setLoading(false);
      return;
    }

    // Insert or update provider profile (no upsert — check existence first)
    const { data: existingProvider, error: checkError } = await supabase
      .from('provider_profiles')
      .select('id')
      .eq('profile_id', session.user.id)
      .maybeSingle();

    if (checkError) {
      showToast(t('onboarding.provider.errSaveProvider') + checkError.message, 'error');
      setLoading(false);
      return;
    }

    const providerPayload = {
      profile_id: session.user.id,
      bio: bio.trim(),
      service_radius: radius,
      status: 'offline',
      is_verified: true,
      working_days: workingDays,
      work_start_time: startTime,
      work_end_time: endTime,
    };

    let providerError: { message: string } | null = null;
    if (existingProvider) {
      const { error } = await supabase
        .from('provider_profiles')
        .update(providerPayload)
        .eq('profile_id', session.user.id);
      providerError = error;
    } else {
      const { error } = await supabase
        .from('provider_profiles')
        .insert(providerPayload);
      providerError = error;
    }

    setLoading(false);

    if (providerError) {
      showToast(t('onboarding.provider.errSaveProvider') + providerError.message, 'error');
      return;
    }

    await refreshProfile();
    showToast(t('onboarding.provider.successCreated'), 'success');
    onComplete();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.step}>{t('onboarding.provider.eyebrow')}</Text>
          <Text style={styles.title}>{t('onboarding.provider.title')}</Text>
          <Text style={styles.subtitle}>{t('onboarding.provider.subtitle')}</Text>
        </View>

        {/* Avatar */}
        <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} activeOpacity={0.85}>
          {avatarPreview ? (
            <Image source={{ uri: avatarPreview }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarIcon}>📷</Text>
              <Text style={styles.avatarHint}>{t('onboarding.provider.addPhoto')}</Text>
            </View>
          )}
          <View style={styles.avatarBadge}>
            <Text style={styles.avatarBadgeText}>+</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.form}>
          <Input
            label={t('onboarding.provider.fullNameLabel')}
            placeholder={t('onboarding.provider.fullNamePlaceholder')}
            value={fullName}
            onChangeText={setFullName}
            error={errors.fullName}
          />
          <Input
            label={t('onboarding.provider.phoneLabel')}
            placeholder={t('onboarding.provider.phonePlaceholder')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            error={errors.phone}
          />
          <Input
            label={t('onboarding.provider.bioLabel')}
            placeholder={t('onboarding.provider.bioPlaceholder')}
            value={bio}
            onChangeText={setBio}
            multiline
            numberOfLines={3}
            error={errors.bio}
            style={{ minHeight: 80, textAlignVertical: 'top' }}
          />

          {/* Service radius */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('onboarding.provider.serviceRadius')}</Text>
            <View style={styles.chipRow}>
              {RADIUS_OPTIONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, radius === r && styles.chipSelected]}
                  onPress={() => setRadius(r)}
                >
                  <Text style={[styles.chipText, radius === r && styles.chipTextSelected]}>
                    {r}{t('onboarding.provider.milesSuffix')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Availability */}
          <View style={styles.section}>
            <AvailabilitySection
              workingDays={workingDays}
              startTime={startTime}
              endTime={endTime}
              onChange={(days, start, end) => { setWorkingDays(days); setStartTime(start); setEndTime(end); }}
              errors={{ days: errors.availability_days, time: errors.availability_time }}
            />
          </View>

          <Button
            label={t('onboarding.provider.startEarning')}
            onPress={handleSubmit}
            loading={loading}
            size="lg"
            style={styles.cta}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: spacing.lg, alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: spacing.xl, width: '100%' },
  step: { ...typography.caption, color: colors.accent, letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.sm },
  title: { ...typography.h2, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  avatarWrap: { position: 'relative', marginBottom: spacing.xl },
  avatarImage: { width: 100, height: 100, borderRadius: 50 },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.borderLight,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  avatarIcon: { fontSize: 28 },
  avatarHint: { ...typography.caption, color: colors.textMuted },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  avatarBadgeText: { color: '#fff', fontWeight: '800', fontSize: 18, lineHeight: 20 },
  form: { width: '100%', maxWidth: 420 },
  section: { marginBottom: spacing.md },
  sectionLabel: { ...typography.label, marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  chipSelected: { backgroundColor: colors.primary + '20', borderColor: colors.primary },
  chipSelectedGreen: { backgroundColor: colors.accent + '20', borderColor: colors.accent },
  chipText: { ...typography.bodySmall, color: colors.textSecondary },
  chipTextSelected: { color: colors.textPrimary, fontWeight: '600' },
  errorText: { ...typography.bodySmall, color: colors.error, marginBottom: spacing.xs },
  cta: { marginTop: spacing.md },
});
