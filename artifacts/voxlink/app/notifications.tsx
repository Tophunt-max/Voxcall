import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Platform, RefreshControl } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { formatRelativeTime } from "@/utils/format";
import { API } from "@/services/api";

interface Notification {
  id: string;
  type: "call" | "message" | "promo" | "system";
  title: string;
  body: string;
  created_at: number;
  is_read: boolean;
  avatar_url?: string;
}

const ICONS: Record<string, string> = { call: "phone", message: "message-circle", promo: "gift", system: "info" };

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await API.getNotifications();
      setNotifications(data);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const markAllRead = async () => {
    try {
      await API.markNotificationsRead();
      setNotifications(n => n.map(x => ({ ...x, is_read: true })));
    } catch {}
  };

  const markOneRead = async (id: string) => {
    try {
      await API.markOneNotificationRead(id);
      setNotifications(n => n.map(x => x.id === id ? { ...x, is_read: true } : x));
    } catch {}
  };

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: item.is_read ? colors.background : colors.primary + "08", borderBottomColor: colors.border }]}
      onPress={() => markOneRead(item.id)}
      activeOpacity={0.75}
    >
      <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
        {item.avatar_url
          ? <Image source={{ uri: item.avatar_url }} style={styles.notifAvatar} />
          : <Feather name={ICONS[item.type] as any ?? "bell"} size={18} color={colors.primary} />
        }
      </View>
      <View style={styles.textArea}>
        <View style={styles.titleRow}>
          <Text style={[styles.notifTitle, { color: colors.foreground }]}>{item.title}</Text>
          {!item.is_read && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
        </View>
        <Text style={[styles.notifBody, { color: colors.mutedForeground }]} numberOfLines={2}>{item.body}</Text>
        <Text style={[styles.notifTime, { color: colors.mutedForeground }]}>{formatRelativeTime(item.created_at * 1000)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: colors.foreground }} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
        <TouchableOpacity onPress={markAllRead}>
          <Text style={[styles.markRead, { color: colors.primary }]}>Mark all read</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Feather name="bell-off" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No notifications yet</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  markRead: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  item: { flexDirection: "row", padding: 16, gap: 12, alignItems: "flex-start", borderBottomWidth: StyleSheet.hairlineWidth },
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  notifAvatar: { width: 44, height: 44, borderRadius: 22 },
  textArea: { flex: 1, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  notifTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold", flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  notifBody: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 18 },
  notifTime: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 80 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
