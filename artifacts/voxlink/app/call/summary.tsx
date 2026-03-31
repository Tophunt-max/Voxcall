import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { formatDuration } from "@/data/mockData";
import { StarRating } from "@/components/StarRating";

export default function CallSummaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { duration, type, participantName } = useLocalSearchParams<{ duration: string; type: string; participantName: string }>();
  const { user, updateCoins } = useAuth();
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);

  const durationSec = parseInt(duration ?? "0", 10);
  const coinsSpent = Math.ceil(durationSec / 60) * 8;

  const bottomPad = insets.bottom;
  const topPad = insets.top;

  const handleDone = () => {
    router.replace("/(tabs)");
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad + 20, paddingBottom: bottomPad + 20 }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "18" }]}>
          <Feather name={type === "video" ? "video" : "phone"} size={36} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Call Ended</Text>
        <Text style={[styles.hostName, { color: colors.mutedForeground }]}>with {participantName}</Text>

        <View style={[styles.statsRow, { borderColor: colors.border }]}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{formatDuration(durationSec)}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Duration</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.coinGold }]}>{coinsSpent} Coins</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Coins spent</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{type === "video" ? "Video" : "Audio"}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Type</Text>
          </View>
        </View>

        {!rated ? (
          <View style={styles.ratingSection}>
            <Text style={[styles.ratingPrompt, { color: colors.foreground }]}>Rate your experience</Text>
            <StarRating rating={rating} interactive onRate={(r) => setRating(r)} size={32} />
            <TouchableOpacity
              onPress={() => setRated(true)}
              disabled={rating === 0}
              style={[styles.rateBtn, { backgroundColor: rating > 0 ? colors.primary : colors.muted }]}
            >
              <Text style={[styles.rateBtnText, { color: rating > 0 ? "#fff" : colors.mutedForeground }]}>Submit Rating</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.thankYou}>
            <Feather name="check-circle" size={32} color={colors.online} />
            <Text style={[styles.thankYouText, { color: colors.foreground }]}>Thanks for your feedback!</Text>
          </View>
        )}
      </View>

      <TouchableOpacity onPress={handleDone} style={[styles.doneBtn, { backgroundColor: colors.primary }]}>
        <Text style={styles.doneBtnText}>Back to Home</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", gap: 24 },
  card: { width: "100%", borderRadius: 20, padding: 28, borderWidth: 1, alignItems: "center", gap: 12 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: "Poppins_700Bold" },
  hostName: { fontSize: 14, fontFamily: "Poppins_400Regular" },
  statsRow: { flexDirection: "row", gap: 16, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 16, width: "100%", justifyContent: "center", marginVertical: 8 },
  stat: { alignItems: "center", gap: 4, flex: 1 },
  statValue: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1 },
  ratingSection: { alignItems: "center", gap: 12, width: "100%" },
  ratingPrompt: { fontSize: 15, fontFamily: "Poppins_500Medium" },
  rateBtn: { width: "100%", paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  rateBtnText: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  thankYou: { alignItems: "center", gap: 8 },
  thankYouText: { fontSize: 15, fontFamily: "Poppins_500Medium" },
  doneBtn: { width: "100%", paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  doneBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
