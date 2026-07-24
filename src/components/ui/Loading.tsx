import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { colors, typography } from '../../theme';

interface LoadingProps {
  fullScreen?: boolean;
  message?: string;
}

export function Loading({ fullScreen = false, message }: LoadingProps) {
  if (fullScreen) {
    return (
      <View style={styles.fullScreen}>
        <ActivityIndicator size="large" color={colors.primary} />
        {message && <Text style={styles.message}>{message}</Text>}
      </View>
    );
  }
  return (
    <View style={styles.inline}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  inline: {
    padding: 16,
    alignItems: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 8,
  },
});
