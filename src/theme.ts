export const colors = {
  // Brand
  primary: '#06B6D4',      // cyan-500
  primaryDark: '#0891B2',  // cyan-600
  primaryLight: '#22D3EE', // cyan-400
  accent: '#10B981',       // emerald-500

  // Dark theme backgrounds
  bg: '#0A0F1E',           // deepest background
  surface: '#111827',      // cards / surfaces
  surfaceAlt: '#1F2937',   // elevated surface
  border: '#1F2937',       // dividers
  borderLight: '#374151',  // lighter border

  // Text
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',

  // Status
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Gradients
  gradientStart: '#06B6D4',
  gradientEnd: '#3B82F6',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const typography = {
  h1: { fontSize: 32, fontWeight: '800' as const, color: colors.textPrimary },
  h2: { fontSize: 24, fontWeight: '700' as const, color: colors.textPrimary },
  h3: { fontSize: 20, fontWeight: '700' as const, color: colors.textPrimary },
  h4: { fontSize: 17, fontWeight: '600' as const, color: colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.textPrimary },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary },
  caption: { fontSize: 11, fontWeight: '500' as const, color: colors.textMuted },
  label: { fontSize: 14, fontWeight: '500' as const, color: colors.textSecondary },
};
