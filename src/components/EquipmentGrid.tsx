import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  EQUIPMENT_CATALOG,
  equipmentIcon,
  equipmentLabel,
} from '../lib/equipment';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

interface EquipmentGridProps {
  /** Equipment keys the partner owns. Only owned items are rendered. */
  owned: string[];
  /** When true, show every catalog item with a ✓ / ✗ owned/unowned mark. */
  showAll?: boolean;
  compact?: boolean;
}

/**
 * Displays a partner's equipment as a grid of icon + label chips.
 *
 * - Default (`showAll=false`): only owned equipment, as positive chips.
 * - `showAll=true`: every catalog item with a ✓ (owned) or ✗ (unowned)
 *   marker, matching the spec's example layout.
 */
export function EquipmentGrid({ owned, showAll = false, compact = false }: EquipmentGridProps) {
  const { t } = useTranslation();
  const ownedSet = new Set(owned);

  const items = showAll
    ? EQUIPMENT_CATALOG
    : EQUIPMENT_CATALOG.filter(e => ownedSet.has(e.key));

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('equipment.empty')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {items.map(item => {
        const has = ownedSet.has(item.key);
        return (
          <View
            key={item.key}
            style={[
              styles.chip,
              compact && styles.chipCompact,
              showAll && !has && styles.chipUnowned,
            ]}
          >
            <Text style={styles.chipIcon}>{item.icon}</Text>
            <Text
              style={[styles.chipLabel, compact && styles.chipLabelCompact]}
              numberOfLines={compact ? 1 : 2}
            >
              {t('equipment.' + item.key)}
            </Text>
            {showAll && (
              <Text style={[styles.chipMark, has ? styles.chipMarkOk : styles.chipMarkNo]}>
                {has ? '✓' : '✗'}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  empty: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: { ...typography.bodySmall, color: colors.textMuted },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  chipCompact: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  chipUnowned: {
    backgroundColor: colors.surface,
    borderColor: colors.borderLight,
    opacity: 0.55,
  },
  chipIcon: { fontSize: 16 },
  chipLabel: { ...typography.bodySmall, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  chipLabelCompact: { fontSize: 12 },
  chipMark: { fontSize: 13, fontWeight: '800', marginLeft: 2 },
  chipMarkOk: { color: colors.success },
  chipMarkNo: { color: colors.error },
});
