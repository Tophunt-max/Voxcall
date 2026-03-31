import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  FlatList, Platform
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const HOST_NOTIFICATIONS = [
  { id: "n1", type: "call", title: "New Call Request", body: "Sarah M. wants to start a session with you", time: "2m ago", read: false },
  { id: "n2", type: "rating", title: "New Rating Received", body: "John D. gave you a 5-star rating", time: "1h ago", read: false },
  { id: "n3", type: "coin", title: "Coins Credited", body: "45 coins credited from your last session", time: "3h ago", read: true },
  { id: "n4", type: "call", title: "Missed Call", body: "Priya K. tried to reach you", time: "Yesterday", read: true },
  { id: "n5", type: "withdraw", title: "Withdrawal Processed", body: "Your withdrawal of 200 coins has been processed", time: "2 days ago", read: true },
];

const ICON_MAP: Record<string, any> = {
  call: require("@/assets/icons/ic_call.png"),
  rating: require("@/assets/icons/ic_star.png"),
  coin: require("@/assets/icons/ic_coin.png"),
  withdraw: require("@/assets/icons/ic_withdraw.png"),
};
const COLOR_MAP: Record<string, string> = {
  call: "#F0E4F8",
  rating: "#FFF8E1",
  coin: "#FFF8E1",
  withdraw: "#E8F5E9",
};
const ICON_COLOR_MAP: Record<string, string> = {
  call: "#A00EE7",
  rating: "#FFA100",
  coin: "#FFA100",
  withdraw: "#0BAF23",
};

export default function HostNotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Notifications</Text>
      </View>

      <FlatList
        data={HOST_NOTIFICATIONS}
        keyExtractor={n => n.id}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={require("@/assets/images/empty_notifications.png")} style={styles.emptyImg} resizeMode="contain" />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No notifications yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.notifCard, {
            backgroundColor: item.read ? colors.card : "#F8F0FF",
            borderLeftColor: item.read ? "transparent" : colors.accent,
            borderLeftWidth: item.read ? 0 : 3,
          }]}>
            <View style={[styles.iconWrap, { backgroundColor: COLOR_MAP[item.type] ?? "#F0E4F8" }]}>
              <Image source={ICON_MAP[item.type]} style={[styles.icon, { tintColor: ICON_COLOR_MAP[item.type] ?? colors.accent }]} resizeMode="contain" />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.notifTitle, { color: colors.text }]}>{item.title}</Text>
              <Text style={[styles.notifBody, { color: colors.mutedForeground }]}>{item.body}</Text>
              <Text style={[styles.notifTime, { color: colors.mutedForeground }]}>{item.time}</Text>
            </View>
            {!item.read && <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  notifCard: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  icon: { width: 22, height: 22 },
  notifTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  notifBody: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 18 },
  notifTime: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  empty: { alignItems: "center", gap: 12, paddingTop: 80 },
  emptyImg: { width: 160, height: 130 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
