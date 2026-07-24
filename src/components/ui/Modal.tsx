import React from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import { Button } from './Button';
import { colors, radii, spacing, typography } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  confirmVariant?: 'primary' | 'danger';
  children?: React.ReactNode;
}

export function Modal({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  confirmVariant = 'primary',
  children,
}: ModalProps) {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t('ui.modalConfirm');
  const resolvedCancelLabel = cancelLabel ?? t('ui.modalCancel');
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.card}>
              <Text style={styles.title}>{title}</Text>
              {message && <Text style={styles.message}>{message}</Text>}
              {children}
              {onConfirm && (
                <View style={styles.actions}>
                  <Button
                    label={resolvedCancelLabel}
                    onPress={onClose}
                    variant="secondary"
                    style={styles.btn}
                  />
                  <Button
                    label={resolvedConfirmLabel}
                    onPress={onConfirm}
                    variant={confirmVariant}
                    style={styles.btn}
                  />
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  title: { ...typography.h3, marginBottom: spacing.sm },
  message: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1 },
});
