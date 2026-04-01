import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Platform, Animated
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";

const FAQS = [
  { q: "What is VoxLink?", a: "VoxLink is a social platform where you can connect with professional listeners and hosts via audio or video calls. Get personalized support on topics like relationships, career, life coaching, and more." },
  { q: "Who are Hosts/Listeners?", a: "Hosts are verified professionals or experienced individuals who provide support and conversation. They specialize in various topics and are available for audio and video calls." },
  { q: "How can I make a call?", a: "Browse available hosts on the home screen, tap a host card to view their profile, then tap 'Talk Now' to start an audio or video call. Calls are charged in coins per minute." },
  { q: "What are Coins?", a: "Coins are VoxLink's in-app currency. You purchase coin packages from the Wallet section and spend them during calls with hosts at their listed rate per minute." },
  { q: "Is my conversation private?", a: "Yes, all conversations are private and confidential. We follow strict data protection policies and do not share personal conversation details with third parties." },
  { q: "How do I become a Host?", a: "Tap 'Become a Host' on your Profile page to submit an application. You'll need to verify your identity and complete a short onboarding process." },
  { q: "What if I run out of coins?", a: "If you run out of coins during a call, the call will end automatically. You can purchase more coins anytime from the Wallet section." },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  return (
    <TouchableOpacity
      onPress={() => setOpen(v => !v)}
      style={[styles.faqItem, { backgroundColor: colors.card }]}
      activeOpacity={0.8}
    >
      <View style={styles.faqRow}>
        <Text style={[styles.faqQ, { color: colors.text }]}>{q}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </View>
      {open && <Text style={[styles.faqA, { color: colors.mutedForeground }]}>{a}</Text>}
    </TouchableOpacity>
  );
}

export default function HelpCenterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = insets.top;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Help Center</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        {/* Banner */}
        <View style={[styles.banner, { backgroundColor: "#F3E6FF" }]}>
          <Image source={require("@/assets/images/help_blur.png")} style={styles.bannerImg} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.text }]}>Need Help or FAQ?</Text>
            <Text style={[styles.bannerSub, { color: colors.mutedForeground }]}>Find answers to common questions</Text>
          </View>
        </View>

        {/* Contact Support */}
        <TouchableOpacity style={[styles.contactCard, { backgroundColor: colors.card }]} activeOpacity={0.8}>
          <Image source={require("@/assets/images/help_person.png")} style={styles.contactImg} resizeMode="contain" />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.contactTitle, { color: colors.text }]}>Have an Issue?</Text>
            <Text style={[styles.contactSub, { color: colors.mutedForeground }]}>Contact our support team via email</Text>
          </View>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>

        {/* FAQ */}
        <Text style={[styles.faqTitle, { color: colors.text }]}>Frequently Asked Questions</Text>

        {FAQS.map((faq, i) => <FAQItem key={i} q={faq.q} a={faq.a} />)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  banner: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  bannerImg: { width: 56, height: 56 },
  bannerTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  bannerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  contactCard: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  contactImg: { width: 44, height: 44 },
  contactTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  contactSub: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  chevron: { width: 14, height: 14 },
  faqTitle: { fontSize: 16, fontFamily: "Poppins_700Bold", marginTop: 8 },
  faqItem: { borderRadius: 14, padding: 16, gap: 8 },
  faqRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  faqQ: { flex: 1, fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  faqA: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 20 },
});
