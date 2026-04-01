// VoxLink Localization Index
// Import translation files and expose typed t() helper

import en from "./en";
import hi from "./hi";
import zh from "./zh";
import ar from "./ar";
import es from "./es";

export type SupportedLanguage = "en" | "hi" | "zh" | "ar" | "es";

export const LANGUAGES: Array<{ code: SupportedLanguage; name: string; nativeName: string; rtl?: boolean }> = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ar", name: "Arabic", nativeName: "العربية", rtl: true },
  { code: "es", name: "Spanish", nativeName: "Español" },
];

const translations: Record<SupportedLanguage, typeof en> = {
  en,
  hi,
  zh,
  ar,
  es,
};

let currentLanguage: SupportedLanguage = "en";

export function setLanguage(lang: SupportedLanguage) {
  if (lang in translations) {
    currentLanguage = lang;
  }
}

export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

export function isRTL(lang?: SupportedLanguage): boolean {
  const l = lang ?? currentLanguage;
  return LANGUAGES.find((x) => x.code === l)?.rtl ?? false;
}

type NestedKeys<T> = T extends object
  ? { [K in keyof T]: K extends string ? (T[K] extends object ? `${K}.${NestedKeys<T[K]>}` : K) : never }[keyof T]
  : never;

type TranslationKey = string;

export function t(key: TranslationKey, lang?: SupportedLanguage): string {
  const l = lang ?? currentLanguage;
  const dict = translations[l] ?? translations.en;
  const parts = key.split(".");
  let value: any = dict;
  for (const part of parts) {
    if (value && typeof value === "object" && part in value) {
      value = (value as any)[part];
    } else {
      // Fallback to English
      let fallback: any = translations.en;
      for (const p of parts) {
        if (fallback && typeof fallback === "object" && p in fallback) {
          fallback = (fallback as any)[p];
        } else {
          return key; // Return the key itself as last resort
        }
      }
      return typeof fallback === "string" ? fallback : key;
    }
  }
  return typeof value === "string" ? value : key;
}

export function getTranslations(lang?: SupportedLanguage) {
  return translations[lang ?? currentLanguage] ?? translations.en;
}

export default translations;
