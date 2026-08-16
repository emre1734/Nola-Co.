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
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { uploadAvatar, pickImageWeb } from '../../lib/avatar';
import { colors, spacing, typography, radii } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';

interface CustomerOnboardingScreenProps {
  onComplete: () => void;
}

export function CustomerOnboardingScreen({ onComplete }: CustomerOnboardingScreenProps) {
  const { session, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
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
    if (!fullName.trim()) errs.fullName = t('onboarding.profile.errFullNameRequired');
    if (!phone.trim()) errs.phone = t('onboarding.profile.errPhoneRequired');
    if (!city.trim()) errs.city = t('onboarding.profile.errCityRequired');
    return errs;
  };

  const handleSubmit = async () => {
    console.log('START_BUTTON_PRESSED');
    console.log('VALIDATION_STARTED');
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      console.log('VALIDATION_FAILED', errs);
      return;
    }
    console.log('VALIDATION_SUCCESS');

    if (!session) {
      console.log('PROFILE_SAVE_ERROR', 'No session');
      showToast(t('common.notAuthenticated'), 'error');
      return;
    }

    console.log('PROFILE_SAVE_STARTED');
    setLoading(true);
    try {
      let avatarUrl: string | null = null;
      if (avatarFile) {
        const { url, error } = await uploadAvatar(session.user.id, avatarFile);
        if (error) {
          console.log('PROFILE_SAVE_ERROR', 'Avatar: ' + error);
          showToast(t('onboarding.profile.errAvatarUpload') + error, 'error');
          return;
        }
        avatarUrl = url;
      }

      const { error: insertError } = await supabase.from('profiles').upsert({
        id: session.user.id,
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: session.user.email,
        city: city.trim(),
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        updated_at: new Date().toISOString(),
      });

      if (insertError) {
        console.log('PROFILE_SAVE_ERROR', insertError.message);
        showToast(t('onboarding.profile.errSaveProfile') + insertError.message, 'error');
        return;
      }

      console.log('PROFILE_SAVE_SUCCESS');
      await refreshProfile();
      showToast(t('onboarding.profile.successSaved'), 'success');

      console.log('NAVIGATION_STARTED');
      onComplete();
      console.log('NAVIGATION_SUCCESS');
    } catch (err) {
      const e = err as { message?: string };
      console.log('PROFILE_SAVE_ERROR', e?.message ?? 'Unexpected error');
      showToast(t('onboarding.profile.errSaveProfile') + (e?.message ?? 'Unexpected error'), 'error');
    } finally {
      setLoading(false);
    }
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
          <Text style={styles.step}>{t('onboarding.profile.eyebrowCustomer')}</Text>
          <Text style={styles.title}>{t('onboarding.profile.titleCustomer')}</Text>
          <Text style={styles.subtitle}>{t('onboarding.profile.subtitleCustomer')}</Text>
        </View>

        {/* Avatar picker */}
        <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} activeOpacity={0.85}>
          {avatarPreview ? (
            <Image source={{ uri: avatarPreview }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarIcon}>📷</Text>
              <Text style={styles.avatarHint}>{t('onboarding.profile.addPhoto')}</Text>
            </View>
          )}
          <View style={styles.avatarBadge}>
            <Text style={styles.avatarBadgeText}>+</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.form}>
          <Input
            label={t('onboarding.profile.fullNameLabel')}
            placeholder={t('onboarding.profile.fullNamePlaceholder')}
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
            error={errors.fullName}
          />
          <Input
            label={t('onboarding.profile.phoneLabel')}
            placeholder={t('onboarding.profile.phonePlaceholder')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            error={errors.phone}
          />
          <Input
            label={t('onboarding.profile.cityLabel')}
            placeholder={t('onboarding.profile.cityPlaceholder')}
            value={city}
            onChangeText={setCity}
            error={errors.city}
          />

          <Button
            label={t('onboarding.profile.getStarted')}
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
  step: { ...typography.caption, color: colors.primary, letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.sm },
  title: { ...typography.h2, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  avatarWrap: {
    position: 'relative',
    marginBottom: spacing.xl,
  },
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
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  avatarBadgeText: { color: '#fff', fontWeight: '800', fontSize: 18, lineHeight: 20 },
  form: { width: '100%', maxWidth: 420 },
  cta: { marginTop: spacing.sm },
});
