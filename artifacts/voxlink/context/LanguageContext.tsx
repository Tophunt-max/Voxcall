// VoxLink Language Context
// Provides current language + change function + translator to all screens

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { I18nManager } from "react-native";
import { setItem, getItem, StorageKeys } from "@/utils/storage";
import { setLanguage, isRTL, getTranslations, LANGUAGES, SupportedLanguage } from "@/localization";
import type { Translations } from "@/localization/en";

interface LanguageContextValue {
  language: SupportedLanguage;
  isRTL: boolean;
  t: Translations;
  setLanguage: (lang: SupportedLanguage) => Promise<void>;
  languages: typeof LANGUAGES;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "app_language";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<SupportedLanguage>("en");

  useEffect(() => {
    (async () => {
      const saved = await getItem<SupportedLanguage>(STORAGE_KEY);
      if (saved && LANGUAGES.find((l) => l.code === saved)) {
        applyLanguage(saved, false);
      }
    })();
  }, []);

  function applyLanguage(lang: SupportedLanguage, save = true) {
    setLanguage(lang);
    setLang(lang);
    const rtl = isRTL(lang);
    if (I18nManager.isRTL !== rtl) {
      I18nManager.forceRTL(rtl);
    }
    if (save) {
      setItem(STORAGE_KEY, lang).catch(() => {});
    }
  }

  const changeLanguage = useCallback(async (lang: SupportedLanguage) => {
    applyLanguage(lang, true);
  }, []);

  const translations = getTranslations(language);

  return (
    <LanguageContext.Provider
      value={{
        language,
        isRTL: isRTL(language),
        t: translations,
        setLanguage: changeLanguage,
        languages: LANGUAGES,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
