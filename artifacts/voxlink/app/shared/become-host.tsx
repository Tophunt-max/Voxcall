import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Platform, Alert
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const BENEFITS = [
  { icon: require("@/assets/icons/ic_coin.png"), title: "Earn Coins", desc: "Get paid coins for every minute you spend helping others" },
  { icon: require("@/assets/icons/ic_experience.png"), title: "Share Experience", desc: "Use your knowledge and experience to help people grow" },
  { icon: require("@/assets/icons/ic_guaranteed.png"), title: "Guaranteed Chats", desc: "Users are matched directly to available hosts" },
  { icon: require("@/assets/icons/ic_secure.png"), title: "Safe Platform", desc: "All interactions are monitored for a safe environment" },
];

export default function BecomeHostScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const topPad = insets.top;

  const handleApply = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    setLoading(false);
    router.replace("/shared/become-host-success");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Become a Host</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={[styles.heroBanner, { backgroundColor: "#F3E6FF" }]}>
          <Image source={require("@/assets/images/host_promo_blur.png")} style={styles.heroImg} resizeMode="contain" />
          <Text style={[styles.heroTitle, { color: colors.text }]}>Start Your Journey as a Host</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>Connect with users who need guidance and earn coins doing what you love</Text>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Why Become a Host?</Text>

        {BENEFITS.map((b, i) => (
          <View key={i} style={[styles.benefitCard, { backgroundColor: colors.card }]}>
            <View style={[styles.benefitIconWrap, { backgroundColor: "#F0E4F8" }]}>
              <Image source={b.icon} style={styles.benefitIcon} tintColor={colors.accent} resizeMode="contain" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.benefitTitle, { color: colors.text }]}>{b.title}</Text>
              <Text style={[styles.benefitDesc, { color: colors.mutedForeground }]}>{b.desc}</Text>
            </View>
          </View>
        ))}

        {/* Requirements */}
        <View style={[styles.reqCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.reqTitle, { color: colors.text }]}>Requirements</Text>
          {["Valid government-issued ID", "Clear profile photo", "Stable internet connection", "Age 18 or above"].map((req, i) => (
            <View key={i} style={styles.reqRow}>
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.reqText, { color: colors.mutedForeground }]}>{req}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.applyBtn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
          onPress={handleApply}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={styles.applyBtnText}>{loading ? "Submitting..." : "Apply Now"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  heroBanner: { borderRadius: 20, padding: 20, alignItems: "center", gap: 12, marginBottom: 20 },
  heroImg: { width: 120, height: 100 },
  heroTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", textAlign: "center" },
  heroSub: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontFamily: "Poppins_700Bold", marginBottom: 12 },
  benefitCard: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10 },
  benefitIconWrap: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  benefitIcon: { width: 24, height: 24 },
  benefitTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  benefitDesc: { fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18 },
  reqCard: { borderRadius: 16, padding: 16, marginBottom: 20, marginTop: 10, gap: 10 },
  reqTitle: { fontSize: 15, fontFamily: "Poppins_700Bold", marginBottom: 4 },
  reqRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  reqText: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  applyBtn: { borderRadius: 14, height: 54, alignItems: "center", justifyContent: "center" },
  applyBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
