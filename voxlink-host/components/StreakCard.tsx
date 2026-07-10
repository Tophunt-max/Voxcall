// StreakCard — host daily-streak (engagement) card for the dashboard.
//
// Shows the current 🔥 streak, longest streak, progress to the next milestone,
// tomorrow's reward, and an "at risk" urgency state when the streak is about to
// reset. Backed by GET /api/host/streak (API.getHostStreak). Renders nothing
// when the feature is disabled by admin.
import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import type { HostStreakStatus } from "@/services/api";

const FLAME_GRAD: readonly [string, string] = ["#F97316", "#EF4444"];

function nextMilestone(streak: number, milestones: Record<string, number>): { day: number; reward: number } | null {
  const days = Object.keys(milestones)
    .map((k) => parseInt(k, 10))
    .filter((d) => Number.isFinite(d) && d > streak)
    .sort((a, b) => a - b);
  if (days.length === 0) return null;
  return { day: days[0], reward: milestones[String(days[0])] ?? 0 };
}

export default function StreakCard({ streak }: { streak?: HostStreakStatus | null }) {
  const colors = useColors();
  if (!streak || !streak.enabled) return null;

  const days = streak.streak_days || 0;
  const milestone = nextMilestone(days, streak.milestones || {});
  const toGo = milestone ? milestone.day - days : 0;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.border }, cardShadow()]}>
      <LinearGradient colors={FLAME_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.flameBadge}>
        <Text style={styles.flameEmoji}>🔥</Text>
      </LinearGradient>

      <View style={{ flex: 1 }}>
        <View style={styles.topRow}>
          <Text style={[styles.dayText, { color: colors.foreground }]}>
            {days > 0 ? `${days}-day streak` : "Start your streak!"}
          </Text>
          {streak.streak_max > 0 ? (
            <Text style={[styles.best, { color: colors.mutedForeground }]}>Best: {streak.streak_max}</Text>
          ) : null}
        </View>

        {streak.at_risk ? (
          <Text style={styles.atRisk}>⏰ Come online today to keep your streak!</Text>
        ) : streak.active_today ? (
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            ✅ Checked in today{milestone ? ` · ${toGo} day${toGo === 1 ? "" : "s"} to +${milestone.reward} coins` : ""}
          </Text>
        ) : (
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {days > 0
              ? `Come online today — keep it going!${streak.next_reward > 0 ? ` +${streak.next_reward} coins` : ""}`
              : `Come online daily to earn bonus coins${streak.next_reward > 0 ? ` (+${streak.next_reward} today)` : ""}`}
          </Text>
        )}

        {milestone ? (
          <View style={styles.milestoneRow}>
            <Text style={[styles.milestoneText, { color: colors.accent }]}>
              🎯 Day {milestone.day}: +{milestone.reward.toLocaleString()} coins
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function cardShadow() {
  return Platform.select({
    ios: { shadowColor: "#F97316", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 3 },
    web: { boxShadow: "0 4px 12px rgba(249,115,22,0.14)" } as any,
  });
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  flameBadge: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  flameEmoji: { fontSize: 26 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayText: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  best: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  sub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 3, lineHeight: 17 },
  atRisk: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#EF4444", marginTop: 3 },
  milestoneRow: { marginTop: 6 },
  milestoneText: { fontSize: 11.5, fontFamily: "Poppins_600SemiBold" },
});
