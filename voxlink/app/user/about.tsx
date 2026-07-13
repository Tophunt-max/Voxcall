import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Linking
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { fetchAppConfig } from "@/hooks/useAppConfig";

const APP_VERSION = "1.0.0";
const DEFAULT_SUPPORT_EMAIL = "hello@voxlink.app";

const STAT_VALUES = ["50K+", "1,200+", "2M+", "4.8"] as const;

const FEATURE_ICONS: any[] = [
  require("@/assets/icons/ic_call.png"),
  require("@/assets/icons/ic_secure.png"),
  require("@/assets/icons/ic_users.png"),
  require("@/assets/icons/ic_coin.png"),
  require("@/assets/icons/ic_chat.png"),
  require("@/assets/icons/ic_star.png"),
];

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const topPad = insets.top;

  const STATS = [
    { value: STAT_VALUES[0], label: t.aboutScreen.statActiveUsers },
    { value: STAT_VALUES[1], label: t.aboutScreen.statHosts },
    { value: STAT_VALUES[2], label: t.aboutScreen.statCallsMade },
    { value: STAT_VALUES[3], label: t.aboutScreen.statAppRating },
  ];

  const LINKS = [
    { icon: require("@/assets/icons/ic_search.png"),   label: t.aboutScreen.linkWebsite,   url: "https://voxlink.app", isContact: false },
    { icon: require("@/assets/icons/ic_arrow_up.png"), label: t.aboutScreen.linkTwitter,   url: "https://twitter.com/voxlink", isContact: false },
    { icon: require("@/assets/icons/ic_photo.png"),    label: t.aboutScreen.linkInstagram, url: "https://instagram.com/voxlink", isContact: false },
    { icon: require("@/assets/icons/ic_mail.png"),     label: t.aboutScreen.linkContact,   url: "mailto:hello@voxlink.app", isContact: true },
  ];

  const FEATURES = [
    t.aboutScreen.feature1,
    t.aboutScreen.feature2,
    t.aboutScreen.feature3,
    t.aboutScreen.feature4,
    t.aboutScreen.feature5,
    t.aboutScreen.feature6,
  ];

  // Admin-managed support email drives the "Contact Us" link.
  const [supportEmail, setSupportEmail] = useState(DEFAULT_SUPPORT_EMAIL);
  useEffect(() => {
    fetchAppConfig()
      .then((cfg) => { if (cfg?.support_email) setSupportEmail(cfg.support_email); })
      .catch(() => { /* keep default */ });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t.aboutScreen.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 50 }}>
        {/* Logo + version */}
        <View style={styles.logoSection}>
          <View style={[styles.logoCircle, { backgroundColor: "#F3E6FF" }]}>
            <Image source={require("@/assets/images/app_logo.png")} style={styles.logo} resizeMode="contain" />
          </View>
          <Text style={[styles.appName, { color: colors.text }]}>VoxLink</Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>{t.aboutScreen.appTagline}</Text>
          <View style={[styles.versionBadge, { backgroundColor: colors.surface }]}>
            <Text style={[styles.version, { color: colors.mutedForeground }]}>{t.aboutScreen.version.replace("{version}", APP_VERSION)}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={[styles.statsCard, { backgroundColor: colors.card }]}>
          {STATS.map((s, i) => (
            <React.Fragment key={s.label}>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.primary }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
              {i < STATS.length - 1 && <View style={[styles.statDiv, { backgroundColor: colors.border }]} />}
            </React.Fragment>
          ))}
        </View>

        {/* About text */}
        <View style={[styles.descCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.descTitle, { color: colors.text }]}>{t.aboutScreen.whatIsTitle}</Text>
          <Text style={[styles.desc, { color: colors.mutedForeground }]}>
            {t.aboutScreen.whatIsBody1}
          </Text>
          <Text style={[styles.desc, { color: colors.mutedForeground, marginTop: 10 }]}>
            {t.aboutScreen.whatIsBody2}
          </Text>
        </View>

        {/* Features */}
        <View style={[styles.featuresCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.featuresTitle, { color: colors.text }]}>{t.aboutScreen.keyFeatures}</Text>
          {FEATURES.map((text, idx) => (
            <View key={text} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: colors.primary + "15" }]}>
                <Image source={FEATURE_ICONS[idx]} style={{ width: 16, height: 16, tintColor: colors.primary }} resizeMode="contain" />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>{text}</Text>
            </View>
          ))}
        </View>

        {/* Social links */}
        <View style={[styles.linksCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.featuresTitle, { color: colors.text }]}>{t.aboutScreen.connectWithUs}</Text>
          {LINKS.map((l) => (
            <TouchableOpacity
              key={l.label}
              style={[styles.linkRow, { borderBottomColor: colors.border }]}
              onPress={() => Linking.openURL(l.isContact ? `mailto:${supportEmail}` : l.url)}
            >
              <View style={[styles.linkIcon, { backgroundColor: colors.surface }]}>
                <Image source={l.icon} style={{ width: 17, height: 17, tintColor: colors.primary }} resizeMode="contain" />
              </View>
              <Text style={[styles.linkLabel, { color: colors.text }]}>{l.label}</Text>
              <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 14, height: 14, tintColor: colors.mutedForeground, transform: [{ rotate: "180deg" }] }} resizeMode="contain" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Legal */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => router.push("/user/privacy")}>
            <Text style={[styles.legalLink, { color: colors.primary }]}>{t.profile.privacy}</Text>
          </TouchableOpacity>
          <Text style={[styles.legalSep, { color: colors.border }]}>|</Text>
          <TouchableOpacity onPress={() => router.push("/user/help-center")}>
            <Text style={[styles.legalLink, { color: colors.primary }]}>{t.aboutScreen.helpCenter}</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.copyright, { color: colors.mutedForeground }]}>
          {t.aboutScreen.copyright}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  logoSection: { alignItems: "center", paddingVertical: 28, gap: 6 },
  logoCircle: { width: 90, height: 90, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  logo: { width: 60, height: 60 },
  appName: { fontSize: 24, fontFamily: "Poppins_700Bold" },
  tagline: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  versionBadge: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 16, marginTop: 4 },
  version: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  statsCard: { marginHorizontal: 16, borderRadius: 16, flexDirection: "row", alignItems: "center", paddingVertical: 18 },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", textAlign: "center" },
  statDiv: { width: 1, height: 32 },
  descCard: { marginHorizontal: 16, marginTop: 14, borderRadius: 16, padding: 16 },
  descTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold", marginBottom: 8 },
  desc: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 21 },
  featuresCard: { marginHorizontal: 16, marginTop: 14, borderRadius: 16, padding: 16, gap: 12 },
  featuresTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold", marginBottom: 4 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  linksCard: { marginHorizontal: 16, marginTop: 14, borderRadius: 16, padding: 16 },
  linkRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  linkIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  linkLabel: { flex: 1, fontSize: 14, fontFamily: "Poppins_500Medium" },
  legalRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 20 },
  legalLink: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  legalSep: { fontSize: 14 },
  copyright: { textAlign: "center", fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 8, marginBottom: 10 },
});
