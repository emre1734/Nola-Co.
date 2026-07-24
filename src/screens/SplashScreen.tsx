import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { colors } from '../theme';

interface SplashScreenProps {
  onReady: (destination: 'auth' | 'onboarding' | 'home') => void;
}

export function SplashScreen({ onReady }: SplashScreenProps) {
  const { session, profile, initialized } = useAuth();
  const { t } = useTranslation();
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 7 }),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      Animated.timing(dropOpacity, { toValue: 1, duration: 300, delay: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const timer = setTimeout(() => {
      if (!session) {
        onReady('auth');
      } else if (!profile?.full_name || !profile?.city) {
        onReady('onboarding');
      } else {
        onReady('home');
      }
    }, 1800);
    return () => clearTimeout(timer);
  }, [initialized, session, profile]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoWrap, { transform: [{ scale }], opacity }]}>
        <View style={styles.iconCircle}>
          <Text style={styles.dropEmoji}>💧</Text>
        </View>
        <Animated.View style={{ opacity: dropOpacity }}>
          <Text style={styles.brandName}>
            Wish<Text style={styles.brandAccent}>Wash</Text>
          </Text>
          <Text style={styles.tagline}>{t('splash.tagline')}</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: { alignItems: 'center', gap: 20 },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 32,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary + '40',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
  },
  dropEmoji: { fontSize: 48 },
  brandName: {
    fontSize: 42,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -1,
  },
  brandAccent: { color: colors.primary },
  tagline: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    letterSpacing: 1,
  },
});
