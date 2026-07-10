// LevelCard — surfaces the host's level system on the dashboard.
// Shows the current level badge + name, a progress bar towards the next level,
// the per-requirement breakdown (rated calls + rating), and the coin reward
// unlocked at the next rung. At max level it shows a celebratory state.
//
// Backed by GET /api/host/level (API.getHostLevel) which returns the
// admin-configured ladder, so badges/names/thresholds always match the admin
// panel and the auto-promotion job.

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import type { HostLevelResponse } from "@/services/api";
import { useColors } from "@/hooks/useColors";

interface LevelCardProps {
  data?: HostLevelResponse;
  loading?: boolean;
  onPress?: () => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => isNaN(n))) return `rgba(160,14,231,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

function ReqPill({
  label,
  current,
  required,
  met,
  isRating,
  color,
  textColor,
  mutedColor,
  surface,
}: {
  label: string;
  current: number;
  required: number;
  met: boolean;
  isRating?: boolean;
  color: string;
  textColor: string;
  mutedColor: string;
  surface: string;
}) {
  const cur = isRating ? current.toFixed(1) : Math.round(current).toLocaleString();
  const req = isRating ? required.toFixed(1) : Math.round(required).toLocaleString();
  return (
    <View style={[reqStyles.pill, { backgroundColor: surface }]}>
      <View style={reqStyles.pillTop}>
        <Text style={[reqStyles.pillLabel, { color: mutedColor }]}>{label}</Text>
        <Text style={[reqStyles.pillCheck, { color: met ? "#0BAF23" : mutedColor }]}>
          {met ? "✓" : "•"}
        </Text>
      </View>
      <Text style={[reqStyles.pillValue, { color: textColor }]}>
        {cur}
        <Text style={[reqStyles.pillReq, { color: mutedColor }]}> / {req}</Text>
      </Text>
    </View>
  );
}

export default function LevelCard({ data, loading, onPress }: LevelCardProps) {
  const colors = useColors();

  if (loading || !data) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
        <View style={{ height: 96, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  const { current, next, is_max_level, progress_pct, requirements } = data;
  const accent = current?.color || colors.accent;

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.85 : 1}
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: colors.card, marginHorizontal: 16, borderColor: hexToRgba(accent, 0.25) },
      ]}
    >
      {/* Header row: badge + level name + reviews */}
      <View style={styles.headerRow}>
        <View style={[styles.badgeCircle, { backgroundColor: hexToRgba(accent, 0.14), borderColor: hexToRgba(accent, 0.4) }]}>
          <Text style={styles.badgeEmoji}>{current?.badge || "🌱"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.levelTitleRow}>
            <Text style={[styles.levelName, { color: colors.text }]}>{current?.name || "Newcomer"}</Text>
            <View style={[styles.levelChip, { backgroundColor: accent }]}>
              <Text style={styles.levelChipText}>Lv.{data.level}</Text>
            </View>
          </View>
          <Text style={[styles.levelSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {current?.description || "Your host level"}
          </Text>
        </View>
        {onPress ? <Text style={[styles.chevron, { color: colors.mutedForeground }]}>›</Text> : null}
      </View>

      {is_max_level ? (
        <View style={[styles.maxBanner, { backgroundColor: hexToRgba(accent, 0.12) }]}>
          <Text style={[styles.maxText, { color: accent }]}>
            🏆 Top level reached — you’re an Elite host!
          </Text>
        </View>
      ) : (
        <>
          {/* Progress bar */}
          <View style={styles.progressHead}>
            <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
              Progress to {next?.badge} {next?.name}
            </Text>
            <Text style={[styles.progressPct, { color: accent }]}>{progress_pct}%</Text>
          </View>
          <View style={[styles.track, { backgroundColor: colors.muted }]}>
            <View style={[styles.fill, { width: `${progress_pct}%`, backgroundColor: accent }]} />
          </View>

          {/* Near-level nudge — a dopamine push when the host is almost there. */}
          {progress_pct >= 80 && next ? (
            <View style={[styles.nudge, { backgroundColor: hexToRgba(accent, 0.12) }]}>
              <Text style={[styles.nudgeText, { color: accent }]}>
                🔥 Almost there — you’re {progress_pct}% to {next.name}!
              </Text>
            </View>
          ) : null}

          {/* Requirement pills — all four must be met to level up */}
          <View style={styles.reqRow}>
            <ReqPill
              label="Rated calls"
              current={requirements.calls.current}
              required={requirements.calls.required}
              met={requirements.calls.met}
              color={accent}
              textColor={colors.text}
              mutedColor={colors.mutedForeground}
              surface={colors.surface}
            />
            <ReqPill
              label="Rating"
              current={requirements.rating.current}
              required={requirements.rating.required}
              met={requirements.rating.met}
              isRating
              color={accent}
              textColor={colors.text}
              mutedColor={colors.mutedForeground}
              surface={colors.surface}
            />
            {requirements.minutes?.required > 0 ? (
              <ReqPill
                label="Talk-time (min)"
                current={requirements.minutes.current}
                required={requirements.minutes.required}
                met={requirements.minutes.met}
                color={accent}
                textColor={colors.text}
                mutedColor={colors.mutedForeground}
                surface={colors.surface}
              />
            ) : null}
            {requirements.earnings?.required > 0 ? (
              <ReqPill
                label="Coins earned"
                current={requirements.earnings.current}
                required={requirements.earnings.required}
                met={requirements.earnings.met}
                color={accent}
                textColor={colors.text}
                mutedColor={colors.mutedForeground}
                surface={colors.surface}
              />
            ) : null}
          </View>

          {/* Reward hint */}
          {next && next.coin_reward > 0 ? (
            <View style={[styles.rewardRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.rewardText, { color: colors.mutedForeground }]}>
                Reach {next.name} to earn
              </Text>
              <Text style={[styles.rewardCoins, { color: colors.coinGoldText }]}>
                +{next.coin_reward.toLocaleString()} coins
              </Text>
            </View>
          ) : null}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  badgeCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  badgeEmoji: { fontSize: 26 },
  levelTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  levelName: { fontSize: 17, fontFamily: "Poppins_700Bold" },
  levelChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  levelChipText: { color: "#fff", fontSize: 11, fontFamily: "Poppins_700Bold" },
  levelSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  chevron: { fontSize: 26, fontFamily: "Poppins_400Regular", marginLeft: 4 },
  maxBanner: { borderRadius: 12, padding: 12, alignItems: "center" },
  maxText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  nudge: { borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, alignItems: "center" },
  nudgeText: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  progressPct: { fontSize: 13, fontFamily: "Poppins_700Bold" },
  track: { height: 10, borderRadius: 5, overflow: "hidden" },
  fill: { height: 10, borderRadius: 5 },
  reqRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  rewardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  rewardText: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  rewardCoins: { fontSize: 13, fontFamily: "Poppins_700Bold" },
});

const reqStyles = StyleSheet.create({
  pill: { flexGrow: 1, flexBasis: "46%", borderRadius: 12, padding: 10, gap: 4 },
  pillTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pillLabel: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  pillCheck: { fontSize: 13, fontFamily: "Poppins_700Bold" },
  pillValue: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  pillReq: { fontSize: 12, fontFamily: "Poppins_400Regular" },
});
