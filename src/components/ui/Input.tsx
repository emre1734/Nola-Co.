import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onRightIconPress?: () => void;
  secure?: boolean;
}

export function Input({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  onRightIconPress,
  secure,
  style,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const containerBorder = error
    ? colors.error
    : focused
    ? colors.primary
    : colors.border;

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputContainer, { borderColor: containerBorder }]}>
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          style={[
            styles.input,
            leftIcon ? styles.inputWithLeft : null,
            rightIcon || secure ? styles.inputWithRight : null,
          ]}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secure && !showPassword}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          {...props}
        />
        {secure && (
          <TouchableOpacity
            style={styles.rightIcon}
            onPress={() => setShowPassword(v => !v)}
          >
            <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        )}
        {rightIcon && !secure && (
          <TouchableOpacity style={styles.rightIcon} onPress={onRightIconPress}>
            {rightIcon}
          </TouchableOpacity>
        )}
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing.md },
  label: {
    ...typography.label,
    marginBottom: 6,
    color: colors.textSecondary,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1.5,
    minHeight: 52,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
    outlineStyle: 'none',
  } as any,
  inputWithLeft: { paddingLeft: 8 },
  inputWithRight: { paddingRight: 8 },
  leftIcon: { paddingLeft: spacing.md },
  rightIcon: { paddingRight: spacing.md },
  eyeIcon: { fontSize: 16 },
  error: { ...typography.bodySmall, color: colors.error, marginTop: 4 },
  hint: { ...typography.bodySmall, color: colors.textMuted, marginTop: 4 },
});
