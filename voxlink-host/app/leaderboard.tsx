// Leaderboard — top hosts by coins earned from calls in the last 7 days, with a
// top-3 podium, ranked list, and the host's own rank pinned at the bottom.
// Backed by GET /api/host/leaderboard.
import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image, RefreshControl, Platform } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { API, resolveMediaUrl } from "@/services/api";
import type { HostLeaderboardEntry } from "@/services/api";

const HEADER_GRAD: readonly [string, string] = ["#7B2FF7", "#9D4EDD"];
const ME_GRAD: readonly [string, string] = ["#5B21B6", "#9333EA"];

// place 0 = 1st, 1 = 2nd, 2 = 3rd
const PODIUM = [
  { ring: "#F5B301", grad: ["#FFE58A", "#F5B301"] as const, medal: "🥇", h: 116 },
  { ring: "#AEB8C6", grad: ["#E8EEF5", "#AEB8C6"] as const, medal: "🥈", h: 92 },
  { ring: "#D97B2B", grad: ["#F6C27A", "#D97B2B"] as const, medal: "🥉", h: 76 },
];

function rankAvatar(entry: HostLeaderboardEntry): string {
  return resolveMediaUrl(entry.avatar) || `https://api.dicebear.com/7.x/avataaars/png?seed=${entry.host_id}`;
}

function shadow(color = "#5B21B6", opacity = 0.14) {
  return Platform.select({
    ios: { shadowColor: color, shadowOpacity: opacity, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 4 },
    web: { boxShadow: `0 6px 16px rgba(91,33,182,${opacity})` } as any,
  });
}

function PodiumColumn({ entry, place, colors }: { entry?: HostLeaderboardEntry; place: 0 | 1 | 2; colors: ReturnType<typeof useColors> }) {
  if (!entry) return <View style={{ flex: 1 }} />;
  const cfg = PODIUM[place];
  return (
    <View style={styles.podCol}>
      {place === 0 ? <Text style={styles.crown}>👑</Text> : null}
      <View style={[styles.podRing, { borderColor: cfg.ring }]}>
        <Image source={{ uri: rankAvatar(entry) }} style={styles.podAvatar} />
        <View style={[styles.podMedal, { backgroundColor: colors.card }]}>
          <Text style={{ fontSize: 15 }}>{cfg.medal}</Text>
        </View>
      </View>
      <Text style={[styles.podName, { color: colors.text }]} numberOfLines={1}>{entry.name}</Text>
      <View style={[styles.podCoins, { backgroundColor: colors.card }]}>
        <Text style={styles.podCoinEmoji}>🪙</Text>
        <Text style={[styles.podCoinText, { color: colors.text }]}>{entry.coins.toLocaleString()}</Text>
      </View>
      <LinearGradient colors={cfg.grad} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[styles.podStand, { height: cfg.h }]}>
        <Text style={styles.podRankNum}>{entry.rank}</Text>
      </LinearGradient>
    </View>
  );
}

