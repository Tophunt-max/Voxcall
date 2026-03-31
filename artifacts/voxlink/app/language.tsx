import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Platform
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिंदी" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
];

export default function LanguageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState("en");
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.backIcon, { tintColor: colors.text }]} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>App Language</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Select your preferred language</Text>

        {LANGUAGES.map(lang => (
          <TouchableOpacity
            key={lang.code}
            onPress={() => setSelected(lang.code)}
            style={[
              styles.langRow,
              {
                backgroundColor: selected === lang.code ? "#F0E4F8" : colors.card,
                borderColor: selected === lang.code ? colors.accent : colors.border,
              }
            ]}
            activeOpacity={0.8}
          >
            <View style={styles.langInfo}>
              <Text style={[styles.langName, { color: colors.text }]}>{lang.name}</Text>
              <Text style={[styles.langNative, { color: colors.mutedForeground }]}>{lang.native}</Text>
            </View>
            {selected === lang.code && (
              <View style={[styles.checkCircle, { backgroundColor: colors.accent }]}>
                <Image source={require("@/assets/icons/ic_check.png")} style={[styles.checkIcon, { tintColor: "#fff" }]} resizeMode="contain" />
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  subtitle: { fontSize: 13, fontFamily: "Poppins_400Regular", marginBottom: 8 },
  langRow: { borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", borderWidth: 1.5 },
  langInfo: { flex: 1, gap: 2 },
  langName: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  langNative: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  checkCircle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  checkIcon: { width: 14, height: 14 },
});
