import React, { useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/context/ChatContext";
import { formatRelativeTime } from "@/data/mockData";

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { conversations, loadConversations } = useChat();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (user) loadConversations(user.id);
  }, [user?.id]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Messages</Text>
      </View>

      {conversations.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="message-circle" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No conversations yet</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Start chatting after a call with a host</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: bottomPad + 90 }}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => router.push(`/chat/${item.id}`)} style={styles.convoRow} activeOpacity={0.75}>
              <View style={styles.avatarWrap}>
                <Image source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.participantId}` }} style={styles.avatar} />
                <View style={[styles.onlineDot, { backgroundColor: colors.online }]} />
              </View>
              <View style={styles.convoInfo}>
                <View style={styles.convoTop}>
                  <Text style={[styles.name, { color: colors.foreground }]}>{item.participantName}</Text>
                  {item.lastMessageTime && (
                    <Text style={[styles.time, { color: colors.mutedForeground }]}>{formatRelativeTime(item.lastMessageTime)}</Text>
                  )}
                </View>
                <View style={styles.convoBottom}>
                  <Text style={[styles.lastMsg, { color: colors.mutedForeground }]} numberOfLines={1}>{item.lastMessage ?? "Start a conversation"}</Text>
                  {item.unreadCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                      <Text style={styles.badgeText}>{item.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 80 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular" },
  convoRow: { flexDirection: "row", paddingHorizontal: 20, paddingVertical: 14, gap: 14, alignItems: "center" },
  avatarWrap: { position: "relative" },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  onlineDot: { position: "absolute", right: 2, bottom: 2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: "#fff" },
  convoInfo: { flex: 1, gap: 4 },
  convoTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 12, fontFamily: "Inter_400Regular" },
  convoBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lastMsg: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 86 },
});
