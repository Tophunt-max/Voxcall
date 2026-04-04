import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { formatDuration } from "@/utils/format";
import { StarRating } from "@/components/StarRating";
import { API } from "@/services/api";
import { showErrorToast } from "@/components/Toast";

export default function CallSummaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    duration,
    type,
    participantName,
    participantId,
    sessionId,
    coinsEarned,
    autoEnded,
  } = useLocalSearchParams<{
    duration: string;
    type: string;
    participantName: string;
    participantId: string;
    sessionId: string;
    coinsEarned: string;
    autoEnded: string;
  }>();

  const durationSec   = parseInt(duration    ?? "0", 10);
  const coinsGained   = parseInt(coinsEarned ?? "0", 10);
  const isAutoEnded   = autoEnded === "1";
  const isVideo       = type === "video";
  const userName      = participantName ?? "User";
  const sid           = sessionId ?? "";

  const [rating, setRating]         = useState(0);
  const [rated, setRated]           = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitRating = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    try {
      if (sid) {
        await API.rateCall(sid, rating);
      }
      setRated(true);
    } catch (e: any) {
      showErrorToast(e?.message ?? "Failed to submit rating, please try again.", "Error");
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
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

        {isAutoEnded && (
          <View style={s.autoEndedBanner}>
            <Feather name="info" size={14} color="#60B8FF" />
            <Text style={s.autoEndedText}>User ran out of coins — call was auto-disconnected</Text>
          </View>
        )}

        <View style={[s.iconCircle, { backgroundColor: colors.primary + "18" }]}>
          <Image
            source={isVideo ? require("@/assets/icons/ic_video_gradient.png") : require("@/assets/icons/ic_call_gradient.png")}
            style={s.mainIcon}
            tintColor={colors.primary}
            resizeMode="contain"
          />
        </View>

        <Text style={[s.title, { color: colors.foreground }]}>
          {isAutoEnded ? "Call Auto-Ended" : "Call Completed"}
        </Text>
        <Text style={[s.hostName, { color: colors.mutedForeground }]}>with {userName}</Text>

        <View style={[s.statsRow, { borderColor: colors.border }]}>
          <View style={s.stat}>
            <Text style={[s.statValue, { color: colors.foreground }]}>
              {formatDuration(durationSec)}
            </Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Duration</Text>
          </View>

          <View style={[s.statDiv, { backgroundColor: colors.border }]} />

          <View style={s.stat}>
            <Text style={[s.statValue, { color: "#0BAF23" }]}>
              +{coinsGained} 🪙
            </Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Coins Earned</Text>
          </View>

          <View style={[s.statDiv, { backgroundColor: colors.border }]} />

          <View style={s.stat}>
            <Image
              source={isVideo ? require("@/assets/icons/ic_video.png") : require("@/assets/icons/ic_mic.png")}
              style={[s.statTypeIcon, { marginBottom: 2 }]}
              tintColor={colors.primary}
              resizeMode="contain"
            />
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>
              {isVideo ? "Video" : "Audio"}
            </Text>
          </View>
        </View>

        {!rated ? (
          <View style={s.ratingSection}>
            <Text style={[s.ratingPrompt, { color: colors.foreground }]}>
              Rate {userName}
            </Text>
            <Text style={[s.ratingSubtitle, { color: colors.mutedForeground }]}>
              Share your experience from this call
            </Text>
            <StarRating
              rating={rating}
              interactive
              onRate={setRating}
              size={36}
            />
            {rating > 0 && (
              <Text style={[s.ratingLabel, { color: colors.mutedForeground }]}>
                {["", "Poor", "Fair", "Good", "Great", "Excellent!"][rating]}
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
                  ⭐ Submit Rating
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRated(true)}>
              <Text style={[s.skipText, { color: colors.mutedForeground }]}>Skip</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.thankYou}>
            <View style={[s.thankYouIconCircle, { backgroundColor: "#0BAF2320" }]}>
              <Feather name="check-circle" size={36} color="#0BAF23" />
            </View>
            <Text style={[s.thankYouTitle, { color: colors.foreground }]}>
              Shukriya! 🙏
            </Text>
            <Text style={[s.thankYouSub, { color: colors.mutedForeground }]}>
              Aapki rating submit ho gayi
            </Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        onPress={() => router.replace("/(tabs)/wallet")}
        style={[s.actionBtn, { backgroundColor: "#0BAF23" }]}
        activeOpacity={0.85}
      >
        <Image source={require("@/assets/icons/ic_arrow_up.png")} style={s.actionBtnIcon} tintColor="#fff" resizeMode="contain" />
        <Text style={s.actionBtnText}>Earnings Dekho</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.replace("/(tabs)")}
        style={[s.actionBtn, { backgroundColor: colors.primary }]}
        activeOpacity={0.85}
      >
        <Image source={require("@/assets/icons/ic_home.png")} style={s.actionBtnIcon} tintColor="#fff" resizeMode="contain" />
        <Text style={s.actionBtnText}>Home Par Wapas Jao</Text>
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
    backgroundColor: "rgba(96,184,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(96,184,255,0.3)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    width: "100%",
  },
  autoEndedText: {
    color: "#60B8FF",
    fontSize: 12,
    fontFamily: "Poppins_500Medium",
    flex: 1,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  mainIcon: { width: 40, height: 40 },
  statTypeIcon: { width: 18, height: 18 },
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
  actionBtnIcon: { width: 18, height: 18 },
  actionBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
