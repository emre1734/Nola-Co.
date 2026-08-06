import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

export interface LegalSection {
  heading: string;
  body: string;
}

interface LegalInfoScreenProps {
  title: string;
  eyebrow?: string;
  sections: LegalSection[];
  onClose: () => void;
}

export function LegalInfoScreen({ title, eyebrow, sections, onClose }: LegalInfoScreenProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.topTitleWrap}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <View style={styles.pilotBanner}>
            <Text style={styles.pilotText}>{t('legal.pilotBanner')}</Text>
          </View>

          {sections.map((s, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.sectionHeading}>{s.heading}</Text>
              <Text style={styles.sectionBody}>{s.body}</Text>
            </View>
          ))}

          <View style={styles.footerSpacer} />
        </ScrollView>

        <View style={styles.ackBar}>
          <Text style={styles.ackText}>
            {t('legal.readAck')}
          </Text>
          <TouchableOpacity style={styles.ackBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.ackBtnText}>{t('legal.backToForm')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

interface AcceptanceCheckboxProps {
  checked: boolean;
  onToggle: () => void;
  labelPrefix: string;
  linkText: string;
  onOpen: () => void;
}

export function AcceptanceCheckbox({
  checked,
  onToggle,
  labelPrefix,
  linkText,
  onOpen,
}: AcceptanceCheckboxProps) {
  return (
    <TouchableOpacity
      style={[styles.acceptRow, checked && styles.acceptRowActive]}
      onPress={onToggle}
      activeOpacity={0.85}
    >
      <View style={[styles.acceptBox, checked && styles.acceptBoxActive]}>
        {checked && <Text style={styles.acceptCheck}>✓</Text>}
      </View>
      <Text style={styles.acceptLabel}>
        {labelPrefix}{' '}
        <Text
          style={styles.acceptLink}
          onPress={(e: { stopPropagation?: () => void }) => {
            e.stopPropagation?.();
            onOpen();
          }}
        >
          {linkText}
        </Text>
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    zIndex: 9998,
    elevation: 9998,
  },
  flex: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '300' },
  topTitleWrap: { flex: 1, alignItems: 'center' },
  eyebrow: {
    ...typography.caption, color: colors.primary, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 2,
  },
  topTitle: { ...typography.h4 },

  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  pilotBanner: {
    backgroundColor: colors.warning + '15',
    borderWidth: 1, borderColor: colors.warning + '40',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  pilotText: { ...typography.caption, color: colors.warning, fontWeight: '600' },

  section: { marginBottom: spacing.lg },
  sectionHeading: { ...typography.h4, fontSize: 15, marginBottom: spacing.sm },
  sectionBody: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
  footerSpacer: { height: spacing.xl },

  ackBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  ackText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
  ackBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  ackBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // Acceptance checkbox row
  acceptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  acceptRowActive: { borderColor: colors.accent + '60', backgroundColor: colors.accent + '08' },
  acceptBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  acceptBoxActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  acceptCheck: { color: '#fff', fontWeight: '800', fontSize: 13 },
  acceptLabel: { ...typography.bodySmall, flex: 1, color: colors.textPrimary, lineHeight: 20 },
  acceptLink: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' as const },
});
