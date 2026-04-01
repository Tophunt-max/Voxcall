import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Share,
  Clipboard,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { showSuccessToast } from "@/components/Toast";

export default function ReferralScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [referral, setReferral] = useState<{ code: string; referred: number; coins_earned: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    API.getReferral()
      .then(setReferral)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = () => {
    if (!referral?.code) return;
    Clipboard.setString(referral.code);
    setCopied(true);
    showSuccessToast("Referral code copied!", "Copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    if (!referral?.code) return;
    Share.share({
      message: `Join VoxLink and connect with amazing hosts for audio & video calls!\n\nUse my referral code: ${referral.code} to get bonus coins on signup!\n\nDownload now: https://voxlink.app`,
      title: "Join VoxLink",
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient
        colors={["#A00EE7", "#6A00B8"]}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Refer & Earn</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {/* Hero card */}
        <View style={[styles.heroCard, { backgroundColor: "#F4E8FD" }]}>
          <Text style={styles.heroEmoji}>🎁</Text>
          <Text style={[styles.heroTitle, { color: "#6A00B8" }]}>Invite Friends, Earn Coins!</Text>
          <Text style={[styles.heroSub, { color: "#9A74BD" }]}>
            For every friend who joins VoxLink using your referral code, both of you get bonus coins!
          </Text>
        </View>

        {/* Referral Code */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Referral Code</Text>
        {loading ? (
          <View style={styles.codeLoading}>
            <ActivityIndicator color="#A00EE7" />
          </View>
        ) : (
          <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: "#A00EE7" }]}>
            <Text style={[styles.code, { color: "#A00EE7" }]}>{referral?.code ?? "—"}</Text>
            <TouchableOpacity
              onPress={handleCopy}
              style={[styles.copyBtn, { backgroundColor: copied ? "#0BAF23" : "#A00EE7" }]}
            >
              <Feather name={copied ? "check" : "copy"} size={16} color="#fff" />
              <Text style={styles.copyBtnText}>{copied ? "Copied!" : "Copy"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Share button */}
        <TouchableOpacity
          onPress={handleShare}
          style={[styles.shareBtn, { backgroundColor: "#A00EE7" }]}
          activeOpacity={0.88}
        >
          <Feather name="share-2" size={18} color="#fff" />
          <Text style={styles.shareBtnText}>Share with Friends</Text>
        </TouchableOpacity>

        {/* Stats */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Referral Stats</Text>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statNum, { color: "#A00EE7" }]}>{referral?.referred ?? 0}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Friends Invited</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <View style={styles.statCoinRow}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={styles.statCoin} resizeMode="contain" />
              <Text style={[styles.statNum, { color: "#D97706" }]}>{referral?.coins_earned ?? 0}</Text>
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Coins Earned</Text>
          </View>
        </View>

        {/* How it works */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>How it Works</Text>
        <View style={[styles.stepsCard, { backgroundColor: colors.card }]}>
          {[
            { step: "1", icon: "share-2", text: "Share your unique referral code with friends" },
            { step: "2", icon: "user-plus", text: "Friend signs up using your code" },
            { step: "3", icon: "gift", text: "You both receive bonus coins instantly!" },
          ].map((item) => (
            <View key={item.step} style={styles.stepRow}>
              <View style={[styles.stepNum, { backgroundColor: "#A00EE7" }]}>
                <Text style={styles.stepNumText}>{item.step}</Text>
              </View>
              <Feather name={item.icon as any} size={20} color="#A00EE7" style={styles.stepIcon} />
              <Text style={[styles.stepText, { color: colors.text }]}>{item.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 20,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  content: { padding: 20, gap: 4 },
  heroCard: {
    borderRadius: 20, padding: 24, alignItems: "center",
    marginBottom: 24, gap: 10,
  },
  heroEmoji: { fontSize: 52 },
  heroTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  heroSub: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold", marginTop: 8, marginBottom: 12 },
  codeLoading: { height: 72, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  codeCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 16, borderWidth: 2, borderStyle: "dashed",
    paddingHorizontal: 20, paddingVertical: 16, marginBottom: 16,
  },
  code: { fontSize: 28, fontFamily: "Poppins_700Bold", letterSpacing: 6 },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
  },
  copyBtnText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 16, borderRadius: 14, marginBottom: 24,
  },
  shareBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
  statCard: {
    flex: 1, borderRadius: 16, padding: 20, alignItems: "center", gap: 6,
    elevation: 2,
  },
  statCoinRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statCoin: { width: 22, height: 22 },
  statNum: { fontSize: 28, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Poppins_400Regular", textAlign: "center" },
  stepsCard: { borderRadius: 16, padding: 20, gap: 18, marginBottom: 8 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepNum: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  stepNumText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold" },
  stepIcon: { width: 20 },
  stepText: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular", lineHeight: 20 },
});
