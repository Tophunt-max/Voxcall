import React from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Platform, Linking
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const APP_VERSION = "1.0.0";

const STATS = [
  { value: "50K+", label: "Active Users" },
  { value: "1,200+", label: "Hosts" },
  { value: "2M+", label: "Calls Made" },
  { value: "4.8", label: "App Rating" },
];

const LINKS = [
  { icon: "globe",        label: "Website",       url: "https://voxlink.app" },
  { icon: "twitter",      label: "Twitter / X",   url: "https://twitter.com/voxlink" },
  { icon: "instagram",    label: "Instagram",     url: "https://instagram.com/voxlink" },
  { icon: "mail",         label: "Contact Us",    url: "mailto:hello@voxlink.app" },
];

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = insets.top;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>About VoxLink</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 50 }}>
        {/* Logo + version */}
        <View style={styles.logoSection}>
          <View style={[styles.logoCircle, { backgroundColor: "#F3E6FF" }]}>
            <Image source={require("@/assets/images/app_logo.png")} style={styles.logo} resizeMode="contain" />
          </View>
          <Text style={[styles.appName, { color: colors.text }]}>VoxLink</Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>Voice & Video Connection</Text>
          <View style={[styles.versionBadge, { backgroundColor: colors.surface }]}>
            <Text style={[styles.version, { color: colors.mutedForeground }]}>Version {APP_VERSION}</Text>
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
          <Text style={[styles.descTitle, { color: colors.text }]}>What is VoxLink?</Text>
          <Text style={[styles.desc, { color: colors.mutedForeground }]}>
            VoxLink is a social audio and video calling platform that connects people with verified hosts for meaningful conversations. Whether you need life advice, language practice, emotional support, or just someone to talk to — our hosts are here for you.
          </Text>
          <Text style={[styles.desc, { color: colors.mutedForeground, marginTop: 10 }]}>
            Hosts are real, trained individuals vetted by our team. Every call is secure, private, and backed by our coin-based payment system — so you only pay for the time you use.
          </Text>
        </View>

        {/* Features */}
        <View style={[styles.featuresCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.featuresTitle, { color: colors.text }]}>Key Features</Text>
          {[
            { icon: "phone", text: "HD Audio & Video Calls" },
            { icon: "shield", text: "End-to-End Encrypted" },
            { icon: "users", text: "1,200+ Verified Hosts" },
            { icon: "dollar-sign", text: "Coin-Based Fair Pricing" },
            { icon: "message-circle", text: "In-App Chat" },
            { icon: "star", text: "Rated Reviews System" },
          ].map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: colors.primary + "15" }]}>
                <Feather name={f.icon as any} size={16} color={colors.primary} />
              </View>
              <Text style={[styles.featureText, { color: colors.text }]}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* Social links */}
        <View style={[styles.linksCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.featuresTitle, { color: colors.text }]}>Connect With Us</Text>
          {LINKS.map((l) => (
            <TouchableOpacity
              key={l.label}
              style={[styles.linkRow, { borderBottomColor: colors.border }]}
              onPress={() => Linking.openURL(l.url)}
            >
              <View style={[styles.linkIcon, { backgroundColor: colors.surface }]}>
                <Feather name={l.icon as any} size={17} color={colors.primary} />
              </View>
              <Text style={[styles.linkLabel, { color: colors.text }]}>{l.label}</Text>
              <Feather name="external-link" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Legal */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => router.push("/shared/privacy")}>
            <Text style={[styles.legalLink, { color: colors.primary }]}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={[styles.legalSep, { color: colors.border }]}>|</Text>
          <TouchableOpacity onPress={() => router.push("/shared/help-center")}>
            <Text style={[styles.legalLink, { color: colors.primary }]}>Help Center</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.copyright, { color: colors.mutedForeground }]}>
          © 2026 VoxLink Inc. All rights reserved.
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
