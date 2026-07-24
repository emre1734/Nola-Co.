import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  style,
  fullWidth = true,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const containerStyle = [
    styles.base,
    styles[`size_${size}`],
    styles[`variant_${variant}`],
    isDisabled && styles.disabled,
    fullWidth && styles.fullWidth,
    style,
  ];

  const textStyle = [
    styles.label,
    styles[`labelSize_${size}`],
    styles[`labelVariant_${variant}`],
    isDisabled && styles.labelDisabled,
  ];

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.82}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.primary} />
      ) : (
        <View style={styles.inner}>
          {icon && <View style={styles.iconWrap}>{icon}</View>}
          <Text style={textStyle}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { width: '100%' },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconWrap: { marginRight: 4 },

  // Sizes
  size_sm: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: radii.md },
  size_md: { paddingVertical: 14, paddingHorizontal: 20 },
  size_lg: { paddingVertical: 18, paddingHorizontal: 24 },

  // Variants
  variant_primary: { backgroundColor: colors.primary },
  variant_secondary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  variant_ghost: { backgroundColor: 'transparent' },
  variant_danger: { backgroundColor: colors.error },

  disabled: { opacity: 0.5 },

  // Labels
  label: { fontWeight: '700', letterSpacing: 0.3 },
  labelSize_sm: { fontSize: 13 },
  labelSize_md: { fontSize: 15 },
  labelSize_lg: { fontSize: 17 },
  labelVariant_primary: { color: '#fff' },
  labelVariant_secondary: { color: colors.textPrimary },
  labelVariant_ghost: { color: colors.primary },
  labelVariant_danger: { color: '#fff' },
  labelDisabled: { opacity: 0.7 },
});
