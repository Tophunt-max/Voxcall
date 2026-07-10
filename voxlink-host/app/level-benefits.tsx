// Level Benefits — a gradient hero showing the host's current level + progress,
// and a timeline ladder of every rung (requirements, one-time coin reward and
// perks), with the current level highlighted and locked rungs dimmed.
//
// Backed by GET /api/host/level (API.getHostLevel), so the ladder, thresholds,
// rewards and perks always match the admin config + the live engine.

import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
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

// Darken (-) / lighten (+) a hex colour by percent, for the hero gradient.
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

function cardShadow(color = "#000", opacity = 0.06) {
  return Platform.select({
    ios: { shadowColor: color, shadowOpacity: opacity, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 3 },
    web: { boxShadow: `0 4px 12px rgba(0,0,0,${opacity})` } as any,
  });
}

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

function LevelRow({
  def,
  currentLevel,
  isLast,
  colors,
}: {
  def: HostLevelDef;
  currentLevel: number;
  isLast: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const isCurrent = def.level === currentLevel;
  const isUnlocked = def.level <= currentLevel;
  const accent = def.color || colors.accent;
  const sharePct = Math.round((def.perks?.earning_share ?? 0.7) * 100);

  return (
    <View style={styles.timelineRow}>
      {/* Rail: connecting line + node with the badge */}
      <View style={styles.rail}>
        {!isLast ? <View style={[styles.railLine, { backgroundColor: isUnlocked ? hexToRgba(accent, 0.35) : colors.border }]} /> : null}
        <View style={[styles.node, { backgroundColor: isUnlocked ? hexToRgba(accent, 0.16) : colors.muted, borderColor: isCurrent ? accent : colors.background }]}>
          <Text style={[styles.nodeBadge, { opacity: isUnlocked ? 1 : 0.45 }]}>{def.badge}</Text>
          {!isUnlocked ? <View style={styles.lockDot}><Text style={{ fontSize: 9 }}>🔒</Text></View> : null}
        </View>
      </View>

      {/* Card */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: isCurrent ? hexToRgba(accent, 0.06) : colors.card,
            borderColor: isCurrent ? accent : colors.border,
            borderWidth: isCurrent ? 1.5 : StyleSheet.hairlineWidth,
            opacity: isUnlocked ? 1 : 0.75,
          },
          isCurrent ? cardShadow(accent, 0.18) : cardShadow(),
        ]}
      >
        <View style={styles.cardHead}>
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
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Requirements</Text>
        <View style={styles.chipsRow}>
          <Chip label={`📞 ${def.min_calls.toLocaleString()} rated calls`} bg={colors.surface} color={colors.text} />
          <Chip label={`⭐ ${def.min_rating.toFixed(1)} rating`} bg={colors.surface} color={colors.text} />
          {def.min_minutes > 0 ? <Chip label={`⏱️ ${def.min_minutes.toLocaleString()} min`} bg={colors.surface} color={colors.text} /> : null}
          {def.min_earnings > 0 ? <Chip label={`🪙 ${def.min_earnings.toLocaleString()} earned`} bg={colors.surface} color={colors.text} /> : null}
        </View>

        {/* Rewards + perks */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 10 }]}>Rewards & Perks</Text>
        <View style={styles.chipsRow}>
          {def.coin_reward > 0 ? <Chip label={`🎁 +${def.coin_reward.toLocaleString()} coins`} bg={hexToRgba("#D9A406", 0.14)} color={colors.coinGoldText} /> : null}
          <Chip label={`💰 ${sharePct}% earnings`} bg={colors.surface} color={colors.text} />
          <Chip label={`🎙️ Audio ${def.perks?.max_audio_rate ?? def.perks?.max_rate ?? 100}/min`} bg={colors.surface} color={colors.text} />
          <Chip label={`📹 Video ${def.perks?.max_video_rate ?? def.perks?.max_rate ?? 100}/min`} bg={colors.surface} color={colors.text} />
          {(def.perks?.rank_boost ?? 0) > 0 ? <Chip label="🚀 Higher visibility" bg={colors.surface} color={colors.text} /> : null}
        </View>
      </View>
    </View>
  );
}

