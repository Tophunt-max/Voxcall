import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator
} from "react-native";
import * as ClipboardModule from "expo-clipboard";
import { crossShare } from "@/utils/fileUpload";
import { router } from "expo-router";
import { IconView } from "@/components/IconView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { API } from "@/services/api";
import { showSuccessToast, showErrorToast } from "@/components/Toast";
import { buildInviteUrl } from "@/utils/pendingReferral";

export default function ReferralScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [referral, setReferral] = useState<{
    code: string;
    referred: number;
    coins_earned: number;
    config?: { referrer_reward: number; new_user_reward: number; min_calls_to_unlock: number; active: boolean };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Admin-managed reward amounts (with sensible fallbacks).
  const referrerReward = referral?.config?.referrer_reward ?? 100;
  const newUserReward = referral?.config?.new_user_reward ?? 50;
  const minCalls = referral?.config?.min_calls_to_unlock ?? 1;

  useEffect(() => {
    API.getReferral()
      .then(setReferral)
      .catch(() => { showErrorToast(t.referralScreen.loadFailed); })
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = async () => {
    if (!referral?.code) return;
    try {
      await ClipboardModule.setStringAsync(referral.code);
      setCopied(true);
      showSuccessToast(t.referralScreen.copiedToast, t.referralScreen.copiedTitle);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showErrorToast(t.referralScreen.copyFailed);
    }
  };

  const handleShare = async () => {
    if (!referral?.code) return;
    try {
      // Invite link carries the referral code (?ref=CODE) so a friend who opens
      // it lands on the host signup with the code already applied — no manual
      // typing. The raw code stays in the message as a fallback.
      const inviteUrl = buildInviteUrl(referral.code);
      await crossShare({
        message: t.referralScreen.shareMessage.replace("{code}", referral.code),
        title: t.referralScreen.shareTitle,
        url: inviteUrl,
      });
    } catch {
      // user dismissed the share sheet or it's unavailable — non-fatal
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[colors.accent, "#6A00B8"]}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backBtn}>
          <IconView name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.referralScreen.title}</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={[styles.heroCard, { backgroundColor: "#F4E8FD" }]}>
          <Text style={styles.heroEmoji}>🎁</Text>
          <Text style={[styles.heroTitle, { color: "#6A00B8" }]}>{t.referralScreen.heroTitle}</Text>
          <Text style={[styles.heroSub, { color: "#9A74BD" }]}>
            {t.referralScreen.heroSubA}{newUserReward}{t.referralScreen.coinsAnd}{referrerReward}{t.referralScreen.coinsBang}
          </Text>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.referralScreen.yourCode}</Text>
        {loading ? (
          <View style={styles.codeLoading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.accent }]}>
            <Text style={[styles.code, { color: colors.accent }]}>{referral?.code ?? "—"}</Text>
            <TouchableOpacity
              onPress={handleCopy}
              style={[styles.copyBtn, { backgroundColor: copied ? "#0BAF23" : colors.accent }]}
            >
              <IconView name={copied ? "check" : "copy"} size={16} color="#fff" />
              <Text style={styles.copyBtnText}>{copied ? t.referralScreen.copied : t.referralScreen.copy}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={handleShare}
          style={[styles.shareBtn, { backgroundColor: colors.accent }]}
          activeOpacity={0.88}
        >
          <IconView name="share-2" size={18} color="#fff" />
          <Text style={styles.shareBtnText}>{t.referralScreen.shareBtn}</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.referralScreen.yourStats}</Text>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statNum, { color: colors.accent }]}>{referral?.referred ?? 0}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.referralScreen.hostsReferred}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <View style={styles.statCoinRow}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={styles.statCoin} resizeMode="contain" />
              <Text style={[styles.statNum, { color: "#D97706" }]}>{referral?.coins_earned ?? 0}</Text>
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.referralScreen.coinsEarned}</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.referralScreen.howItWorks}</Text>
        <View style={[styles.stepsCard, { backgroundColor: colors.card }]}>
          {[
            { step: "1", icon: "share-2", text: t.referralScreen.step1 },
            { step: "2", icon: "user-plus", text: t.referralScreen.step2 },
            { step: "3", icon: "phone", text: minCalls > 0 ? (minCalls === 1 ? t.referralScreen.step3Single : t.referralScreen.step3Plural.replace("{n}", String(minCalls))) : t.referralScreen.step3Default },
            { step: "4", icon: "gift", text: `${t.referralScreen.step4a}${referrerReward}${t.referralScreen.step4b}${newUserReward}${t.referralScreen.step4c}` },
          ].map((item) => (
            <View key={item.step} style={styles.stepRow}>
              <View style={[styles.stepNum, { backgroundColor: colors.accent }]}>
                <Text style={styles.stepNumText}>{item.step}</Text>
              </View>
              <IconView name={item.icon} size={20} color={colors.accent} />
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
