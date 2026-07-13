import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { formatDuration, formatRelativeTime } from "@/utils/format";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";

type CallFilter = "All" | "Audio" | "Video";

export default function CallingHistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [filter, setFilter] = useState<CallFilter>("All");
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await API.getCallHistory();
      setCallHistory((data as any[]).map((c: any) => ({
        id: c.id,
        hostId: c.host_id,
        hostName: c.host_name || c.host_display_name || "Host",
        // Use the host's real avatar when the server provides one; fall back to
        // a deterministic generated avatar only when it's missing.
        hostAvatar: resolveMediaUrl(c.host_avatar) || `https://api.dicebear.com/7.x/avataaars/png?seed=${c.host_id}`,
        type: c.type || "audio",
        duration: c.duration_seconds || 0,
        coinsSpent: c.coins_charged || 0,
        freeMinutesUsed: c.free_minutes_used || 0,
        timestamp: (c.created_at || 0) * 1000,
        rating: c.rating,
      })));
    } catch {
      setCallHistory([]);
      showErrorToast("Failed to load call history.");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadHistory().finally(() => setLoading(false));
  }, [loadHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  }, [loadHistory]);

  const filtered = callHistory.filter((c) => {
    if (filter === "All") return true;
    if (filter === "Audio") return c.type === "audio";
    if (filter === "Video") return c.type === "video";
    return true;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t.calls.callingHistory}</Text>
      </View>

      <View style={[styles.filterBar, { borderBottomColor: colors.border }]}>
        {(["All", "Audio", "Video"] as CallFilter[]).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterTab, filter === f && { borderBottomColor: "#A00EE7", borderBottomWidth: 2.5 }]}
          >
            <Text style={[styles.filterTabText, { color: filter === f ? "#A00EE7" : colors.mutedForeground }]}>
              {f === "All" ? t.common.all : f === "Audio" ? t.calls.audioShort : t.calls.videoShort}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A00EE7" colors={["#A00EE7"]} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator size="large" color="#A00EE7" />
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Image source={require("@/assets/images/empty_history.png")} style={styles.emptyImg} resizeMode="contain" />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{t.calls.noCallHistory}</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.card, { backgroundColor: colors.card,
              ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 2 }, web: { boxShadow: "0 2px 10px rgba(0,0,0,0.07)" } as any }) }]}
            onPress={() => router.push({
              pathname: "/user/call/summary",
              params: {
                duration: String(item.duration),
                type: item.type,
                participantName: item.hostName,
                participantId: item.hostId,
                sessionId: item.id,
                coinsSpent: String(item.coinsSpent),
                freeMinutesUsed: String(item.freeMinutesUsed ?? 0),
                autoEnded: "0",
              },
            })}
          >
            <View style={styles.avatarWrap}>
              <Image
                source={{ uri: item.hostAvatar }}
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
                {item.type === "video" ? t.calls.video : t.calls.audio} • {formatDuration(item.duration)}
              </Text>
              <Text style={[styles.callTime, { color: colors.subText }]}>{formatRelativeTime(item.timestamp)}</Text>
            </View>

            <View style={styles.cardRight}>
              {item.coinsSpent > 0 ? (
                <View style={styles.coinRow}>
                  <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIco} resizeMode="contain" />
                  <Text style={[styles.coinSpent, { color: colors.coinGoldText }]}>-{item.coinsSpent}</Text>
                </View>
              ) : null}
              {item.freeMinutesUsed > 0 ? (
                <Text style={styles.freeTag}>🎁 {item.freeMinutesUsed} free</Text>
              ) : null}
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
  freeTag: { fontSize: 11, fontFamily: "Poppins_700Bold", color: "#0B8F1C", marginTop: 2 },
  stars: { fontSize: 12, color: "#FFA100" },
  emptyWrap: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyImg: { width: 180, height: 140 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
