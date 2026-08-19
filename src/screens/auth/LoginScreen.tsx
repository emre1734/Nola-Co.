import React, { useState, useEffect, useRef } from 'react';
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
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from '../../i18n/useTranslation';
import { colors, spacing, typography, radii } from '../../theme';

interface LoginScreenProps {
  onNavigate: (screen: 'register' | 'forgotPassword') => void;
  onSuccess: () => void;
}

export function LoginScreen({ onNavigate, onSuccess }: LoginScreenProps) {
  const { signIn, resendVerification, loading, session } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const loginSuccessRef = useRef(false);

  useEffect(() => {
    if (session && loginSuccessRef.current) {
      console.log('LOGIN_NAVIGATION_TRIGGERED', { hasSession: !!session, ts: Date.now() });
      loginSuccessRef.current = false;
      console.log('LOGIN_ONSUCCESS_CALLED', { ts: Date.now() });
      onSuccess();
    }
  }, [session, onSuccess]);

  const validate = (email: string, password: string) => {
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = t('auth.login.errEmailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = t('auth.login.errEmailInvalid');
    if (!password) errors.password = t('auth.login.errPasswordRequired');
    else if (password.length < 6) errors.password = t('auth.login.errPasswordShort');
    return errors;
  };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const startResendCooldown = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    if (!unverifiedEmail || resendCooldown > 0) return;
    const { error } = await resendVerification(unverifiedEmail);
    if (error) {
      showToast(error, 'error');
    } else {
      showToast(t('auth.verification.resendSuccess'), 'success');
      startResendCooldown();
    }
  };

  const handleLogin = async () => {
    console.log('LOGIN_SUBMIT_START', { ts: Date.now() });
    const errs = validate(email, password);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const { error, emailNotVerified } = await signIn(email.trim().toLowerCase(), password);
    console.log('LOGIN_SCREEN_SIGNIN_RESOLVED', {
      hasError: !!error,
      hasEmailNotVerified: !!emailNotVerified,
      ts: Date.now(),
    });
    if (emailNotVerified) {
      setUnverifiedEmail(email.trim().toLowerCase());
      startResendCooldown();
    } else if (error) {
      showToast(
        error.includes('Invalid login') ? t('auth.login.errInvalidCredentials') : error,
        'error'
      );
    } else {
      showToast(t('auth.login.successWelcome'), 'success');
      loginSuccessRef.current = true;
      console.log('LOGIN_SUCCESS_REF_SET', { ts: Date.now() });
    }
    console.log('LOGIN_SUBMIT_FINALLY', { ts: Date.now() });
  };

  if (unverifiedEmail) {
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
            <Text style={styles.brandName}>
              Wish<Text style={styles.brandAccent}>Wash</Text>
            </Text>
            <Text style={styles.title}>{t('auth.verification.blockedTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.verification.blockedBody')}</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.verificationCard}>
              <Text style={styles.verificationEmail}>{unverifiedEmail}</Text>
            </View>

            <Button
              label={resendCooldown > 0
                ? t('auth.verification.resendCooldown').replace('{{seconds}}', String(resendCooldown))
                : t('auth.verification.resendButton')}
              onPress={handleResend}
              loading={loading}
              size="lg"
              style={styles.cta}
            />

            <TouchableOpacity onPress={() => { setUnverifiedEmail(null); setResendCooldown(0); }} style={styles.switchRow}>
              <Text style={styles.switchLink}>{t('auth.verification.backToLogin')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

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
          <Text style={styles.brandName}>
            Wish<Text style={styles.brandAccent}>Wash</Text>
          </Text>
          <Text style={styles.title}>{t('auth.login.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.login.subtitle')}</Text>
        </View>

        <View style={styles.form}>
          <Input
            label={t('auth.login.emailLabel')}
            placeholder={t('auth.login.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            error={errors.email}
            autoComplete="email"
          />
          <Input
            label={t('auth.login.passwordLabel')}
            placeholder={t('auth.login.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secure
            error={errors.password}
          />

          <TouchableOpacity
            onPress={() => onNavigate('forgotPassword')}
            style={styles.forgotWrap}
          >
            <Text style={styles.forgotText}>{t('auth.login.forgotPassword')}</Text>
          </TouchableOpacity>

          <Button
            label={t('auth.login.signIn')}
            onPress={handleLogin}
            loading={loading}
            size="lg"
            style={styles.cta}
          />

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.orText}>{t('common.or')}</Text>
            <View style={styles.line} />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>{t('auth.login.noAccount')}</Text>
            <TouchableOpacity onPress={() => onNavigate('register')}>
              <Text style={styles.switchLink}> {t('auth.login.signUp')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  forgotWrap: { alignSelf: 'flex-end', marginBottom: spacing.lg, marginTop: -spacing.sm },
  forgotText: { ...typography.label, color: colors.primary },
  cta: { marginTop: spacing.sm },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
    gap: spacing.sm,
  },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { ...typography.caption, color: colors.textMuted },
  switchRow: { flexDirection: 'row', justifyContent: 'center' },
  switchText: { ...typography.body, color: colors.textSecondary },
  switchLink: { ...typography.body, color: colors.primary, fontWeight: '600' },
  verificationCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  verificationEmail: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
});
