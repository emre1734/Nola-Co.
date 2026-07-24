import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { Button } from '../../components/ui';
import { useLocation } from '../../contexts/LocationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from '../../i18n/useTranslation';
import { colors, spacing, typography, radii } from '../../theme';

interface LocationPermissionScreenProps {
  onLocationSettled: () => void;
  onManualSelect: () => void;
}

export function LocationPermissionScreen({ onLocationSettled, onManualSelect }: LocationPermissionScreenProps) {
  const { status, coordinates, error, requestLocation, saveLocation } = useLocation();
  const { session } = useAuth();
  const { t } = useTranslation();

  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  const spinAnim = React.useRef(new Animated.Value(0)).current;

  // Pulse animation for the location icon
  useEffect(() => {
    if (status === 'requesting') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status]);

  // Spinner animation
  useEffect(() => {
    if (status === 'requesting') {
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ).start();
    }
  }, [status]);

  // When coordinates are obtained, save to profile and continue
  useEffect(() => {
    if (status === 'granted' && coordinates && session) {
      (async () => {
        await saveLocation(coordinates);
        onLocationSettled();
      })();
    }
  }, [status, coordinates, session]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Icon */}
        <Animated.View style={[styles.iconWrap, { transform: [{ scale: pulseAnim }] }]}>
          {status === 'requesting' ? (
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Text style={styles.iconText}>📡</Text>
            </Animated.View>
          ) : status === 'denied' ? (
            <Text style={styles.iconText}>🚫</Text>
          ) : status === 'error' ? (
            <Text style={styles.iconText}>⚠️</Text>
          ) : (
            <Text style={styles.iconText}>📍</Text>
          )}
        </Animated.View>

        {/* Title + description vary by status */}
        {status === 'requesting' && (
          <>
            <Text style={styles.title}>{t('onboarding.location.requestingTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('onboarding.location.requestingSubtitle')}
            </Text>
          </>
        )}

        {status === 'denied' && (
          <>
            <Text style={styles.title}>{t('onboarding.location.deniedTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('onboarding.location.deniedSubtitle')}
            </Text>
            <Text style={styles.hint}>
              {t('onboarding.location.deniedHint')}
            </Text>
          </>
        )}

        {status === 'error' && (
          <>
            <Text style={styles.title}>{t('onboarding.location.errorTitle')}</Text>
            <Text style={styles.subtitle}>{error ?? t('onboarding.location.errorSubtitle')}</Text>
          </>
        )}

        {(status === 'idle' || status === 'granted') && (
          <>
            <Text style={styles.title}>{t('onboarding.location.idleTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('onboarding.location.idleSubtitle')}
            </Text>
          </>
        )}

        {/* Action buttons */}
        <View style={styles.actions}>
          {status === 'requesting' ? (
            <View style={styles.loadingRow}>
              <Text style={styles.loadingText}>{t('onboarding.location.locating')}</Text>
            </View>
          ) : (
            <>
              <Button
                label={status === 'idle' ? t('onboarding.location.allow') : t('onboarding.location.tryAgain')}
                onPress={requestLocation}
                size="lg"
                loading={false}
              />
              {(status === 'denied' || status === 'error') && (
                <Button
                  label={t('onboarding.location.manualSelect')}
                  onPress={onManualSelect}
                  variant="secondary"
                  size="lg"
                  style={{ marginTop: spacing.sm }}
                />
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  content: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  iconText: { fontSize: 52 },
  title: {
    ...typography.h2,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  hint: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  actions: { width: '100%', marginTop: spacing.md },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  loadingText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
});