export default function LevelBenefitsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<HostLevelResponse>({
    queryKey: ["host-level"],
    queryFn: () => API.getHostLevel(),
    staleTime: 2 * 60_000,
  });

  const accent = data?.current?.color || "#7B2FF7";
  const pct = Math.max(0, Math.min(100, data?.progress_pct ?? 0));

  const renderHeader = () => (
    <LinearGradient colors={[accent, shade(accent, -28)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + 10 }]}>
      <View style={styles.heroTopRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.heroHeaderTitle}>Level Benefits</Text>
      </View>

      {data ? (
        <>
          <View style={styles.heroBody}>
            <View style={styles.heroBadge}>
              <Text style={{ fontSize: 34 }}>{data.current?.badge ?? "🌱"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLevelLabel}>LEVEL {data.level}</Text>
              <Text style={styles.heroLevelName}>{data.current?.name ?? "Newcomer"}</Text>
            </View>
          </View>

          {data.is_max_level ? (
            <View style={styles.heroMaxPill}>
              <Text style={styles.heroMaxText}>🏆 Top level reached — you're Elite!</Text>
            </View>
          ) : (
            <View style={styles.heroProgressWrap}>
              <View style={styles.heroProgressLabels}>
                <Text style={styles.heroProgressText}>{pct}% to {data.next?.name}</Text>
                {data.next?.coin_reward ? <Text style={styles.heroProgressText}>🎁 +{data.next.coin_reward.toLocaleString()}</Text> : null}
              </View>
              <View style={styles.heroTrack}>
                <View style={[styles.heroFill, { width: `${pct}%` }]} />
              </View>
            </View>
          )}
        </>
      ) : (
        <Text style={styles.heroHeaderTitleOnly}>Climb the ladder, earn more</Text>
      )}
    </LinearGradient>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <>
          {renderHeader()}
          <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>
        </>
      ) : isError || !data ? (
        <>
          {renderHeader()}
          <View style={styles.loading}>
            <Text style={[styles.retryHint, { color: colors.mutedForeground }]}>Couldn't load level benefits. Check your connection and try again.</Text>
            <TouchableOpacity onPress={() => refetch()} style={[styles.retryBtn, { borderColor: colors.border }]}>
              <Text style={[styles.chipText, { color: colors.accent }]}>{isFetching ? "Retrying…" : "Retry"}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {renderHeader()}
          <View style={styles.ladder}>
            {data.levels
              .slice()
              .sort((a, b) => a.level - b.level)
              .map((def, i, arr) => (
                <LevelRow key={def.level} def={def} currentLevel={data.level} isLast={i === arr.length - 1} colors={colors} />
              ))}
          </View>
          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            Rated calls are calls that received a star rating. Level rewards are paid once when you first reach each level. Higher levels let you charge more, keep a bigger share of earnings, and rank higher to users.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Hero
  hero: { paddingHorizontal: 16, paddingBottom: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  heroTopRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: -6 },
  backIcon: { fontSize: 32, fontFamily: "Poppins_400Regular", color: "#fff", marginTop: -4 },
  heroHeaderTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: "#fff" },
  heroHeaderTitleOnly: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.9)", marginTop: 8, marginLeft: 4 },
  heroBody: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 },
  heroBadge: { width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  heroLevelLabel: { fontSize: 11, fontFamily: "Poppins_600SemiBold", color: "rgba(255,255,255,0.8)", letterSpacing: 1.5 },
  heroLevelName: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#fff", marginTop: 1 },
  heroMaxPill: { marginTop: 16, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 14, paddingVertical: 10, alignItems: "center" },
  heroMaxText: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  heroProgressWrap: { marginTop: 16 },
  heroProgressLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  heroProgressText: { fontSize: 12.5, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  heroTrack: { height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden" },
  heroFill: { height: 10, borderRadius: 5, backgroundColor: "#fff" },

  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  retryHint: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center" },
  retryBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 12, borderWidth: 1 },

  // Ladder / timeline
  ladder: { paddingHorizontal: 16, paddingTop: 18 },
  timelineRow: { flexDirection: "row", gap: 12 },
  rail: { width: 44, alignItems: "center" },
  railLine: { position: "absolute", top: 24, bottom: -6, width: 2.5, borderRadius: 2 },
  node: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  nodeBadge: { fontSize: 22 },
  lockDot: { position: "absolute", right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.06)", alignItems: "center", justifyContent: "center" },

  card: { flex: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  lvlChip: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9 },
  lvlChipText: { color: "#fff", fontSize: 10, fontFamily: "Poppins_700Bold" },
  desc: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 11, fontFamily: "Poppins_600SemiBold" },
  sectionLabel: { fontSize: 10.5, fontFamily: "Poppins_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 7 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  chipText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  footnote: { fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18, marginTop: 4, paddingHorizontal: 16 },
});

// Per-screen error boundary — contains a render crash to this screen instead of
// blanking the whole app with the global fallback.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
