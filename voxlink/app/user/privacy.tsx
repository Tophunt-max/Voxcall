import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";

const SECTION_KEYS = [
  ["s1Title", "s1Body"],
  ["s2Title", "s2Body"],
  ["s3Title", "s3Body"],
  ["s4Title", "s4Body"],
  ["s5Title", "s5Body"],
  ["s6Title", "s6Body"],
  ["s7Title", "s7Body"],
  ["s8Title", "s8Body"],
  ["s9Title", "s9Body"],
  ["s10Title", "s10Body"],
] as const;

export default function PrivacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<number | null>(0);
  const topPad = insets.top;

  const SECTIONS = SECTION_KEYS.map(([titleKey, bodyKey]) => ({
    title: t.privacyScreen[titleKey],
    body: t.privacyScreen[bodyKey],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t.profile.privacy}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Banner */}
        <View style={[styles.banner, { backgroundColor: "#F3E6FF" }]}>
          <View style={[styles.bannerIcon, { backgroundColor: "#A00EE7" }]}>
            <Image source={require("@/assets/icons/ic_secure.png")} style={{ width: 28, height: 28, tintColor: "#fff" }} resizeMode="contain" />
          </View>
          <Text style={[styles.bannerTitle, { color: "#111329" }]}>{t.privacyScreen.bannerTitle}</Text>
          <Text style={[styles.bannerSub, { color: "#757396" }]}>
            {t.privacyScreen.bannerSub}
          </Text>
          <Text style={[styles.lastUpdated, { color: "#757396" }]}>{t.privacyScreen.lastUpdated}</Text>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 16, gap: 10 }}>
          {SECTIONS.map((s, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.accordion, { backgroundColor: colors.card, borderColor: expanded === i ? colors.primary : colors.border }]}
              onPress={() => setExpanded(expanded === i ? null : i)}
              activeOpacity={0.85}
            >
              <View style={styles.accordionHeader}>
                <Text style={[styles.accordionTitle, { color: colors.text }]}>{s.title}</Text>
                <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 16, height: 16, tintColor: colors.mutedForeground, transform: [{ rotate: expanded === i ? "90deg" : "-90deg" }] }} resizeMode="contain" />
              </View>
              {expanded === i && (
                <Text style={[styles.accordionBody, { color: colors.mutedForeground }]}>{s.body}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.contactBox, { backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 20 }]}>
          <Image source={require("@/assets/icons/ic_mail.png")} style={{ width: 20, height: 20, tintColor: colors.primary }} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.contactTitle, { color: colors.text }]}>{t.privacyScreen.contactTitle}</Text>
            <Text style={[styles.contactSub, { color: colors.mutedForeground }]}>privacy@voxlink.app</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  banner: { margin: 16, borderRadius: 16, padding: 24, alignItems: "center", gap: 8 },
  bannerIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  bannerTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", textAlign: "center" },
  bannerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 20 },
  lastUpdated: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  accordion: { borderRadius: 12, borderWidth: 1, padding: 14 },
  accordionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  accordionTitle: { flex: 1, fontSize: 13, fontFamily: "Poppins_600SemiBold", lineHeight: 20 },
  accordionBody: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 21, marginTop: 10 },
  contactBox: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12 },
  contactTitle: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  contactSub: { fontSize: 12, fontFamily: "Poppins_400Regular" },
});
