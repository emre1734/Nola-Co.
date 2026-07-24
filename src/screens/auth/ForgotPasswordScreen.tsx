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
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from '../../i18n/useTranslation';
import { colors, spacing, typography } from '../../theme';

interface ForgotPasswordScreenProps {
  onBack: () => void;
}

export function ForgotPasswordScreen({ onBack }: ForgotPasswordScreenProps) {
  const { sendPasswordReset } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) {
      setEmailError(t('auth.forgot.errEmailRequired'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError(t('auth.forgot.errEmailInvalid'));
      return;
    }
    setEmailError('');
    setLoading(true);
    const { error } = await sendPasswordReset(email.trim().toLowerCase());
    setLoading(false);
    if (error) {
      showToast(error, 'error');
    } else {
      setSent(true);
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
        {!sent ? (
          <>
            <View style={styles.header}>
              <Text style={styles.icon}>🔐</Text>
              <Text style={styles.title}>{t('auth.forgot.title')}</Text>
              <Text style={styles.subtitle}>
                {t('auth.forgot.subtitle')}
              </Text>
            </View>
            <View style={styles.form}>
              <Input
                label={t('auth.forgot.emailLabel')}
                placeholder={t('auth.forgot.emailPlaceholder')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                error={emailError}
              />
              <Button label={t('auth.forgot.sendLink')} onPress={handleSend} loading={loading} size="lg" />
            </View>
          </>
        ) : (
          <View style={styles.header}>
            <Text style={styles.icon}>📬</Text>
            <Text style={styles.title}>{t('auth.forgot.successTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('auth.forgot.successSubtitle')}{'\n'}
              <Text style={{ color: colors.primary }}>{email}</Text>
            </Text>
          </View>
        )}

        <TouchableOpacity onPress={onBack} style={styles.backWrap}>
          <Text style={styles.backText}>{t('auth.forgot.backToSignIn')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: spacing.xxl },
  icon: { fontSize: 56, marginBottom: spacing.md },
  title: { ...typography.h1, marginBottom: spacing.sm, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  form: { maxWidth: 420, width: '100%', alignSelf: 'center' },
  backWrap: { alignItems: 'center', marginTop: spacing.xl },
  backText: { ...typography.body, color: colors.primary, fontWeight: '600' },
});
