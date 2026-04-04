// FIX #7: FlashList replaces FlatList for performant virtualized rendering
import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { API, resolveMediaUrl } from "@/services/api";
import { formatDuration } from "@/utils/format";

type CallFilter = "All" | "Audio" | "Video";

interface CallItem {
  id: string;
  userName: string;
  userAvatar: string;
  type: "audio" | "video";
  status: "completed" | "missed" | "cancelled";
  durationSecs: number;
  coins: number;
  date: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#0BAF23",
  missed: "#FF5252",
  cancelled: "#9E9E9E",
};

function mapStatus(s: string): "completed" | "missed" | "cancelled" {
  if (s === "ended") return "completed";
  if (s === "declined" || s === "rejected") return "cancelled";
  if (s === "missed" || s === "pending") return "missed";
  return "missed";
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${time}`;
}

export default function HostCallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<CallFilter>("All");
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await API.getCallHistory() as any[];
      const mapped: CallItem[] = (data ?? []).map((c: any) => ({
        id: c.id,
        userName: c.user_name ?? c.caller_name ?? "User",
        userAvatar: resolveMediaUrl(c.user_avatar ?? c.caller_avatar) ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.user_id ?? c.id}`,
        type: (c.type ?? c.call_type ?? "audio") as "audio" | "video",
        status: mapStatus(c.status ?? ""),
        durationSecs: Number(c.duration_secs ?? c.duration ?? 0),
        coins: Number(c.coins_earned ?? c.coins ?? 0),
        date: c.created_at ? formatDate(c.created_at) : "—",
      }));
      setCalls(mapped);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const filtered = calls.filter(c =>
    filter === "All" ? true : c.type === filter.toLowerCase()
  );

  const renderItem = ({ item }: { item: CallItem }) => (
    <View style={[styles.callCard, { backgroundColor: colors.card }]}>
      <Image source={{ uri: item.userAvatar }} style={styles.avatar} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.userName, { color: colors.text }]}>{item.userName}</Text>
        <View style={styles.metaRow}>
          <Image
            source={item.type === "video"
              ? require("@/assets/icons/ic_video_gradient.png")
              : require("@/assets/icons/ic_call_gradient.png")}
            style={styles.typeIcon}
            resizeMode="contain"
          />
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {item.type === "video" ? "Video" : "Audio"} · {item.durationSecs > 0 ? formatDuration(item.durationSecs) : "—"}
          </Text>
        </View>
        <Text style={[styles.date, { color: colors.mutedForeground }]}>{item.date}</Text>
      </View>
      <View style={styles.rightCol}>
        <Text style={[styles.status, { color: STATUS_COLORS[item.status] }]}>
          {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
        </Text>
        {item.coins > 0 && (
          <View style={styles.coinsRow}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
            <Text style={[styles.coins, { color: "#0BAF23" }]}>+{item.coins}</Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Call History</Text>
        <View style={styles.filterRow}>
          {(["All", "Audio", "Video"] as CallFilter[]).map(f => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#A00EE7" size="large" />
        </View>
      ) : (
        <FlashList
          data={filtered}
          keyExtractor={c => c.id}
          estimatedItemSize={90}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#A00EE7" />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No calls yet</Text>
            </View>
          }
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#F0E8FF",
  },
  filterBtnActive: { backgroundColor: "#A00EE7" },
  filterText: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#A00EE7" },
  filterTextActive: { color: "#fff" },
  callCard: {
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  userName: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  typeIcon: { width: 16, height: 16 },
  meta: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  date: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  rightCol: { alignItems: "flex-end", gap: 6 },
  status: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  coinsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  coinIcon: { width: 14, height: 14 },
  coins: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
