export type LocaleCode = 'tr' | 'en' | 'es';

export interface LanguageMeta {
  code: LocaleCode;
  label: string;
  flag: string;
}

export type TranslationDict = Record<string, unknown>;
