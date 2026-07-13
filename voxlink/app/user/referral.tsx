import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
} from "react-native";
import * as ClipboardModule from "expo-clipboard";
import { crossShare } from "@/utils/fileUpload";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { API } from "@/services/api";
import { showSuccessToast, showErrorToast } from "@/components/Toast";
import { useAppConfig } from "@/hooks/useAppConfig";
import { buildInviteUrl } from "@/utils/pendingReferral";

type LbEntry = { rank: number; name: string; avatar: string | null; referrals: number; coins: number; is_me: boolean };

export default function ReferralScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useLanguage();

  const [referral, setReferral] = useState<{
    code: string;
    referred: number;
    coins_earned: number;
    config?: { referrer_reward: number; new_user_reward: number; min_calls_to_unlock: number; active: boolean };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Referral contest leaderboard — shown only when the admin enables it.
  const { config } = useAppConfig();
  const contestOn = config?.referral_contest_enabled === "1";
  const [leaderboard, setLeaderboard] = useState<LbEntry[]>([]);
  const [myRank, setMyRank] = useState<{ referrals: number; coins: number; rank: number | null } | null>(null);
  useEffect(() => {
    if (!contestOn) return;
    API.getReferralLeaderboard()
      .then((d) => { setLeaderboard(d.leaderboard ?? []); setMyRank(d.me ?? null); })
      .catch(() => {});
  }, [contestOn]);

  // Admin-managed reward amounts (with sensible fallbacks so the copy is never
  // blank while the request is in flight or on an older backend).
  const referrerReward = referral?.config?.referrer_reward ?? 100;
  const newUserReward = referral?.config?.new_user_reward ?? 50;
  const minCalls = referral?.config?.min_calls_to_unlock ?? 1;

  useEffect(() => {
    API.getReferral()
      .then(setReferral)
      .catch(() => { showErrorToast(t.referralScreen.failedLoad); })
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = async () => {
    if (!referral?.code) return;
    try {
      await ClipboardModule.setStringAsync(referral.code);
      setCopied(true);
      showSuccessToast(t.referralScreen.codeCopied, t.common.copied);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showErrorToast(t.referralScreen.copyFailed);
    }
  };

  const handleShare = async () => {
    if (!referral?.code) return;
    try {
      // Invite link carries the referral code (?ref=CODE). A friend who opens
      // it lands on the login screen with the code already applied — no manual
      // typing. The message still shows the raw code as a fallback for anyone
      // who signs up on native without the link auto-filling it.
      const inviteUrl = buildInviteUrl(referral.code);
      await crossShare({
        message: t.referralScreen.shareMessage.replace("{code}", referral.code),
        title: t.referralScreen.shareTitle,
        url: inviteUrl,
      });
    } catch {
      // User cancelled the share sheet or it failed — non-fatal, no toast needed.
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient
        colors={["#A00EE7", "#6A00B8"]}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: "#fff" }} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.referralScreen.title}</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {/* Hero card */}
        <View style={[styles.heroCard, { backgroundColor: "#F4E8FD" }]}>
          <Text style={styles.heroEmoji}>🎁</Text>
          <Text style={[styles.heroTitle, { color: "#6A00B8" }]}>{t.referralScreen.heroTitle}</Text>
          <Text style={[styles.heroSub, { color: "#9A74BD" }]}>
            {t.referralScreen.heroSub
              .replace("{newUser}", String(newUserReward))
              .replace("{referrer}", String(referrerReward))}
          </Text>
        </View>

        {/* Referral Code */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.referralScreen.yourCode}</Text>
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
              <Image source={copied ? require("@/assets/icons/ic_check.png") : require("@/assets/icons/ic_copy.png")} style={{ width: 16, height: 16, tintColor: "#fff" }} resizeMode="contain" />
              <Text style={styles.copyBtnText}>{copied ? t.common.copied : t.common.copy}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Share button */}
        <TouchableOpacity
          onPress={handleShare}
          style={[styles.shareBtn, { backgroundColor: "#A00EE7" }]}
          activeOpacity={0.88}
        >
          <Image source={require("@/assets/icons/ic_arrow_up.png")} style={{ width: 18, height: 18, tintColor: "#fff" }} resizeMode="contain" />
          <Text style={styles.shareBtnText}>{t.referralScreen.shareWithFriends}</Text>
        </TouchableOpacity>

        {/* Stats */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.referralScreen.yourStats}</Text>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.statNum, { color: "#A00EE7" }]}>{referral?.referred ?? 0}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.referralScreen.friendsInvited}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <View style={styles.statCoinRow}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={styles.statCoin} resizeMode="contain" />
              <Text style={[styles.statNum, { color: "#D97706" }]}>{referral?.coins_earned ?? 0}</Text>
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.referralScreen.coinsEarned}</Text>
          </View>
        </View>

        {/* Referral contest leaderboard (admin-toggled) */}
        {contestOn && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>🏆 Top Referrers</Text>
            <View style={[styles.lbCard, { backgroundColor: colors.card }]}>
              {leaderboard.length === 0 ? (
                <Text style={[styles.lbEmpty, { color: colors.mutedForeground }]}>Abhi koi nahi — invite karke #1 ban jaaiye!</Text>
              ) : (
                leaderboard.map((r) => (
                  <View key={r.rank} style={[styles.lbRow, r.is_me && { backgroundColor: "#F4E8FD" }]}>
                    <Text style={[styles.lbRank, { color: r.rank <= 3 ? "#A00EE7" : colors.mutedForeground }]}>
                      {r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : `#${r.rank}`}
                    </Text>
                    <Image source={r.avatar ? { uri: r.avatar } : require("@/assets/images/home_call_person.png")} style={styles.lbAvatar} />
                    <Text style={[styles.lbName, { color: colors.text }]} numberOfLines={1}>{r.is_me ? "You" : r.name}</Text>
                    <Text style={[styles.lbCount, { color: "#A00EE7" }]}>{r.referrals}</Text>
                  </View>
                ))
              )}
              {myRank?.rank != null && myRank.rank > leaderboard.length && (
                <View style={[styles.lbRow, { backgroundColor: "#F4E8FD" }]}>
                  <Text style={[styles.lbRank, { color: colors.mutedForeground }]}>#{myRank.rank}</Text>
                  <Image source={require("@/assets/images/home_call_person.png")} style={styles.lbAvatar} />
                  <Text style={[styles.lbName, { color: colors.text }]}>You</Text>
                  <Text style={[styles.lbCount, { color: "#A00EE7" }]}>{myRank.referrals}</Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* How it works */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t.referralScreen.howItWorks}</Text>
        <View style={[styles.stepsCard, { backgroundColor: colors.card }]}>
          {[
            { step: "1", icon: require("@/assets/icons/ic_arrow_up.png"), text: t.referralScreen.step1 },
            { step: "2", icon: require("@/assets/icons/ic_profile.png"), text: t.referralScreen.step2.replace("{count}", String(newUserReward)) },
            { step: "3", icon: require("@/assets/icons/ic_bonus.png"), text: minCalls > 0 ? (minCalls === 1 ? t.referralScreen.step3OneCall.replace("{reward}", String(referrerReward)) : t.referralScreen.step3Calls.replace("{count}", String(minCalls)).replace("{reward}", String(referrerReward))) : t.referralScreen.step3Instant.replace("{reward}", String(referrerReward)) },
          ].map((item) => (
            <View key={item.step} style={styles.stepRow}>
              <View style={[styles.stepNum, { backgroundColor: "#A00EE7" }]}>
                <Text style={styles.stepNumText}>{item.step}</Text>
              </View>
              <Image source={item.icon} style={[styles.stepIcon, { height: 20, tintColor: "#A00EE7" }]} resizeMode="contain" />
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
  lbCard: { borderRadius: 16, padding: 8, marginBottom: 16, gap: 2 },
  lbEmpty: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center", paddingVertical: 16 },
  lbRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, gap: 10 },
  lbRank: { width: 32, fontSize: 14, fontFamily: "Poppins_700Bold", textAlign: "center" },
  lbAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#eee" },
  lbName: { flex: 1, fontSize: 14, fontFamily: "Poppins_500Medium" },
  lbCount: { fontSize: 15, fontFamily: "Poppins_700Bold" },
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


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
