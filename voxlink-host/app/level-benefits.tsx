// Level Benefits — the full host level ladder: requirements, one-time coin
// reward and perks (rate cap, earning share, visibility boost) for every rung,
// with the host's current level highlighted and locked rungs dimmed.
//
// Backed by GET /api/host/level (API.getHostLevel), so the ladder, thresholds,
// rewards and perks always match the admin-configured config + the live engine.

import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { GradientHeader } from "@/components/GradientHeader";
import { API } from "@/services/api";
import type { HostLevelResponse, HostLevelDef } from "@/services/api";

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || "").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => isNaN(n))) return `rgba(160,14,231,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

function LevelRow({
  def,
  currentLevel,
  colors,
}: {
  def: HostLevelDef;
  currentLevel: number;
  colors: ReturnType<typeof useColors>;
}) {
  const isCurrent = def.level === currentLevel;
  const isUnlocked = def.level <= currentLevel;
  const accent = def.color || colors.accent;
  const sharePct = Math.round((def.perks?.earning_share ?? 0.7) * 100);

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: isCurrent ? accent : colors.border,
          borderWidth: isCurrent ? 1.5 : StyleSheet.hairlineWidth,
          opacity: isUnlocked ? 1 : 0.82,
        },
      ]}
    >
      <View style={styles.rowHead}>
        <View style={[styles.badgeCircle, { backgroundColor: hexToRgba(accent, 0.14), borderColor: hexToRgba(accent, 0.4) }]}>
          <Text style={styles.badge}>{def.badge}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.name, { color: colors.text }]}>{def.name}</Text>
            <View style={[styles.lvlChip, { backgroundColor: accent }]}>
              <Text style={styles.lvlChipText}>Lv.{def.level}</Text>
            </View>
          </View>
          <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>{def.description}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: isCurrent ? accent : isUnlocked ? hexToRgba("#0BAF23", 0.14) : colors.muted }]}>
          <Text style={[styles.statusText, { color: isCurrent ? "#fff" : isUnlocked ? "#0BAF23" : colors.mutedForeground }]}>
            {isCurrent ? "Current" : isUnlocked ? "Unlocked" : "Locked"}
          </Text>
        </View>
      </View>

      {/* Requirements */}
      <View style={[styles.section, { borderTopColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Requirements</Text>
        <View style={styles.chipsRow}>
          <View style={[styles.infoChip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.infoChipText, { color: colors.text }]}>📞 {def.min_calls.toLocaleString()} rated calls</Text>
          </View>
          <View style={[styles.infoChip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.infoChipText, { color: colors.text }]}>⭐ {def.min_rating.toFixed(1)} rating</Text>
          </View>
        </View>
      </View>

      {/* Rewards + perks */}
      <View style={[styles.section, { borderTopColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Rewards & Perks</Text>
        <View style={styles.chipsRow}>
          {def.coin_reward > 0 ? (
            <View style={[styles.infoChip, { backgroundColor: hexToRgba("#D9A406", 0.12) }]}>
              <Text style={[styles.infoChipText, { color: colors.coinGoldText }]}>🪙 +{def.coin_reward.toLocaleString()} coins</Text>
            </View>
          ) : null}
          <View style={[styles.infoChip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.infoChipText, { color: colors.text }]}>💰 {sharePct}% earnings</Text>
          </View>
          <View style={[styles.infoChip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.infoChipText, { color: colors.text }]}>📈 Up to {def.perks?.max_rate ?? 100}/min</Text>
          </View>
          {(def.perks?.rank_boost ?? 0) > 0 ? (
            <View style={[styles.infoChip, { backgroundColor: colors.surface }]}>
              <Text style={[styles.infoChipText, { color: colors.text }]}>🚀 Higher visibility</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function LevelBenefitsScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<HostLevelResponse>({
    queryKey: ["host-level"],
    queryFn: () => API.getHostLevel(),
    staleTime: 2 * 60_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <GradientHeader
        title="Level Benefits"
        subtitle="Climb the ladder, earn more"
        left={
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Text style={[styles.backIcon, { color: colors.text }]}>‹</Text>
          </TouchableOpacity>
        }
      />

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : isError || !data ? (
        // FIX: a query error left an infinite spinner (isLoading=false, data=undefined).
        // Show a retry affordance instead of hanging forever.
        <View style={styles.loading}>
          <Text style={[styles.summarySub, { color: colors.mutedForeground, textAlign: "center", marginBottom: 12 }]}>
            Couldn't load level benefits. Check your connection and try again.
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={[styles.infoChip, { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Retry loading level benefits"
          >
            <Text style={[styles.infoChipText, { color: colors.accent }]}>{isFetching ? "Retrying…" : "Retry"}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }} showsVerticalScrollIndicator={false}>
          <View style={[styles.summary, { backgroundColor: colors.card }]}>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>
              You're at Level {data.level} · {data.current?.name}
            </Text>
            <Text style={[styles.summarySub, { color: colors.mutedForeground }]}>
              {data.is_max_level
                ? "You've reached the top level. Keep up the great work!"
                : `${data.progress_pct}% of the way to ${data.next?.name}.`}
            </Text>
          </View>

          {data.levels
            .slice()
            .sort((a, b) => a.level - b.level)
            .map((def) => (
              <LevelRow key={def.level} def={def} currentLevel={data.level} colors={colors} />
            ))}

          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            Rated calls are calls that received a star rating. Level rewards are
            paid once when you first reach each level. Higher levels let you
            charge more, keep a bigger share of earnings, and rank higher to
            users.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  backIcon: { fontSize: 34, fontFamily: "Poppins_400Regular", marginTop: -4 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  summary: { borderRadius: 16, padding: 16, gap: 4 },
  summaryTitle: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  summarySub: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  row: { borderRadius: 16, padding: 14, gap: 12 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  badgeCircle: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  badge: { fontSize: 24 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  lvlChip: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9 },
  lvlChipText: { color: "#fff", fontSize: 10, fontFamily: "Poppins_700Bold" },
  desc: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 11, fontFamily: "Poppins_600SemiBold" },
  section: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  infoChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  infoChipText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  footnote: { fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18, marginTop: 4 },
});
