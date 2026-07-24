export interface EquipmentItem {
  key: string;
  label: string;
  icon: string;
}

export const EQUIPMENT_CATALOG: EquipmentItem[] = [
  { key: 'pressure_washer', label: 'Pressure Washer', icon: '💦' },
  { key: 'foam_cannon', label: 'Foam Cannon', icon: '🫧' },
  { key: 'car_shampoo', label: 'Car Shampoo', icon: '🧴' },
  { key: 'microfiber_towels', label: 'Microfiber Towels', icon: '🧺' },
  { key: 'vacuum_cleaner', label: 'Vacuum Cleaner', icon: '🧹' },
  { key: 'tire_shine', label: 'Tire Shine', icon: '🛞' },
  { key: 'glass_cleaner', label: 'Glass Cleaner', icon: '🪟' },
  { key: 'steam_cleaner', label: 'Steam Cleaner', icon: '♨️' },
  { key: 'ceramic_spray', label: 'Ceramic Spray', icon: '🛡️' },
];

export const EQUIPMENT_KEYS = EQUIPMENT_CATALOG.map(e => e.key);

export function equipmentLabel(key: string): string {
  return EQUIPMENT_CATALOG.find(e => e.key === key)?.label ?? key;
}

export function equipmentIcon(key: string): string {
  return EQUIPMENT_CATALOG.find(e => e.key === key)?.icon ?? '🔧';
}

export function ownedEquipment(keys: string[]): EquipmentItem[] {
  const set = new Set(keys);
  return EQUIPMENT_CATALOG.filter(e => set.has(e.key));
}

export interface PricingTier {
  min: number;
  max: number;
  editable: boolean;
  /** Human-readable range, e.g. "₺450 – ₺550". Empty for the locked tier. */
  rangeLabel: string;
  /** Headline message for the locked tier. */
  lockedMessage: string;
  /** Next milestone descriptor (null at the top tier). */
  next: { atJobs: number; rangeLabel: string; remaining: number } | null;
}

export function formatPrice(value: number): string {
  return `₺${Math.round(value)}`;
}

export function formatRange(min: number, max: number): string {
  return `${formatPrice(min)} – ${formatPrice(max)}`;
}

/**
 * Returns the pricing tier that applies to a partner with the given number
 * of completed jobs. Tiers per spec:
 *   0–2:   fixed ₺450 (locked)
 *   3–9:   ₺450 – ₺550
 *   10–24: ₺500 – ₺650
 *   25–49: ₺550 – ₺750
 *   50–99: ₺650 – ₺900
 *   100+:  ₺750 – ₺1200
 */
export function getPricingTier(completedJobs: number): PricingTier {
  const jobs = Math.max(0, Math.floor(completedJobs));

  if (jobs < 3) {
    return {
      min: 450,
      max: 450,
      editable: false,
      rangeLabel: '',
      lockedMessage: 'pricing.lockedMessage',
      next: { atJobs: 3, rangeLabel: formatRange(450, 550), remaining: 3 - jobs },
    };
  }

  if (jobs < 10) {
    return {
      min: 450,
      max: 550,
      editable: true,
      rangeLabel: formatRange(450, 550),
      lockedMessage: '',
      next: { atJobs: 10, rangeLabel: formatRange(500, 650), remaining: 10 - jobs },
    };
  }

  if (jobs < 25) {
    return {
      min: 500,
      max: 650,
      editable: true,
      rangeLabel: formatRange(500, 650),
      lockedMessage: '',
      next: { atJobs: 25, rangeLabel: formatRange(550, 750), remaining: 25 - jobs },
    };
  }

  if (jobs < 50) {
    return {
      min: 550,
      max: 750,
      editable: true,
      rangeLabel: formatRange(550, 750),
      lockedMessage: '',
      next: { atJobs: 50, rangeLabel: formatRange(650, 900), remaining: 50 - jobs },
    };
  }

  if (jobs < 100) {
    return {
      min: 650,
      max: 900,
      editable: true,
      rangeLabel: formatRange(650, 900),
      lockedMessage: '',
      next: { atJobs: 100, rangeLabel: formatRange(750, 1200), remaining: 100 - jobs },
    };
  }

  return {
    min: 750,
    max: 1200,
    editable: true,
    rangeLabel: formatRange(750, 1200),
    lockedMessage: '',
    next: null,
  };
}

/**
 * Clamps a candidate price to the tier's allowed range. Returns null if the
 * tier is not editable. Returns the clamped value otherwise.
 */
export function clampPriceToTier(price: number, tier: PricingTier): number | null {
  if (!tier.editable) return null;
  const p = Math.round(price);
  return Math.min(tier.max, Math.max(tier.min, p));
}

/**
 * True if the price is within the tier's allowed range (inclusive).
 */
export function isPriceInRange(price: number, tier: PricingTier): boolean {
  if (!tier.editable) return price === tier.min;
  const p = Math.round(price);
  return p >= tier.min && p <= tier.max;
}
