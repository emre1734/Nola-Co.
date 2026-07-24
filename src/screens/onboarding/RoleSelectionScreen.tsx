import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Button } from '../../components/ui';
import { useTranslation } from '../../i18n/useTranslation';
import { colors, spacing, typography, radii } from '../../theme';

interface RoleSelectionScreenProps {
  onSelect: (role: 'customer' | 'provider') => void;
}

export function RoleSelectionScreen({ onSelect }: RoleSelectionScreenProps) {
  const [selected, setSelected] = useState<'customer' | 'provider' | null>(null);
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brandName}>
          Wish<Text style={styles.brandAccent}>Wash</Text>
        </Text>
        <Text style={styles.title}>{t('onboarding.role.title')}</Text>
        <Text style={styles.subtitle}>{t('onboarding.role.subtitle')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.cardsContainer}>
        <TouchableOpacity
          style={[
            styles.roleCard,
            selected === 'customer' && styles.roleCardSelected,
          ]}
          onPress={() => setSelected('customer')}
          activeOpacity={0.85}
        >
          <View style={[styles.roleIconWrap, selected === 'customer' && styles.roleIconSelected]}>
            <Text style={styles.roleIcon}>🚗</Text>
          </View>
          <Text style={styles.roleName}>{t('onboarding.role.customer')}</Text>
          <Text style={styles.roleDesc}>
            {t('onboarding.role.customerDesc')}
          </Text>
          <View style={styles.featureList}>
            {[t('onboarding.role.customerFeature1'), t('onboarding.role.customerFeature2'), t('onboarding.role.customerFeature3')].map(f => (
              <View key={f} style={styles.featureRow}>
                <Text style={styles.featureCheck}>✓</Text>
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.roleCard,
            selected === 'provider' && styles.roleCardSelectedGreen,
          ]}
          onPress={() => setSelected('provider')}
          activeOpacity={0.85}
        >
          <View style={[styles.roleIconWrap, selected === 'provider' && styles.roleIconSelectedGreen]}>
            <Text style={styles.roleIcon}>💰</Text>
          </View>
          <Text style={styles.roleName}>{t('onboarding.role.partner')}</Text>
          <Text style={styles.roleDesc}>
            {t('onboarding.role.partnerDesc')}
          </Text>
          <View style={styles.featureList}>
            {[t('onboarding.role.partnerFeature1'), t('onboarding.role.partnerFeature2'), t('onboarding.role.partnerFeature3')].map(f => (
              <View key={f} style={styles.featureRow}>
                <Text style={[styles.featureCheck, { color: colors.accent }]}>✓</Text>
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={t('onboarding.role.continue')}
          onPress={() => selected && onSelect(selected)}
          disabled={!selected}
          size="lg"
          variant={selected === 'provider' ? 'primary' : 'primary'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingTop: spacing.xxl, alignItems: 'center' },
  brandName: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -1,
    marginBottom: spacing.md,
  },
  brandAccent: { color: colors.primary },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  cardsContainer: { padding: spacing.lg, gap: spacing.md },
  roleCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  roleCardSelected: {
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  roleCardSelectedGreen: {
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  roleIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  roleIconSelected: { backgroundColor: colors.primary + '30' },
  roleIconSelectedGreen: { backgroundColor: colors.accent + '30' },
  roleIcon: { fontSize: 30 },
  roleName: { ...typography.h3, marginBottom: spacing.xs },
  roleDesc: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 22 },
  featureList: { gap: 8 },
  featureRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  featureCheck: { color: colors.primary, fontWeight: '700', fontSize: 14, marginTop: 1 },
  featureText: { ...typography.bodySmall, flex: 1, color: colors.textSecondary },
  footer: { padding: spacing.lg, paddingBottom: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border },
});
