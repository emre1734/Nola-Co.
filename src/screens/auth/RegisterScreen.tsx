import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Button, Input } from '../../components/ui';
import { LegalInfoScreen, AcceptanceCheckbox, type LegalSection } from '../../components/LegalInfo';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from '../../i18n/useTranslation';
import { colors, spacing, typography } from '../../theme';

interface RegisterScreenProps {
  onNavigate: (screen: 'login') => void;
  onSuccess: (email: string) => void;
}

export function RegisterScreen({ onNavigate, onSuccess }: RegisterScreenProps) {
  const { signUp, loading } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [legalView, setLegalView] = useState<'terms' | 'privacy' | null>(null);

  const validate = (email: string, password: string, confirm: string) => {
    const errors: { email?: string; password?: string; confirm?: string } = {};
    if (!email.trim()) errors.email = t('auth.register.errEmailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = t('auth.register.errEmailInvalid');
    if (!password) errors.password = t('auth.register.errPasswordRequired');
    else if (password.length < 8) errors.password = t('auth.register.errPasswordShort');
    if (password !== confirm) errors.confirm = t('auth.register.errPasswordMismatch');
    return errors;
  };

  const TERMS_SECTIONS: LegalSection[] = [
    {
      heading: t('legal.terms.t1Title'),
      body: t('legal.terms.t1Body'),
    },
    {
      heading: t('legal.terms.t2Title'),
      body: t('legal.terms.t2Body'),
    },
    {
      heading: t('legal.terms.t3Title'),
      body: t('legal.terms.t3Body'),
    },
    {
      heading: t('legal.terms.t4Title'),
      body: t('legal.terms.t4Body'),
    },
    {
      heading: t('legal.terms.t5Title'),
      body: t('legal.terms.t5Body'),
    },
    {
      heading: t('legal.terms.t6Title'),
      body: t('legal.terms.t6Body'),
    },
  ];

  const PRIVACY_SECTIONS: LegalSection[] = [
    {
      heading: t('legal.privacy.p1Title'),
      body: t('legal.privacy.p1Body'),
    },
    {
      heading: t('legal.privacy.p2Title'),
      body: t('legal.privacy.p2Body'),
    },
    {
      heading: t('legal.privacy.p3Title'),
      body: t('legal.privacy.p3Body'),
    },
    {
      heading: t('legal.privacy.p4Title'),
      body: t('legal.privacy.p4Body'),
    },
    {
      heading: t('legal.privacy.p5Title'),
      body: t('legal.privacy.p5Body'),
    },
    {
      heading: t('legal.privacy.p6Title'),
      body: t('legal.privacy.p6Body'),
    },
  ];

  const handleRegister = async () => {
    const errs = validate(email, password, confirm);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!acceptedTerms) {
      showToast(t('auth.register.errAcceptTerms'), 'error');
      return;
    }

    const { error, session } = await signUp(email.trim().toLowerCase(), password);
    if (error) {
      if (error.includes('already registered')) {
        showToast(t('auth.register.errEmailExists'), 'error');
      } else {
        showToast(error, 'error');
      }
    } else if (session) {
      onSuccess(email.trim().toLowerCase());
    } else {
      showToast(t('common.notAuthenticated'), 'error');
    }
  };

  return (
    <>
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
          <Text style={styles.brandName}>
            Wish<Text style={styles.brandAccent}>Wash</Text>
          </Text>
          <Text style={styles.title}>{t('auth.register.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.register.subtitle')}</Text>
        </View>

        <View style={styles.form}>
          <Input
            label={t('auth.register.emailLabel')}
            placeholder={t('auth.register.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            error={errors.email}
            autoComplete="email"
          />
          <Input
            label={t('auth.register.passwordLabel')}
            placeholder={t('auth.register.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secure
            error={errors.password}
          />
          <Input
            label={t('auth.register.confirmPasswordLabel')}
            placeholder={t('auth.register.confirmPasswordPlaceholder')}
            value={confirm}
            onChangeText={setConfirm}
            secure
            error={errors.confirm}
          />

          <AcceptanceCheckbox
            checked={acceptedTerms}
            onToggle={() => setAcceptedTerms(v => !v)}
            labelPrefix={t('auth.register.acceptTerms')}
            linkText={t('auth.register.termsLink')}
            onOpen={() => setLegalView('terms')}
          />
          <TouchableOpacity
            style={styles.privacyHint}
            onPress={() => setLegalView('privacy')}
            activeOpacity={0.7}
          >
            <Text style={styles.privacyHintText}>{t('auth.register.privacyLink')}</Text>
          </TouchableOpacity>

          <Button
            label={t('auth.register.createAccount')}
            onPress={handleRegister}
            loading={loading}
            size="lg"
            style={styles.cta}
          />

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>{t('auth.register.haveAccount')}</Text>
            <TouchableOpacity onPress={() => onNavigate('login')}>
              <Text style={styles.switchLink}> {t('auth.register.signIn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>

      {legalView === 'terms' && (
        <LegalInfoScreen
          title={t('legal.termsTitle')}
          eyebrow={t('legal.termsEyebrow')}
          sections={TERMS_SECTIONS}
          onClose={() => setLegalView(null)}
        />
      )}
      {legalView === 'privacy' && (
        <LegalInfoScreen
          title={t('legal.privacyTitle')}
          eyebrow={t('legal.privacyEyebrow')}
          sections={PRIVACY_SECTIONS}
          onClose={() => setLegalView(null)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: spacing.xxl },
  brandName: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -1,
    marginBottom: spacing.lg,
  },
  brandAccent: { color: colors.primary },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  form: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  cta: { marginTop: spacing.sm },
  privacyHint: { alignSelf: 'flex-start', marginTop: spacing.xs, marginBottom: spacing.sm, paddingVertical: 4 },
  privacyHintText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  switchText: { ...typography.body, color: colors.textSecondary },
  switchLink: { ...typography.body, color: colors.primary, fontWeight: '600' },
});
