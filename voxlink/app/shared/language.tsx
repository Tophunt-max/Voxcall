import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Platform, Alert
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { SupportedLanguage } from "@/localization";

const ALL_LANGUAGES = [
  { code: "en" as SupportedLanguage, name: "English", native: "English" },
  { code: "hi" as SupportedLanguage, name: "Hindi", native: "हिन्दी" },
  { code: "ar" as SupportedLanguage, name: "Arabic", native: "العربية" },
  { code: "es" as SupportedLanguage, name: "Spanish", native: "Español" },
  { code: "zh" as SupportedLanguage, name: "Chinese", native: "中文" },
  // Display-only (no translations yet — can add later)
  { code: null, name: "French", native: "Français" },
  { code: null, name: "German", native: "Deutsch" },
  { code: null, name: "Portuguese", native: "Português" },
  { code: null, name: "Russian", native: "Русский" },
  { code: null, name: "Japanese", native: "日本語" },
  { code: null, name: "Korean", native: "한국어" },
  { code: null, name: "Turkish", native: "Türkçe" },
];

export default function LanguageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language, setLanguage } = useLanguage();
  const [selected, setSelected] = useState<string>(language);
  const topPad = insets.top;

  async function handleSelect(code: string | null, name: string) {
    if (!code) {
      Alert.alert(
        "Coming Soon",
        `${name} translation is coming soon. The app will continue in English.`
      );
      return;
    }
    setSelected(code);
    await setLanguage(code as SupportedLanguage);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>App Language</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Select your preferred language. Changes apply immediately.
        </Text>

        {ALL_LANGUAGES.map((lang) => {
          const isSelected = lang.code ? selected === lang.code : false;
          const isAvailable = !!lang.code;
          return (
            <TouchableOpacity
              key={lang.name}
              onPress={() => handleSelect(lang.code, lang.name)}
              style={[
                styles.langRow,
                {
                  backgroundColor: isSelected ? "#F0E4F8" : colors.card,
                  borderColor: isSelected ? colors.accent : colors.border,
                  opacity: isAvailable ? 1 : 0.6,
                }
              ]}
              activeOpacity={0.8}
            >
              <View style={styles.langInfo}>
                <View style={styles.langNameRow}>
                  <Text style={[styles.langName, { color: colors.text }]}>{lang.name}</Text>
                  {!isAvailable && (
                    <View style={[styles.comingSoonTag, { backgroundColor: colors.muted }]}>
                      <Text style={[styles.comingSoonText, { color: colors.mutedForeground }]}>Soon</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.langNative, { color: colors.mutedForeground }]}>{lang.native}</Text>
              </View>
              {isSelected && (
                <View style={[styles.checkCircle, { backgroundColor: colors.accent }]}>
                  <Image source={require("@/assets/icons/ic_check.png")} style={styles.checkIcon} tintColor="#fff" resizeMode="contain" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  subtitle: { fontSize: 13, fontFamily: "Poppins_400Regular", marginBottom: 8, lineHeight: 20 },
  langRow: { borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", borderWidth: 1.5 },
  langInfo: { flex: 1, gap: 2 },
  langNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  langName: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  comingSoonTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  comingSoonText: { fontSize: 9, fontFamily: "Poppins_500Medium" },
  langNative: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  checkCircle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  checkIcon: { width: 14, height: 14 },
});
