import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, radii } from '../../theme';

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
  onPress?: () => void;
  showBadge?: boolean;
  badgeColor?: string;
}

function initials(name?: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

export function Avatar({ uri, name, size = 44, onPress, showBadge, badgeColor = colors.success }: AvatarProps) {
  const content = uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View
      style={[
        styles.placeholder,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primaryDark },
      ]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </View>
  );

  const wrapped = (
    <View style={{ width: size, height: size }}>
      {content}
      {showBadge && (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: badgeColor,
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: (size * 0.28) / 2,
              bottom: 0,
              right: 0,
            },
          ]}
        />
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {wrapped}
      </TouchableOpacity>
    );
  }
  return wrapped;
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: '#fff', fontWeight: '700' },
  badge: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
