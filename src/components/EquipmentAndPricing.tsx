import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import {
  EQUIPMENT_CATALOG,
  EQUIPMENT_KEYS,
  getPricingTier,
  isPriceInRange,
  clampPriceToTier,
  formatPrice,
} from '../lib/equipment';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

interface EquipmentAndPricingProps {
  providerProfileId: string;
  profileId: string;
  initialEquipment: string[];
  initialPrice: number;
  completedJobs: number;
  onUpdated?: () => void;
}

export function EquipmentAndPricing({
  providerProfileId,
  profileId,
  initialEquipment,
  initialPrice,
  completedJobs,
  onUpdated,
}: EquipmentAndPricingProps) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [equipment, setEquipment] = useState<string[]>(initialEquipment);
  const [price, setPrice] = useState<string>(String(Math.round(initialPrice)));
  const [savingEquipment, setSavingEquipment] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);

  // Keep local state in sync if the parent refetches profile data.
  useEffect(() => {
    setEquipment(initialEquipment);
  }, [initialEquipment]);
  useEffect(() => {
    setPrice(String(Math.round(initialPrice)));
  }, [initialPrice]);

  const tier = getPricingTier(completedJobs);
  const ownedSet = new Set(equipment);

  const toggleEquipment = (key: string) => {
    setEquipment(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSaveEquipment = async () => {
    setSavingEquipment(true);
    const { error } = await supabase
      .from('provider_profiles')
      .update({ equipment })
      .eq('id', providerProfileId);
    setSavingEquipment(false);
    if (error) {
      showToast(t('equipment.errSave'), 'error');
      return;
    }
    showToast(t('equipment.successSaved'), 'success');
    onUpdated?.();
  };

  const handleSavePrice = async () => {
    const numeric = Number(price);
    if (!Number.isFinite(numeric)) {
      showToast(t('pricing.errInvalid'), 'error');
      return;
    }
    if (!isPriceInRange(numeric, tier)) {
      showToast(
        t('pricing.errOutOfRange', { range: tier.rangeLabel }),
        'error',
      );
      return;
    }
    const clamped = clampPriceToTier(numeric, tier) ?? numeric;
    setSavingPrice(true);
    const { error } = await supabase
      .from('provider_profiles')
      .update({ service_price: clamped })
      .eq('id', providerProfileId);
    setSavingPrice(false);
    if (error) {
      showToast(t('pricing.errSave'), 'error');
      return;
    }
    setPrice(String(clamped));
    showToast(t('pricing.successSaved'), 'success');
    onUpdated?.();
  };

  const equipmentDirty = JSON.stringify([...equipment].sort()) !== JSON.stringify([...initialEquipment].sort());
  const priceDirty = Number(price) !== Math.round(initialPrice);
  const priceInvalid = tier.editable && price !== '' && !isPriceInRange(Number(price), tier);

  return (
    <View style={styles.wrap}>
      {/* EQUIPMENT */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t('equipment.title')}</Text>
          <Text style={styles.cardSubtitle}>
            {t('equipment.countLabel', { owned: ownedSet.size, total: EQUIPMENT_KEYS.length })}
          </Text>
        </View>
        <View style={styles.equipGrid}>
          {EQUIPMENT_CATALOG.map(item => {
            const owned = ownedSet.has(item.key);
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.equipChip, owned && styles.equipChipActive]}
                onPress={() => toggleEquipment(item.key)}
                activeOpacity={0.8}
              >
                <Text style={styles.equipIcon}>{item.icon}</Text>
                <Text
                  style={[styles.equipLabel, owned && styles.equipLabelActive]}
                  numberOfLines={2}
                >
                  {t('equipment.' + item.key)}
                </Text>
                <View style={[styles.equipMark, owned && styles.equipMarkActive]}>
                  <Text style={styles.equipMarkText}>{owned ? '✓' : '+'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, !equipmentDirty && styles.saveBtnIdle, savingEquipment && styles.saveBtnBusy]}
          onPress={handleSaveEquipment}
          disabled={!equipmentDirty || savingEquipment}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>
            {savingEquipment ? t('equipment.saving') : t('equipment.save')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* DYNAMIC PRICING */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t('pricing.title')}</Text>
          <Text style={styles.cardSubtitle}>{t('pricing.completedLabel', { count: completedJobs })}</Text>
        </View>

        <View style={styles.priceRow}>
          <View style={styles.priceCell}>
            <Text style={styles.priceLabel}>{t('pricing.currentPrice')}</Text>
            <Text style={styles.priceValue}>{formatPrice(tier.editable ? Number(price) || initialPrice : 450)}</Text>
          </View>
          <View style={styles.priceCell}>
            <Text style={styles.priceLabel}>{t('pricing.allowedRange')}</Text>
            <Text style={styles.priceValue}>
              {tier.editable ? tier.rangeLabel : t('pricing.fixedLabel', { price: '₺450' })}
            </Text>
          </View>
        </View>

        {!tier.editable ? (
          <View style={styles.lockedBox}>
            <Text style={styles.lockedIcon}>🔒</Text>
            <Text style={styles.lockedText}>{t(tier.lockedMessage)}</Text>
          </View>
        ) : (
          <>
            <View style={styles.priceEditor}>
              <Text style={styles.editorLabel}>{t('pricing.setPrice')}</Text>
              <View style={styles.priceInputRow}>
                <Text style={styles.currencyPrefix}>{t('pricing.currencyPrefix')}</Text>
                <TextInput
                  style={[styles.priceInput, priceInvalid && styles.priceInputError]}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="numeric"
                  placeholder={String(tier.min)}
                  placeholderTextColor={colors.textMuted}
                  maxLength={5}
                />
                <Text style={styles.rangeHint}>{t('pricing.rangeHint', { range: tier.rangeLabel })}</Text>
              </View>
              {priceInvalid && (
                <Text style={styles.errorMsg}>
                  {t('pricing.errPriceRange', { min: formatPrice(tier.min), max: formatPrice(tier.max) })}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={[styles.saveBtn, (!priceDirty || priceInvalid) && styles.saveBtnIdle, savingPrice && styles.saveBtnBusy]}
              onPress={handleSavePrice}
              disabled={!priceDirty || priceInvalid || savingPrice}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>
                {savingPrice ? t('pricing.saving') : t('pricing.save')}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.milestoneBox}>
          <Text style={styles.milestoneLabel}>{t('pricing.nextMilestone')}</Text>
          {tier.next ? (
            <Text style={styles.milestoneText}>
              {t('pricing.milestoneText', { remaining: tier.next.remaining, range: tier.next.rangeLabel })}
            </Text>
          ) : (
            <Text style={styles.milestoneText}>
              {t('pricing.topTier', { range: tier.rangeLabel })}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },

  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cardTitle: { ...typography.h4, fontSize: 16 },
  cardSubtitle: { ...typography.caption, color: colors.textMuted },

  // Equipment grid
  equipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  equipChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
    maxWidth: '48%',
    flexGrow: 1,
  },
  equipChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '12',
  },
  equipIcon: { fontSize: 18 },
  equipLabel: { ...typography.bodySmall, fontWeight: '600', flexShrink: 1, color: colors.textSecondary },
  equipLabelActive: { color: colors.textPrimary },
  equipMark: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 'auto',
  },
  equipMarkActive: { backgroundColor: colors.accent },
  equipMarkText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
  },
  saveBtnIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight, opacity: 0.6 },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Pricing
  priceRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  priceCell: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  priceLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 },
  priceValue: { ...typography.h3, fontSize: 18 },

  lockedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warning + '12',
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.warning + '40',
    marginBottom: spacing.md,
  },
  lockedIcon: { fontSize: 20 },
  lockedText: { ...typography.bodySmall, color: colors.warning, fontWeight: '600', flex: 1 },

  priceEditor: { marginBottom: spacing.md },
  editorLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 1 },
  priceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.md,
  },
  currencyPrefix: { fontSize: 18, fontWeight: '700', color: colors.textSecondary, marginRight: spacing.xs },
  priceInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: spacing.sm + 2,
  },
  priceInputError: { borderColor: colors.error, borderWidth: 0 },
  rangeHint: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  errorMsg: { color: colors.error, fontSize: 12, fontWeight: '500', marginTop: spacing.xs },

  milestoneBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  milestoneLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' },
  milestoneText: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 19 },
  milestoneRange: { color: colors.accent, fontWeight: '800' },
});
