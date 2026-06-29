import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Platform, RefreshControl, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { formatRelativeTime } from "@/utils/format";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";

interface Notification {
  id: string;
  type: "call" | "message" | "promo" | "system";
  title: string;
  body: string;
  created_at: number;
  is_read: boolean;
  avatar_url?: string;
}

const PNG_ICONS: Record<string, any> = {
  call: require("@/assets/icons/ic_call.png"),
  message: require("@/assets/icons/ic_chat.png"),
  promo: require("@/assets/icons/ic_bonus.png"),
  system: require("@/assets/icons/ic_settings.png"),
};

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await API.getNotifications();
      setNotifications(data);
    } catch {
      setNotifications([]);
      showErrorToast(t.notificationsScreen.failedLoad);
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
    } catch {
      showErrorToast(t.notificationsScreen.failedMarkAll);
    }
  };

  const markOneRead = async (id: string) => {
    try {
      await API.markOneNotificationRead(id);
      setNotifications(n => n.map(x => x.id === id ? { ...x, is_read: true } : x));
    } catch {
      showErrorToast(t.notificationsScreen.failedUpdate);
    }
  };

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: item.is_read ? colors.background : colors.primary + "08", borderBottomColor: colors.border }]}
      onPress={() => markOneRead(item.id)}
      activeOpacity={0.75}
    >
      <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
        {item.avatar_url
          ? <Image source={{ uri: resolveMediaUrl(item.avatar_url) }} style={styles.notifAvatar} />
          : <Image source={PNG_ICONS[item.type] ?? PNG_ICONS.system} style={{ width: 18, height: 18, tintColor: colors.primary }} resizeMode="contain" />
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
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t.notificationsScreen.goBack}
        >
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: colors.foreground }} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>{t.nav.notifications}</Text>
        <TouchableOpacity
          onPress={markAllRead}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t.notificationsScreen.markAllReadLabel}
        >
          <Text style={[styles.markRead, { color: colors.primary }]}>{t.notificationsScreen.markAllRead}</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20, flexGrow: 1 }}
        ListEmptyComponent={
          loading ? (
            // Initial-load spinner — previously the screen showed a blank list
            // until the request resolved, which read as "no notifications".
            <View style={styles.empty}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Image source={require("@/assets/icons/ic_notify.png")} style={{ width: 40, height: 40, tintColor: colors.mutedForeground }} resizeMode="contain" />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{t.notificationsScreen.empty}</Text>
            </View>
          )
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


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
