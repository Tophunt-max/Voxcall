import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  FlatList
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

type CallFilter = "All" | "Audio" | "Video";

const HOST_CALLS = [
  { id: "c1", userName: "Sarah Mitchell", userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=sarah2", type: "audio", status: "completed", duration: "18:22", coins: 73, date: "Today, 10:14 AM" },
  { id: "c2", userName: "John Doe", userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=john", type: "video", status: "completed", duration: "09:44", coins: 39, date: "Today, 08:30 AM" },
  { id: "c3", userName: "Priya K.", userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=priya2", type: "audio", status: "missed", duration: "—", coins: 0, date: "Yesterday, 9:50 PM" },
  { id: "c4", userName: "Amara S.", userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=amara", type: "video", status: "completed", duration: "24:10", coins: 97, date: "Yesterday, 5:00 PM" },
  { id: "c5", userName: "Rohan G.", userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=rohan", type: "audio", status: "cancelled", duration: "—", coins: 0, date: "Mar 28, 3:40 PM" },
  { id: "c6", userName: "Mei Chen", userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=meic", type: "audio", status: "completed", duration: "33:05", coins: 132, date: "Mar 27, 11:00 AM" },
];

const STATUS_COLORS: Record<string, string> = {
  completed: "#0BAF23",
  missed: "#FF5252",
  cancelled: "#9E9E9E",
};

export default function HostCallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<CallFilter>("All");

  const filtered = HOST_CALLS.filter(c =>
    filter === "All" ? true : c.type === filter.toLowerCase()
  );

  const renderItem = ({ item }: { item: typeof HOST_CALLS[0] }) => (
    <View style={[styles.callCard, { backgroundColor: colors.card }]}>
      <Image source={{ uri: item.userAvatar }} style={styles.avatar} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.userName, { color: colors.text }]}>{item.userName}</Text>
        <View style={styles.metaRow}>
          <Image
            source={item.type === "video" ? require("@/assets/icons/ic_video_gradient.png") : require("@/assets/icons/ic_call_gradient.png")}
            style={styles.typeIcon}
            resizeMode="contain"
          />
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {item.type === "video" ? "Video" : "Audio"} · {item.duration}
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
            <Text style={[styles.coins, { color: "#FFA100" }]}>+{item.coins}</Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Call History</Text>
        <View style={[styles.filterRow]}>
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

      <FlatList
        data={filtered}
        keyExtractor={c => c.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 10, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No calls yet</Text>
          </View>
        }
        renderItem={renderItem}
      />
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
  empty: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
