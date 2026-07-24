import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Button, Loading } from '../../components/ui';
import { EquipmentGrid } from '../../components/EquipmentGrid';
import { formatPrice } from '../../lib/equipment';
import { useToast } from '../../contexts/ToastContext';
import { colors, spacing, typography, radii } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';

interface PartnerSelectionScreenProps {
  onBack: () => void;
  onComplete: () => void;
}

interface NearbyPartner {
  id: string;
  name: string;
  rating: number;
  completedJobs: number;
  distanceKm: number;
  etaMin: number;
  avatarEmoji: string;
  equipment: string[];
  servicePrice: number;
}

// Temporary mock data — will be replaced with live location-based matching later
const NEARBY_PARTNERS: NearbyPartner[] = [
  { id: 'p1', name: 'Marcus Williams', rating: 4.9, completedJobs: 342, distanceKm: 1.2, etaMin: 8, avatarEmoji: '👨🏽', equipment: ['pressure_washer','foam_cannon','car_shampoo','microfiber_towels','vacuum_cleaner','tire_shine','glass_cleaner'], servicePrice: 820 },
  { id: 'p2', name: 'Elena Rodriguez', rating: 4.8, completedJobs: 218, distanceKm: 2.5, etaMin: 12, avatarEmoji: '👩🏻', equipment: ['pressure_washer','foam_cannon','car_shampoo','microfiber_towels','vacuum_cleaner','ceramic_spray'], servicePrice: 700 },
  { id: 'p3', name: 'James Okafor', rating: 5.0, completedJobs: 506, distanceKm: 3.1, etaMin: 15, avatarEmoji: '👨🏾', equipment: ['pressure_washer','foam_cannon','car_shampoo','microfiber_towels','vacuum_cleaner','tire_shine','glass_cleaner','steam_cleaner','ceramic_spray'], servicePrice: 950 },
  { id: 'p4', name: 'Sophie Chen', rating: 4.7, completedJobs: 156, distanceKm: 4.0, etaMin: 18, avatarEmoji: '👩🏼', equipment: ['pressure_washer','foam_cannon','car_shampoo','microfiber_towels'], servicePrice: 620 },
  { id: 'p5', name: 'Liam Patel', rating: 5.0, completedJobs: 1, distanceKm: 1.8, etaMin: 10, avatarEmoji: '👨🏼', equipment: ['pressure_washer','car_shampoo','microfiber_towels'], servicePrice: 450 },
];

export function PartnerSelectionScreen({ onBack, onComplete }: PartnerSelectionScreenProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const handleSend = () => {
    if (!selected) return;
    setSending(true);
    // Simulate sending request to partner
    setTimeout(() => {
      setSending(false);
      showToast(t('partners.successSent'), 'success');
      onComplete();
    }, 1200);
  };

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('partners.title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.infoBanner}>
        <Text style={styles.infoBannerText}>
          {t('partners.infoBanner')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>
          {NEARBY_PARTNERS.length} {t('partners.partnersNear')}
        </Text>
        <Text style={styles.sectionSubtitle}>
          {t('partners.subtitle')}
        </Text>

        <View style={styles.cardList}>
          {NEARBY_PARTNERS.map(p => {
            const isNew = p.completedJobs < 3;
            return (
            <TouchableOpacity
              key={p.id}
              style={[styles.partnerCard, selected === p.id && styles.partnerCardActive]}
              onPress={() => setSelected(p.id)}
              activeOpacity={0.85}
            >
              <View style={styles.partnerAvatar}>
                <Text style={styles.partnerAvatarEmoji}>{p.avatarEmoji}</Text>
              </View>
              <View style={styles.partnerInfo}>
                <Text style={styles.partnerName}>{p.name}</Text>
                <View style={styles.partnerMeta}>
                  <Text style={styles.pricePill}>{formatPrice(p.servicePrice)}</Text>
                  {isNew ? (
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText}>{t('partners.newBadge')}</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.partnerRating}>★ {p.rating.toFixed(1)}</Text>
                      <Text style={styles.partnerDot}>·</Text>
                      <Text style={styles.partnerJobs}>{p.completedJobs} {t('partners.jobsSuffix')}</Text>
                    </>
                  )}
                </View>
                <View style={styles.partnerMeta}>
                  <Text style={styles.partnerDistance}>{p.distanceKm} {t('partners.kmAway')}</Text>
                  <Text style={styles.partnerDot}>·</Text>
                  <Text style={styles.partnerEta}>~{p.etaMin} {t('partners.minEta')}</Text>
                </View>

                {/* Equipment section */}
                <View style={styles.equipWrap}>
                  <Text style={styles.equipLabel}>{t('partners.equipment')}</Text>
                  <EquipmentGrid owned={p.equipment} compact />
                </View>

                {!isNew && (
                  <Text style={styles.completedJobs}>{p.completedJobs} {t('partners.completedServices')}</Text>
                )}
              </View>
              <View style={[styles.radio, selected === p.id && styles.radioActive]}>
                {selected === p.id && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={t('partners.sendRequest')}
          onPress={handleSend}
          disabled={!selected}
          loading={sending}
          size="lg"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '300' },
  topTitle: { ...typography.h4 },

  infoBanner: {
    backgroundColor: colors.primary + '15',
    borderBottomWidth: 1,
    borderBottomColor: colors.primary + '30',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  infoBannerText: { ...typography.body, color: colors.primary, fontWeight: '500' },

  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionTitle: { ...typography.h3, marginBottom: 4 },
  sectionSubtitle: { ...typography.bodySmall, color: colors.textMuted, marginBottom: spacing.lg },

  cardList: { gap: spacing.md },
  partnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: spacing.md,
  },
  partnerCardActive: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
  partnerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  partnerAvatarEmoji: { fontSize: 28 },
  partnerInfo: { flex: 1 },
  partnerName: { ...typography.h4, marginBottom: 4 },
  pricePill: {
    color: '#fff', fontWeight: '800', fontSize: 13,
    backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 999, overflow: 'hidden',
  },
  newBadge: {
    backgroundColor: colors.accent + '22',
    borderWidth: 1, borderColor: colors.accent + '60',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
  },
  newBadgeText: { fontSize: 11, fontWeight: '800', color: colors.accent },
  equipWrap: { marginTop: spacing.sm },
  equipLabel: {
    ...typography.caption, color: colors.textMuted, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs,
  },
  completedJobs: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  partnerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  partnerRating: { ...typography.bodySmall, fontWeight: '700', color: colors.warning },
  partnerDot: { color: colors.textMuted, fontSize: 12 },
  partnerJobs: { ...typography.bodySmall, color: colors.textSecondary },
  partnerDistance: { ...typography.bodySmall, color: colors.textSecondary },
  partnerEta: { ...typography.bodySmall, color: colors.accent, fontWeight: '600' },

  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },

  footer: { padding: spacing.lg, paddingBottom: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border },
});
