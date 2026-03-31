import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { MOCK_CALL_HISTORY, formatDuration, formatRelativeTime } from "@/data/mockData";

type CallFilter = "All" | "Audio" | "Video";

export default function CallingHistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<CallFilter>("All");

  const filtered = MOCK_CALL_HISTORY.filter((c) => {
    if (filter === "All") return true;
    if (filter === "Audio") return c.type === "audio";
    if (filter === "Video") return c.type === "video";
    return true;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Calling History</Text>
      </View>

      <View style={[styles.filterBar, { borderBottomColor: colors.border }]}>
        {(["All", "Audio", "Video"] as CallFilter[]).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterTab, filter === f && { borderBottomColor: "#A00EE7", borderBottomWidth: 2.5 }]}
          >
            <Text style={[styles.filterTabText, { color: filter === f ? "#A00EE7" : colors.mutedForeground }]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Image source={require("@/assets/images/empty_history.png")} style={styles.emptyImg} resizeMode="contain" />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No call history yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.card, { backgroundColor: colors.card,
              ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 2 }, web: { boxShadow: "0 2px 10px rgba(0,0,0,0.07)" } as any }) }]}
            onPress={() => router.push(`/call/summary?callId=${item.id}`)}
          >
            <View style={styles.avatarWrap}>
              <Image
                source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.hostId}` }}
                style={styles.avatar}
              />
              <View style={[styles.callTypeBadge, { backgroundColor: item.type === "video" ? "#F1F0FF" : "#E8CFFF" }]}>
                <Image
                  source={item.type === "video" ? require("@/assets/icons/ic_video.png") : require("@/assets/icons/ic_call.png")}
                  style={styles.callTypeIco}
                  tintColor="#A00EE7"
                  resizeMode="contain"
                />
              </View>
            </View>

            <View style={styles.cardInfo}>
              <Text style={[styles.hostName, { color: colors.text }]}>{item.hostName}</Text>
              <Text style={[styles.callMeta, { color: colors.mutedForeground }]}>
                {item.type === "video" ? "Video Call" : "Audio Call"} • {formatDuration(item.duration)}
              </Text>
              <Text style={[styles.callTime, { color: colors.subText }]}>{formatRelativeTime(item.timestamp)}</Text>
            </View>

            <View style={styles.cardRight}>
              <View style={styles.coinRow}>
                <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIco} resizeMode="contain" />
                <Text style={[styles.coinSpent, { color: colors.coinGoldText }]}>-{item.coinsSpent}</Text>
              </View>
              {item.rating ? (
                <Text style={styles.stars}>{"★".repeat(item.rating)}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", textAlign: "center" },

  filterBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  filterTab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  filterTabText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },

  list: { paddingHorizontal: 14, paddingTop: 12, gap: 10 },
  card: { borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: { position: "relative" },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  callTypeBadge: { position: "absolute", right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#fff" },
  callTypeIco: { width: 12, height: 12 },
  cardInfo: { flex: 1, gap: 2 },
  hostName: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  callMeta: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  callTime: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  cardRight: { alignItems: "flex-end", gap: 4 },
  coinRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  coinIco: { width: 14, height: 14 },
  coinSpent: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  stars: { fontSize: 12, color: "#FFA100" },
  emptyWrap: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyImg: { width: 180, height: 140 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
