// Leaderboard — top hosts by coins earned from calls in the last 7 days, with
// the host's own rank pinned at the bottom. Backed by GET /api/host/leaderboard.
import React from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, RefreshControl } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { API, resolveMediaUrl } from "@/services/api";
import type { HostLeaderboardEntry } from "@/services/api";

const MEDAL = ["🥇", "🥈", "🥉"];

function rankAvatar(entry: HostLeaderboardEntry): string {
  return resolveMediaUrl(entry.avatar) || `https://api.dicebear.com/7.x/avataaars/png?seed=${entry.host_id}`;
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

  const renderRow = ({ item }: { item: HostLeaderboardEntry }) => {
    // If the caller is in the top list, their global rank matches this entry's.
    const isMe = !!me && me.rank > 0 && item.rank === me.rank;
    const top3 = item.rank <= 3;
    return (
      <View
        style={[
          styles.row,
          { backgroundColor: isMe ? colors.accentLight : colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.rank, { color: top3 ? colors.text : colors.mutedForeground }]}>
          {top3 ? MEDAL[item.rank - 1] : `#${item.rank}`}
        </Text>
        <Image source={{ uri: rankAvatar(item) }} style={styles.avatar} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {item.badge} {item.name}{isMe ? " (You)" : ""}
          </Text>
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
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={[styles.backIcon, { color: colors.text }]}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Leaderboard</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Top hosts · last 7 days</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>😕</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn't load the leaderboard</Text>
          <TouchableOpacity onPress={() => refetch()} style={[styles.retryBtn, { borderColor: colors.border }]}>
            <Text style={[styles.emptyHint, { color: colors.accent }]}>{isRefetching ? "Retrying…" : "Retry"}</Text>
          </TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>🏆</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No rankings yet</Text>
          <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>Complete calls this week to climb the board!</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.host_id}
          renderItem={renderRow}
          contentContainerStyle={{ padding: 16, paddingBottom: (me ? 90 : 24) + insets.bottom }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}

      {/* Your rank — pinned footer */}
      {me ? (
        <View style={[styles.meBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
          <Text style={[styles.meRank, { color: colors.accent }]}>{me.rank > 0 ? `#${me.rank}` : "—"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.meLabel, { color: colors.text }]}>Your rank this week</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>{me.calls} call{me.calls === 1 ? "" : "s"}</Text>
          </View>
          <View style={styles.coinsWrap}>
            <Text style={[styles.coins, { color: colors.text }]}>{me.coins.toLocaleString()}</Text>
            <Text style={[styles.coinsLabel, { color: colors.mutedForeground }]}>coins</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 1 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: -6 },
  backIcon: { fontSize: 30, fontFamily: "Poppins_400Regular", marginTop: -4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 24 },
  emptyTitle: { fontSize: 16, fontFamily: "Poppins_700Bold", marginTop: 6 },
  emptyHint: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  rank: { width: 32, textAlign: "center", fontSize: 15, fontFamily: "Poppins_700Bold" },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  name: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  sub: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 1 },
  coinsWrap: { alignItems: "flex-end" },
  coins: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  coinsLabel: { fontSize: 10, fontFamily: "Poppins_400Regular" },
  meBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1,
  },
  meRank: { width: 40, textAlign: "center", fontSize: 16, fontFamily: "Poppins_700Bold" },
  meLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  retryBtn: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
});

// Per-screen error boundary — contains a render crash to this screen (retry /
// go back) instead of blanking the whole app with the global fallback.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
