import type { TFunc } from '../i18n/useTranslation';

const SERVICE_NAME_MAP: Record<string, string> = {
  'Exterior Wash': 'exteriorWash',
  'Interior Wash': 'interiorWash',
  'Interior + Exterior Wash': 'interiorExteriorWash',
  'Detailing': 'detailing',
};

const SERVICE_DESC_MAP: Record<string, string> = {
  'Exterior Cleaning': 'exteriorCleaning',
  'Interior Cleaning': 'interiorCleaning',
  'Complete Wash': 'completeWash',
  'Professional Detailing': 'professionalDetailing',
};

export function localizeServiceName(dbName: string | null | undefined, t: TFunc): string {
  if (!dbName) return '';
  const key = SERVICE_NAME_MAP[dbName];
  if (!key) return dbName;
  const i18nKey = `booking.serviceName.${key}`;
  const translated = t(i18nKey);
  return translated === i18nKey ? dbName : translated;
}

export function localizeServiceDescription(dbDesc: string | null | undefined, t: TFunc): string | null {
  if (!dbDesc) return null;
  const key = SERVICE_DESC_MAP[dbDesc];
  if (!key) return dbDesc;
  const i18nKey = `booking.serviceDesc.${key}`;
  const translated = t(i18nKey);
  return translated === i18nKey ? dbDesc : translated;
}

const EXTRA_ID_MAP: Record<string, string> = {
  tire_shine: 'extraTireShine',
  window_protection: 'extraWindowProtection',
  ceramic_spray: 'extraCeramicSpray',
  seat_cleaning: 'extraSeatCleaning',
  engine_cleaning: 'extraEngineCleaning',
};

export function localizeExtraName(extra: { id?: string | null; name: string }, t: TFunc): string {
  if (extra.id) {
    const key = EXTRA_ID_MAP[extra.id];
    if (key) {
      const i18nKey = `booking.${key}`;
      const translated = t(i18nKey);
      if (translated !== i18nKey) return translated;
    }
  }
  return extra.name;
}
