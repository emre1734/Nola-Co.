import { useI18nStore, translations } from './index';
import type { LocaleCode } from './types';

type Nested = Record<string, unknown>;

function get(obj: Nested, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Nested)) {
      return (acc as Nested)[key];
    }
    return undefined;
  }, obj);
}

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    params[k] != null ? String(params[k]) : '',
  );
}

export function useTranslation() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  const dict = translations[locale];

  const t = (key: string, params?: Record<string, unknown>): string => {
    const value = get(dict as Nested, key);
    if (typeof value === 'string') {
      return interpolate(value, params);
    }
    const fallback = get(translations.en as Nested, key);
    if (typeof fallback === 'string') {
      return interpolate(fallback, params);
    }
    return key;
  };

  return { t, locale, setLocale };
}

export type TFunc = ReturnType<typeof useTranslation>['t'];
export type { LocaleCode };
