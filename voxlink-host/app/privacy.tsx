import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const SECTIONS = [
  {
    title: "1. Information We Collect",
    body: "We collect information you provide directly to us, such as when you create a host account, update your profile, complete KYC verification, or contact us for support. This includes your name, email address, profile picture, identity documents, and banking information for payouts.\n\nWe also collect information automatically when you use VoxLink Host, including log data, device information, location information (if permitted), and usage data such as call history, earnings, and the time you spend online."
  },
  {
    title: "2. How We Use Your Information",
    body: "We use the information we collect to provide, maintain, and improve our host services, process earnings and payout transactions, send notifications including incoming call alerts and earnings updates.\n\nWe also use your data to respond to your comments, questions, and requests, monitor call quality and platform safety, detect and prevent fraudulent activity, and ensure compliance with applicable laws."
  },
  {
    title: "3. Sharing of Information",
    body: "We do not share your personal information with third parties except as described in this policy. We may share information with payment processors and banking partners to facilitate payouts, vendors who provide services on our behalf, and when required by law or legal process."
  },
  {
    title: "4. Call Data & Audio",
    body: "Audio and video call content is transmitted through encrypted channels. We do not record or store the content of your calls. Call metadata (duration, participants, timestamps) is stored to provide billing, earnings tracking, and history features."
  },
  {
    title: "5. KYC & Identity Verification",
    body: "Identity documents submitted for KYC verification are processed by our trusted verification partner. These documents are used solely for identity verification purposes and are stored securely with industry-standard encryption. We do not share your identity documents with third parties beyond what is necessary for verification."
  },
  {
    title: "6. Earnings & Payouts",
    body: "Banking and payment information is processed through secure third-party payment processors. We do not store full banking details on our servers. All earning transactions are logged for accounting, tax reporting, and dispute resolution purposes."
  },
  {
    title: "7. Data Security",
    body: "We take reasonable measures to protect your information from loss, theft, misuse, and unauthorized access. All data is encrypted in transit using TLS and at rest using AES-256 encryption."
  },
  {
    title: "8. Data Retention",
    body: "We retain personal information for as long as necessary to provide our services and fulfill the purposes outlined in this Privacy Policy, or as required by applicable law. You may request deletion of your account and associated data at any time through the Settings screen."
  },
  {
    title: "9. Your Rights",
    body: "You have the right to access, update, or delete your personal information at any time. You may also object to processing, request data portability, or withdraw consent. To exercise these rights, contact us through the Help Center."
  },
  {
    title: "10. Changes to This Policy",
    body: "We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the 'Last Updated' date. Your continued use of VoxLink Host after any change constitutes your acceptance of the new Privacy Policy."
  },
];

export default function PrivacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<number | null>(0);
  const topPad = insets.top;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={[styles.banner, { backgroundColor: "#F3E6FF" }]}>
          <View style={[styles.bannerIcon, { backgroundColor: "#A00EE7" }]}>
            <Feather name="shield" size={28} color="#fff" />
          </View>
          <Text style={[styles.bannerTitle, { color: "#111329" }]}>Your Privacy Matters</Text>
          <Text style={[styles.bannerSub, { color: "#757396" }]}>
            This policy explains how VoxLink Host collects, uses, and protects your data.
          </Text>
          <Text style={[styles.lastUpdated, { color: "#757396" }]}>Last Updated: March 1, 2026</Text>
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
                <Feather name={expanded === i ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
              </View>
              {expanded === i && (
                <Text style={[styles.accordionBody, { color: colors.mutedForeground }]}>{s.body}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.contactBox, { backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 20 }]}>
          <Feather name="mail" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.contactTitle, { color: colors.text }]}>Questions about Privacy?</Text>
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
