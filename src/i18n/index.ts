import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LocaleCode } from './types';
import { LANGUAGES, DEFAULT_LANGUAGE } from './languages';
import { en } from './locales/en';
import { tr } from './locales/tr';
import { es } from './locales/es';

export const translations: Record<LocaleCode, typeof en> = {
  en,
  tr: tr as typeof en,
  es: es as typeof en,
};

function detectInitialLanguage(): LocaleCode {
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language?.toLowerCase() ?? '';
    if (lang.startsWith('tr')) return 'tr';
    if (lang.startsWith('es')) return 'es';
  }
  return DEFAULT_LANGUAGE;
}

interface I18nState {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: detectInitialLanguage(),
      setLocale: (code) => set({ locale: code }),
    }),
    {
      name: 'wishwash-locale',
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
);

export { LANGUAGES };
