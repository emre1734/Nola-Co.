import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { useTranslation } from '../../i18n/useTranslation';
import { LANGUAGES } from '../../i18n';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../theme';

interface SettingsScreenProps {
  onBack: () => void;
  onSignOut: () => void;
}

export function SettingsScreen({ onBack, onSignOut }: SettingsScreenProps) {
  const { t, locale, setLocale } = useTranslation();
  const { permission, notificationsEnabled, setNotificationsEnabled, requestPermission } = useNotifications();
  const { session, emailVerified, resendVerification, profile } = useAuth();
  const { showToast } = useToast();
  const [resendCooldown, setResendCooldown] = useState(0);
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = async () => {
    if (!profile?.wishwash_id) return;
    try {
      await navigator.clipboard.writeText(profile.wishwash_id);
      setCopiedId(true);
      showToast(t('settings.wishwashIdCopied'), 'success');
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      showToast(t('settings.wishwashIdCopyFailed'), 'error');
    }
  };

  const handleResend = async () => {
    if (!session?.user?.email || resendCooldown > 0) return;
    const { error } = await resendVerification(session.user.email);
    if (error) {
      showToast(error, 'error');
    } else {
      showToast(t('auth.verification.resendSuccess'), 'success');
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown(prev => {
          if (prev <= 1) { clearInterval(interval); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{t('settings.title')}</Text>
        <View style={styles.backBtnPlaceholder} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Language section */}
        <Text style={styles.sectionTitle}>{t('settings.languageSection')}</Text>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t('settings.currentLanguage')}</Text>
          <Text style={styles.cardValue}>
            {LANGUAGES.find((l) => l.code === locale)?.label ?? locale}
          </Text>
        </View>

        <View style={styles.languageList}>
          {LANGUAGES.map((lang) => {
            const selected = lang.code === locale;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[styles.languageRow, selected && styles.languageRowActive]}
                onPress={() => setLocale(lang.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.languageFlag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.languageLabel,
                    selected && styles.languageLabelActive,
                  ]}
                >
                  {lang.label}
                </Text>
                {selected && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Notifications section */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
          {t('notifications.settingsSection')}
        </Text>
        <View style={styles.card}>
          <View style={styles.notificationRow}>
            <View style={styles.notificationInfo}>
              <Text style={styles.notificationLabel}>{t('notifications.masterToggle')}</Text>
              <Text style={styles.notificationHint}>
                {permission === 'granted'
                  ? t('notifications.enabled')
                  : permission === 'denied'
                    ? t('notifications.denied')
                    : permission === 'unsupported'
                      ? t('notifications.unsupported')
                      : t('notifications.notEnabled')}
              </Text>
            </View>
            <Switch
              value={notificationsEnabled && permission === 'granted'}
              onValueChange={async (val) => {
                if (val && permission !== 'granted') {
                  await requestPermission();
                } else {
                  await setNotificationsEnabled(val);
                }
              }}
              disabled={permission === 'unsupported'}
              trackColor={{ false: colors.borderLight, true: colors.primary }}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.notificationRow}>
            <Text style={styles.notificationLabel}>{t('notifications.reservationUpdates')}</Text>
          </View>
          <View style={styles.notificationRow}>
            <Text style={styles.notificationLabel}>{t('notifications.serviceStatusUpdates')}</Text>
          </View>
        </View>

        {/* Account section */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
          {t('settings.accountSection')}
        </Text>
        <View style={styles.card}>
          <View style={styles.notificationRow}>
            <View style={styles.notificationInfo}>
              <Text style={styles.notificationLabel}>{t('settings.wishwashIdLabel')}</Text>
              <Text style={styles.wishwashIdValue}>
                {profile?.wishwash_id ?? '—'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.copyBtn, copiedId && styles.copyBtnDone]}
              onPress={handleCopyId}
              activeOpacity={0.7}
              disabled={!profile?.wishwash_id}
            >
              <Text style={styles.copyBtnText}>
                {copiedId ? t('settings.wishwashIdCopiedShort') : t('settings.wishwashIdCopy')}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />
          <View style={styles.notificationRow}>
            <View style={styles.notificationInfo}>
              <Text style={styles.notificationLabel}>{t('settings.emailStatus')}</Text>
              <Text style={styles.notificationHint}>
                {emailVerified ? t('auth.verification.verified') : t('auth.verification.notVerified')}
              </Text>
            </View>
            <Text style={emailVerified ? styles.verifiedBadge : styles.unverifiedBadge}>
              {emailVerified ? '✅' : '⚠️'}
            </Text>
          </View>
          {!emailVerified && (
            <>
              <View style={styles.divider} />
              <Button
                label={resendCooldown > 0
                  ? t('auth.verification.resendCooldown').replace('{{seconds}}', String(resendCooldown))
                  : t('auth.verification.resendButton')}
                onPress={handleResend}
                size="md"
                style={styles.resendBtn}
              />
            </>
          )}
        </View>

        {/* Supported Countries section */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
          {t('settings.supportedCountries')}
        </Text>
        <View style={styles.card}>
          <View style={styles.countryRow}>
            <Text style={styles.countryFlag}>🇹🇷</Text>
            <Text style={styles.countryName}>{t('settings.turkey')}</Text>
            <Text style={styles.countryCheck}>{t('settings.turkeySupported')}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.countryRow}>
            <Text style={styles.countryFlag}>🌏</Text>
            <Text style={styles.countryNameMuted}>{t('settings.moreCountries')}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { color: colors.textPrimary, fontSize: 32, fontWeight: '300' },
  topBarTitle: { ...typography.h4, flex: 1, textAlign: 'center' },
  backBtnPlaceholder: { width: 40 },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },

  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  cardLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 4 },
  cardValue: { ...typography.body, fontWeight: '600', color: colors.textPrimary },

  languageList: { gap: spacing.sm },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: spacing.md,
  },
  languageRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '12',
  },
  languageFlag: { fontSize: 24 },
  languageLabel: { ...typography.body, flex: 1, color: colors.textPrimary },
  languageLabelActive: { fontWeight: '700', color: colors.primary },
  checkmark: { color: colors.primary, fontSize: 18, fontWeight: '800' },

  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  countryFlag: { fontSize: 22 },
  countryName: { ...typography.body, flex: 1, color: colors.textPrimary, fontWeight: '600' },
  countryCheck: { fontSize: 16 },
  countryNameMuted: { ...typography.bodySmall, flex: 1, color: colors.textSecondary, fontStyle: 'italic' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  notificationInfo: { flex: 1, paddingRight: spacing.md },
  notificationLabel: { ...typography.body, fontWeight: '600' },
  notificationHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  wishwashIdValue: {
    ...typography.h4,
    color: colors.primary,
    letterSpacing: 1.5,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  copyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    alignSelf: 'center',
  },
  copyBtnDone: { backgroundColor: colors.success },
  copyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  verifiedBadge: { fontSize: 24 },
  unverifiedBadge: { fontSize: 24 },
  resendBtn: { marginTop: spacing.sm },
});
