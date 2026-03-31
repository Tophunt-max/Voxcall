import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Platform
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import { formatDuration, formatTimestamp } from "@/utils/format";

interface CallHistoryItem {
  id: string;
  hostId: string;
  hostName: string;
  hostAvatar: string;
  type: "audio" | "video";
  status: "completed" | "missed" | "cancelled";
  durationSecs: number;
  coins: number;
  createdAt: number;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#0BAF23",
  missed: "#F44336",
  cancelled: "#9E9E9E",
};
const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  missed: "Missed",
  cancelled: "Cancelled",
};

function mapStatus(s: string): "completed" | "missed" | "cancelled" {
  if (s === "ended") return "completed";
  if (s === "rejected") return "cancelled";
  return "missed";
}

export default function CallHistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<"all" | "audio" | "video">("all");
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);

  const topPad = insets.top;

  useEffect(() => {
    API.getCallHistory()
      .then((data: any[]) => {
        setCallHistory(data.map((c: any) => ({
          id: c.id,
          hostId: c.host_id || "",
          hostName: c.host_display_name || "Host",
          hostAvatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.host_id || c.id}`,
          type: (c.type || "audio") as "audio" | "video",
          status: mapStatus(c.status || ""),
          durationSecs: c.duration_seconds || 0,
          coins: c.coins_charged || 0,
          createdAt: c.created_at || 0,
        })));
      })
      .catch(() => setCallHistory([]));
  }, []);

  const filtered = filter === "all" ? callHistory : callHistory.filter(c => c.type === filter);

  const renderItem = ({ item }: { item: CallHistoryItem }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
      onPress={() => router.push(`/user/hosts/${item.hostId}`)}
      activeOpacity={0.8}
    >
      <Image source={{ uri: item.hostAvatar }} style={styles.avatar} />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]}>{item.hostName}</Text>
          <Text style={[styles.date, { color: colors.mutedForeground }]}>{item.createdAt ? formatTimestamp(item.createdAt) : "—"}</Text>
        </View>
        <View style={styles.detailRow}>
          <View style={[styles.typeBadge, { backgroundColor: item.type === "video" ? "#E8D5FF" : "#D5F0FF" }]}>
            <Feather name={item.type === "video" ? "video" : "phone"} size={10} color={item.type === "video" ? "#7B2FF7" : "#0078CC"} />
            <Text style={[styles.typeText, { color: item.type === "video" ? "#7B2FF7" : "#0078CC" }]}>
              {item.type === "video" ? "Video" : "Audio"}
            </Text>
          </View>
          <View style={[styles.dot, { backgroundColor: colors.border }]} />
          <Text style={[styles.status, { color: STATUS_COLORS[item.status] }]}>{STATUS_LABELS[item.status]}</Text>
          {item.status === "completed" && (
            <>
              <View style={[styles.dot, { backgroundColor: colors.border }]} />
              <Text style={[styles.duration, { color: colors.mutedForeground }]}>{formatDuration(item.durationSecs)}</Text>
            </>
          )}
        </View>
        {item.coins > 0 && (
          <View style={styles.coinsRow}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
            <Text style={[styles.coinsText, { color: colors.coinGoldText }]}>-{item.coins} coins</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Call History</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filterRow}>
        {(["all", "audio", "video"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, { backgroundColor: filter === f ? colors.primary : colors.surface, borderColor: filter === f ? colors.primary : colors.border }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, { color: filter === f ? "#fff" : colors.mutedForeground }]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Image source={require("@/assets/images/empty_history.png")} style={styles.emptyImg} resizeMode="contain" />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No call history found</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  filterRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  item: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#eee" },
  info: { flex: 1 },
  nameRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  name: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  date: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  typeText: { fontSize: 10, fontFamily: "Poppins_500Medium" },
  dot: { width: 3, height: 3, borderRadius: 1.5 },
  status: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  duration: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  coinsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  coinIcon: { width: 14, height: 14 },
  coinsText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyImg: { width: 200, height: 200 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