export default function Leaderboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["host-leaderboard"],
    queryFn: () => API.getLeaderboard(),
    staleTime: 60_000,
  });

  const entries = data?.entries ?? [];
  const me = data?.me;
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  const RestRow = ({ item }: { item: HostLeaderboardEntry }) => {
    const isMe = !!me && me.rank > 0 && item.rank === me.rank;
    return (
      <View style={[styles.row, { backgroundColor: isMe ? colors.accentLight : colors.card, borderColor: isMe ? colors.accent : colors.border }, shadow("#000", 0.05)]}>
        <View style={[styles.rankBadge, { backgroundColor: isMe ? colors.accent : "rgba(124,47,247,0.12)" }]}>
          <Text style={[styles.rankBadgeText, { color: isMe ? "#fff" : "#7C3AED" }]}>{item.rank}</Text>
        </View>
        <Image source={{ uri: rankAvatar(item) }} style={styles.avatar} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{item.badge} {item.name}{isMe ? " (You)" : ""}</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>{item.calls} call{item.calls === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.coinsWrap}>
          <Text style={[styles.coins, { color: colors.text }]}>{item.coins.toLocaleString()}</Text>
          <Text style={[styles.coinsLabel, { color: colors.mutedForeground }]}>coins</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Gradient header */}
      <LinearGradient colors={HEADER_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>🏆 Leaderboard</Text>
          <Text style={styles.headerSub}>Top hosts · last 7 days</Text>
        </View>
      </LinearGradient>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 44 }}>😕</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn't load the leaderboard</Text>
          <TouchableOpacity onPress={() => refetch()} style={[styles.retryBtn, { borderColor: colors.border }]}>
            <Text style={[styles.emptyHint, { color: colors.accent }]}>{isRefetching ? "Retrying…" : "Retry"}</Text>
          </TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 52 }}>🏆</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No rankings yet</Text>
          <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>Complete calls this week to climb the board!</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: (me ? 96 : 24) + insets.bottom }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
        >
          {/* Podium */}
          <View style={styles.podium}>
            <PodiumColumn entry={top3[1]} place={1} colors={colors} />
            <PodiumColumn entry={top3[0]} place={0} colors={colors} />
            <PodiumColumn entry={top3[2]} place={2} colors={colors} />
          </View>

          {rest.length > 0 ? (
            <View style={styles.listWrap}>
              {rest.map((item) => <RestRow key={item.host_id} item={item} />)}
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Your rank — pinned gradient footer */}
      {me ? (
        <LinearGradient colors={ME_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.meBar, { paddingBottom: insets.bottom + 12 }, shadow("#5B21B6", 0.25)]}>
          <View style={styles.meRankWrap}>
            <Text style={styles.meRank}>{me.rank > 0 ? `#${me.rank}` : "—"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.meLabel}>Your rank this week</Text>
            <Text style={styles.meSub}>{me.calls} call{me.calls === 1 ? "" : "s"}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.meCoins}>{me.coins.toLocaleString()}</Text>
            <Text style={styles.meCoinsLabel}>coins</Text>
          </View>
        </LinearGradient>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 12.5, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.85)", marginTop: 1 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: -6 },
  backIcon: { fontSize: 32, fontFamily: "Poppins_400Regular", color: "#fff", marginTop: -4 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyTitle: { fontSize: 17, fontFamily: "Poppins_700Bold", marginTop: 6 },
  emptyHint: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center" },
  retryBtn: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 12, borderWidth: 1 },

  // Podium
  podium: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 10, paddingHorizontal: 16, paddingTop: 22 },
  podCol: { flex: 1, alignItems: "center" },
  crown: { fontSize: 20, marginBottom: 2 },
  podRing: { width: 66, height: 66, borderRadius: 33, borderWidth: 3, alignItems: "center", justifyContent: "center", padding: 2 },
  podAvatar: { width: 56, height: 56, borderRadius: 28 },
  podMedal: { position: "absolute", bottom: -6, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  podName: { fontSize: 12.5, fontFamily: "Poppins_600SemiBold", marginTop: 10, maxWidth: "100%" },
  podCoins: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  podCoinEmoji: { fontSize: 11 },
  podCoinText: { fontSize: 12, fontFamily: "Poppins_700Bold" },
  podStand: { width: "88%", marginTop: 10, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: "center", justifyContent: "flex-start", paddingTop: 8 },
  podRankNum: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "rgba(255,255,255,0.95)" },

  // List (rank 4+)
  listWrap: { paddingHorizontal: 16, paddingTop: 18, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 16, borderWidth: 1 },
  rankBadge: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  rankBadgeText: { fontSize: 12.5, fontFamily: "Poppins_700Bold" },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  name: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  sub: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 1 },
  coinsWrap: { alignItems: "flex-end" },
  coins: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  coinsLabel: { fontSize: 10, fontFamily: "Poppins_400Regular" },

  // Me footer
  meBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  meRankWrap: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  meRank: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#fff" },
  meLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  meSub: { fontSize: 11.5, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.85)", marginTop: 1 },
  meCoins: { fontSize: 17, fontFamily: "Poppins_700Bold", color: "#fff" },
  meCoinsLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.85)" },
});

// Per-screen error boundary — contains a render crash to this screen (retry /
// go back) instead of blanking the whole app with the global fallback.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
