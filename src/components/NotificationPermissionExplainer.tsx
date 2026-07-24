import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

interface NotificationPermissionExplainerProps {
  onEnable: () => void;
  onDismiss: () => void;
}

export function NotificationPermissionExplainer({
  onEnable,
  onDismiss,
}: NotificationPermissionExplainerProps) {
  const { t } = useTranslation();

  return (
    <Modal visible={true} transparent={true} animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>🔔</Text>
          </View>
          <Text style={styles.title}>{t('notifications.explainerTitle')}</Text>
          <Text style={styles.body}>{t('notifications.explainerBody')}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onDismiss} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>{t('notifications.notNow')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={onEnable} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>{t('notifications.enableNotifications')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  icon: { fontSize: 32 },
  title: {
    ...typography.h4,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
