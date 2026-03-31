import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { MOCK_NOTIFICATIONS, Notification, formatRelativeTime } from "@/data/mockData";

const ICONS: Record<string, string> = { call: "phone", message: "message-circle", promo: "gift", system: "info" };

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS);

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const markAllRead = () => setNotifications((n) => n.map((x) => ({ ...x, isRead: true })));

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: item.isRead ? colors.background : colors.primary + "08", borderBottomColor: colors.border }]}
      onPress={() => setNotifications((n) => n.map((x) => x.id === item.id ? { ...x, isRead: true } : x))}
      activeOpacity={0.75}
    >
      <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
        {item.avatar
          ? <Image source={{ uri: item.avatar }} style={styles.notifAvatar} />
          : <Feather name={ICONS[item.type] as any} size={18} color={colors.primary} />
        }
      </View>
      <View style={styles.textArea}>
        <View style={styles.titleRow}>
          <Text style={[styles.notifTitle, { color: colors.foreground }]}>{item.title}</Text>
          {!item.isRead && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
        </View>
        <Text style={[styles.notifBody, { color: colors.mutedForeground }]} numberOfLines={2}>{item.body}</Text>
        <Text style={[styles.notifTime, { color: colors.mutedForeground }]}>{formatRelativeTime(item.timestamp)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
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
        contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="bell-off" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No notifications</Text>
          </View>
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
