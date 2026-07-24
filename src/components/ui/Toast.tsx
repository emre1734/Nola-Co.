import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useToast } from '../../contexts/ToastContext';
import { colors, radii, spacing, typography } from '../../theme';

const TYPE_STYLES = {
  success: { bg: '#064E3B', border: colors.success, icon: '✓' },
  error: { bg: '#450A0A', border: colors.error, icon: '✕' },
  info: { bg: '#1E3A5F', border: colors.info, icon: 'ℹ' },
};

export function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {toasts.map(toast => {
        const s = TYPE_STYLES[toast.type];
        return (
          <TouchableOpacity
            key={toast.id}
            style={[styles.toast, { backgroundColor: s.bg, borderColor: s.border }]}
            onPress={() => dismissToast(toast.id)}
            activeOpacity={0.9}
          >
            <View style={[styles.iconBadge, { backgroundColor: s.border }]}>
              <Text style={styles.icon}>{s.icon}</Text>
            </View>
            <Text style={styles.message} numberOfLines={2}>{toast.message}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: spacing.md,
    right: spacing.md,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: { color: '#fff', fontSize: 12, fontWeight: '700' },
  message: { ...typography.body, flex: 1 },
});
