// LevelCard — the host's level system on the dashboard: a gradient header with
// the level badge, name and live progress bar, then a body with the
// per-requirement breakdown (rated calls / rating / talk-time / earnings) and
// the coin reward unlocked at the next rung. Max level shows a celebratory state.
//
// Backed by GET /api/host/level (API.getHostLevel).

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { HostLevelResponse } from "@/services/api";
import { useColors } from "@/hooks/useColors";

interface LevelCardProps {
  data?: HostLevelResponse;
  loading?: boolean;
  onPress?: () => void;
}

function shade(hex: string, percent: number): string {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return hex || "#7B2FF7";
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return hex;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent) / 100;
  const ch = (s: number) => { const v = (num >> s) & 0xff; return Math.round((t - v) * p) + v; };
  return `#${((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1)}`;
}

function rgba(hex: string, a: number): string {
  const h = (hex || "").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (Number.isNaN(n)) return `rgba(124,47,247,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Per-metric colour so the requirement pills are vibrant + scannable.
const METRIC = {
  calls: { tint: "#2563EB", icon: "📞" },
  rating: { tint: "#F59E0B", icon: "⭐" },
  minutes: { tint: "#14B8A6", icon: "⏱️" },
  earnings: { tint: "#E0A106", icon: "🪙" },
};

function cardShadow(color: string) {
  return Platform.select({
    ios: { shadowColor: color, shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 4 },
    web: { boxShadow: `0 6px 16px ${color}33` } as any,
  });
}

function ReqPill({
  label, icon, tint, current, required, met, isRating, textColor, mutedColor,
}: {
  label: string; icon: string; tint: string; current: number; required: number; met: boolean; isRating?: boolean;
  textColor: string; mutedColor: string;
}) {
  const cur = isRating ? current.toFixed(1) : Math.round(current).toLocaleString();
  const req = isRating ? required.toFixed(1) : Math.round(required).toLocaleString();
  return (
    <View style={[reqStyles.pill, { backgroundColor: rgba(tint, 0.1), borderColor: rgba(tint, 0.22) }]}>
      <View style={reqStyles.pillTop}>
        <Text style={reqStyles.pillIcon}>{icon}</Text>
        <Text style={[reqStyles.pillLabel, { color: tint }]} numberOfLines={1}>{label}</Text>
        <View style={{ flex: 1 }} />
        <View style={[reqStyles.check, { backgroundColor: met ? tint : "transparent", borderColor: met ? tint : rgba(tint, 0.5) }]}>
          <Text style={[reqStyles.checkText, { color: met ? "#fff" : tint }]}>{met ? "✓" : ""}</Text>
        </View>
      </View>
      <Text style={[reqStyles.pillValue, { color: textColor }]}>
        {cur}<Text style={[reqStyles.pillReq, { color: mutedColor }]}> / {req}</Text>
      </Text>
    </View>
  );
}

export default function LevelCard({ data, loading, onPress }: LevelCardProps) {
  const colors = useColors();

  if (loading || !data) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, marginHorizontal: 16, borderColor: colors.border }]}>
        <View style={{ height: 150, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  const { current, next, is_max_level, progress_pct, requirements } = data;
  const accent = current?.color || colors.accent;
  const pct = Math.max(0, Math.min(100, progress_pct));

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.9 : 1}
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.card, marginHorizontal: 16 }, cardShadow(accent)]}
    >
      {/* Gradient header */}
      <LinearGradient colors={[accent, shade(accent, -26)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.headerGrad}>
        <View style={styles.headerRow}>
          <View style={styles.badgeCircle}>
            <Text style={styles.badgeEmoji}>{current?.badge || "🌱"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.levelTitleRow}>
              <Text style={styles.levelName}>{current?.name || "Newcomer"}</Text>
              <View style={styles.levelChip}><Text style={styles.levelChipText}>Lv.{data.level}</Text></View>
            </View>
            <Text style={styles.levelSub} numberOfLines={1}>{current?.description || "Your host level"}</Text>
          </View>
          {onPress ? <Text style={styles.chevron}>›</Text> : null}
        </View>

        {is_max_level ? (
          <View style={styles.maxBanner}>
            <Text style={styles.maxText}>🏆 Top level reached — you're an Elite host!</Text>
          </View>
        ) : (
          <View style={styles.progressWrap}>
            <View style={styles.progressHead}>
              <Text style={styles.progressLabel}>Progress to {next?.badge} {next?.name}</Text>
              <Text style={styles.progressPct}>{pct}%</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>
          </View>
        )}
      </LinearGradient>

      {/* Body */}
      {!is_max_level ? (
        <View style={styles.body}>
          {pct >= 80 && next ? (
            <View style={[styles.nudge, { backgroundColor: colors.accentLight ?? colors.muted }]}>
              <Text style={[styles.nudgeText, { color: accent }]}>🔥 Almost there — {pct}% to {next.name}!</Text>
            </View>
          ) : null}

          <View style={styles.reqRow}>
            <ReqPill label="Rated calls" icon={METRIC.calls.icon} tint={METRIC.calls.tint} current={requirements.calls.current} required={requirements.calls.required} met={requirements.calls.met} textColor={colors.text} mutedColor={colors.mutedForeground} />
            <ReqPill label="Rating" icon={METRIC.rating.icon} tint={METRIC.rating.tint} current={requirements.rating.current} required={requirements.rating.required} met={requirements.rating.met} isRating textColor={colors.text} mutedColor={colors.mutedForeground} />
            {requirements.minutes?.required > 0 ? (
              <ReqPill label="Talk-time" icon={METRIC.minutes.icon} tint={METRIC.minutes.tint} current={requirements.minutes.current} required={requirements.minutes.required} met={requirements.minutes.met} textColor={colors.text} mutedColor={colors.mutedForeground} />
            ) : null}
            {requirements.earnings?.required > 0 ? (
              <ReqPill label="Coins earned" icon={METRIC.earnings.icon} tint={METRIC.earnings.tint} current={requirements.earnings.current} required={requirements.earnings.required} met={requirements.earnings.met} textColor={colors.text} mutedColor={colors.mutedForeground} />
            ) : null}
          </View>

          {next && next.coin_reward > 0 ? (
            <View style={[styles.rewardRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.rewardText, { color: colors.mutedForeground }]}>Reach {next.name} to earn</Text>
              <View style={styles.rewardCoinWrap}>
                <Text style={styles.rewardCoinEmoji}>🎁</Text>
                <Text style={[styles.rewardCoins, { color: colors.coinGoldText }]}>+{next.coin_reward.toLocaleString()}</Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, marginBottom: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent", overflow: "hidden" },

  headerGrad: { padding: 16, gap: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  badgeCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.22)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  badgeEmoji: { fontSize: 26 },
  levelTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  levelName: { fontSize: 18, fontFamily: "Poppins_700Bold", color: "#fff" },
  levelChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.25)" },
  levelChipText: { color: "#fff", fontSize: 11, fontFamily: "Poppins_700Bold" },
  levelSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.85)", marginTop: 2 },
  chevron: { fontSize: 26, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.9)", marginLeft: 4 },

  maxBanner: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 12, padding: 11, alignItems: "center" },
  maxText: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#fff" },

  progressWrap: { gap: 7 },
  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.9)" },
  progressPct: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "#fff" },
  track: { height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.28)" },
  fill: { height: 10, borderRadius: 5, backgroundColor: "#fff" },

  body: { padding: 16, gap: 12 },
  nudge: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, alignItems: "center" },
  nudgeText: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  reqRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  rewardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  rewardText: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  rewardCoinWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  rewardCoinEmoji: { fontSize: 13 },
  rewardCoins: { fontSize: 14, fontFamily: "Poppins_700Bold" },
});

const reqStyles = StyleSheet.create({
  pill: { flexGrow: 1, flexBasis: "46%", borderRadius: 14, padding: 11, gap: 6, borderWidth: StyleSheet.hairlineWidth },
  pillTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  pillIcon: { fontSize: 12 },
  pillLabel: { fontSize: 11, fontFamily: "Poppins_600SemiBold" },
  check: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkText: { fontSize: 10, fontFamily: "Poppins_700Bold", lineHeight: 12 },
  pillValue: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  pillReq: { fontSize: 12, fontFamily: "Poppins_400Regular" },
});
