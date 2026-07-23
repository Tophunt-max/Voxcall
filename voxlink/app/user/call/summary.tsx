import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { formatDuration } from "@/utils/format";
import { StarRating } from "@/components/StarRating";
import { API } from "@/services/api";
import { showErrorToast } from "@/components/Toast";
import { useAppRatingPrompt } from "@/hooks/useAppRatingPrompt";

export default function CallSummaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const {
    duration,
    type,
    participantName,
    sessionId,
    coinsSpent,
    freeMinutesUsed,
    autoEnded,
    endReason,
  } = useLocalSearchParams<{
    duration: string;
    type: string;
    participantName: string;
    participantId: string;
    sessionId: string;
    coinsSpent: string;
    freeMinutesUsed: string;
    autoEnded: string;
    endReason: string;
  }>();

  const durationSec  = parseInt(duration  ?? "0", 10);
  const coinsUsed    = parseInt(coinsSpent ?? "0", 10);
  const freeMinUsed  = parseInt(freeMinutesUsed ?? "0", 10);
  // `autoEnded` is retained in the route params for backward-compat but the
  // banner/messaging is now driven by the precise `endReason` below.
  void autoEnded;
  // Only a genuine balance exhaustion should tell the user they ran out of
  // coins. Network / WebRTC drops and remote hang-ups must NOT show that
  // (misleading) banner — they get a neutral "call ended" / "connection lost".
  const isOutOfCoins = endReason === "balance";
  const isConnectionDrop = endReason === "connection";
  const isVideo      = type === "video";
  const hostName     = participantName ?? t.hosts.host;
  const sid          = sessionId ?? "";

  const [rating, setRating]     = useState(0);
  const [rated, setRated]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { maybeShowRatingPrompt } = useAppRatingPrompt();

  const handleSubmitRating = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    try {
      if (sid) {
        await API.rateCall(sid, rating);
      }
      setRated(true);
      // Trigger app store rating prompt for positive experiences (4+ stars)
      try {
        const me = await API.me();
        maybeShowRatingPrompt(rating, me?.total_calls ?? 0);
      } catch { /* best-effort — never break the rating flow */ }
    } catch (e: any) {
      showErrorToast(e?.message ?? t.calls.rateFailed, t.calls.errorTitle);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[s.screen, {
      backgroundColor: colors.background,
      paddingTop: insets.top + 20,
      paddingBottom: insets.bottom + 20,
    }]}>
      {/* Main card */}
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

        {/* Auto-ended banner — reason-specific. Only a real balance
            exhaustion shows the "ran out of coins" line; a network / WebRTC
            drop shows a neutral connection message instead. */}
        {isOutOfCoins && (
          <View style={s.autoEndedBanner}>
            <Image source={require("@/assets/icons/ic_close_fill.png")} style={{ width: 14, height: 14, tintColor: "#FF6B6B" }} resizeMode="contain" />
            <Text style={s.autoEndedText}>{t.calls.autoDisconnected}</Text>
          </View>
        )}
        {isConnectionDrop && (
          <View style={s.autoEndedBanner}>
            <Image source={require("@/assets/icons/ic_close_fill.png")} style={{ width: 14, height: 14, tintColor: "#FF6B6B" }} resizeMode="contain" />
            <Text style={s.autoEndedText}>{t.calls.connectionLost}</Text>
          </View>
        )}

        {/* Icon */}
        <View style={[s.iconCircle, { backgroundColor: colors.primary + "18" }]}>
          <Image source={isVideo ? require("@/assets/icons/ic_video.png") : require("@/assets/icons/ic_call.png")} style={{ width: 36, height: 36, tintColor: colors.primary }} resizeMode="contain" />
        </View>

        <Text style={[s.title, { color: colors.foreground }]}>
          {(isOutOfCoins || isConnectionDrop) ? t.calls.callAutoEnded : t.calls.callEnded}
        </Text>
        <Text style={[s.hostName, { color: colors.mutedForeground }]}>{t.calls.with} {hostName}</Text>

        {/* Free-minutes notice — how much of this call was covered by the
            free-trial pool (so the user sees the value they received). */}
        {freeMinUsed > 0 && (
          <View style={s.freeBanner}>
            <Text style={s.freeBannerText}>
              🎁 {freeMinUsed} free {freeMinUsed === 1 ? "minute" : "minutes"} used{coinsUsed > 0 ? " — coins charged only after" : " — this call was free!"}
            </Text>
          </View>
        )}

        {/* FIX BUG-5: Minimum billing notice — shown when actual call was < 1 min */}
        {durationSec > 0 && durationSec < 60 && (
          <View style={s.minBillingBanner}>
            <Text style={s.minBillingText}>⏱ {t.calls.minBilling}</Text>
          </View>
        )}

        {/* Stats row */}
        <View style={[s.statsRow, { borderColor: colors.border }]}>
          <View style={s.stat}>
            <Text style={[s.statValue, { color: colors.foreground }]}>
              {formatDuration(durationSec)}
            </Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>{t.calls.duration}</Text>
          </View>

          <View style={[s.statDiv, { backgroundColor: colors.border }]} />

          <View style={s.stat}>
            <Text style={[s.statValue, { color: colors.coinGold }]}>
              {coinsUsed} 🪙
            </Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>{t.calls.coinsSpent}</Text>
          </View>

          <View style={[s.statDiv, { backgroundColor: colors.border }]} />

          <View style={s.stat}>
            <Image source={isVideo ? require("@/assets/icons/ic_video.png") : require("@/assets/icons/ic_mic.png")} style={{ width: 18, height: 18, tintColor: colors.primary, marginBottom: 2 }} resizeMode="contain" />
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>
              {isVideo ? t.calls.videoShort : t.calls.audioShort}
            </Text>
          </View>
        </View>

        {/* Rating section */}
        {!rated ? (
          <View style={s.ratingSection}>
            <Text style={[s.ratingPrompt, { color: colors.foreground }]}>
              {t.calls.rateName.replace("{name}", hostName)}
            </Text>
            <Text style={[s.ratingSubtitle, { color: colors.mutedForeground }]}>
              {t.calls.feedbackHelps}
            </Text>
            <StarRating
              rating={rating}
              interactive
              onRate={setRating}
              size={36}
            />
            {rating > 0 && (
              <Text style={[s.ratingLabel, { color: colors.mutedForeground }]}>
                {["", t.calls.ratingPoor, t.calls.ratingFair, t.calls.ratingGood, t.calls.ratingGreat, t.calls.ratingExcellent][rating]}
              </Text>
            )}
            <TouchableOpacity
              onPress={handleSubmitRating}
              disabled={rating === 0 || submitting}
              style={[s.rateBtn, {
                backgroundColor: rating > 0 ? colors.primary : colors.muted,
                opacity: submitting ? 0.7 : 1,
              }]}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[s.rateBtnText, { color: rating > 0 ? "#fff" : colors.mutedForeground }]}>
                  ⭐ {t.calls.submitRating}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRated(true)}>
              <Text style={[s.skipText, { color: colors.mutedForeground }]}>{t.common.skip}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.thankYou}>
            <View style={[s.thankYouIconCircle, { backgroundColor: colors.online + "20" }]}>
              <Image source={require("@/assets/icons/ic_check.png")} style={{ width: 36, height: 36, tintColor: colors.online }} resizeMode="contain" />
            </View>
            <Text style={[s.thankYouTitle, { color: colors.foreground }]}>
              {t.calls.thankYou}
            </Text>
            <Text style={[s.thankYouSub, { color: colors.mutedForeground }]}>
              {t.calls.ratingSubmitted}
            </Text>
          </View>
        )}
      </View>

      {/* Recharge button only when the caller actually ran out of coins */}
      {isOutOfCoins && (
        <TouchableOpacity
          onPress={() => router.replace("/user/payment/checkout")}
          style={[s.actionBtn, { backgroundColor: "#A00EE7" }]}
          activeOpacity={0.85}
        >
          <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 16, height: 16, tintColor: "#fff" }} resizeMode="contain" />
          <Text style={s.actionBtnText}>{t.calls.rechargeCoins}</Text>
        </TouchableOpacity>
      )}

      {/* Back to home */}
      <TouchableOpacity
        onPress={() => router.replace("/user/screens/home")}
        style={[s.actionBtn, { backgroundColor: isOutOfCoins ? colors.surface : colors.primary, borderWidth: isOutOfCoins ? 1 : 0, borderColor: colors.border }]}
        activeOpacity={0.85}
      >
        <Image source={require("@/assets/icons/ic_home.png")} style={{ width: 16, height: 16, tintColor: isOutOfCoins ? colors.foreground : "#fff" }} resizeMode="contain" />
        <Text style={[s.actionBtnText, isOutOfCoins && { color: colors.foreground }]}>
          {t.calls.backHome}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  card: {
    width: "100%",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: "center",
    gap: 14,
  },
  autoEndedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,107,107,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.3)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    width: "100%",
  },
  autoEndedText: {
    color: "#FF6B6B",
    fontSize: 12,
    fontFamily: "Poppins_500Medium",
    flex: 1,
  },
  minBillingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,165,0,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,165,0,0.25)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    width: "100%",
  },
  minBillingText: {
    color: "#B87700",
    fontSize: 12,
    fontFamily: "Poppins_500Medium",
  },
  freeBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,175,35,0.10)",
    borderWidth: 1,
    borderColor: "rgba(11,175,35,0.30)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    width: "100%",
  },
  freeBannerText: {
    color: "#0B8F1C",
    fontSize: 12,
    fontFamily: "Poppins_600SemiBold",
    textAlign: "center",
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 22, fontFamily: "Poppins_700Bold" },
  hostName: { fontSize: 14, fontFamily: "Poppins_400Regular" },
  statsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 16,
    width: "100%",
    justifyContent: "center",
    marginVertical: 4,
    gap: 0,
  },
  stat: { alignItems: "center", gap: 4, flex: 1 },
  statValue: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, marginHorizontal: 4 },
  ratingSection: { alignItems: "center", gap: 10, width: "100%", paddingTop: 4 },
  ratingPrompt: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  ratingSubtitle: { fontSize: 12, fontFamily: "Poppins_400Regular", textAlign: "center" },
  ratingLabel: { fontSize: 13, fontFamily: "Poppins_500Medium", minHeight: 20 },
  rateBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 4,
  },
  rateBtnText: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  skipText: { fontSize: 12, fontFamily: "Poppins_400Regular", paddingVertical: 4 },
  thankYou: { alignItems: "center", gap: 8, paddingVertical: 12 },
  thankYouIconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
  },
  thankYouTitle: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  thankYouSub: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  actionBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 16,
  },
  actionBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
