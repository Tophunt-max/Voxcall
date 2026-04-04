import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  FlatList, TextInput, RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { IconView } from "@/components/IconView";
import { useChat } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { resolveMediaUrl } from "@/services/api";

const ACCENT = "#A00EE7";

function formatTime(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60000) return "now";
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function HostChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { conversations, loadConversations } = useChat();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const topPad = insets.top;

  useEffect(() => {
    if (user?.id) loadConversations(user.id);
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (user?.id) await loadConversations(user.id);
    setRefreshing(false);
  };

  const filtered = conversations.filter(c =>
    c.participantName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Messages</Text>
      </View>

      <View
        accessible={false}
        style={[styles.searchWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <IconView name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search conversations..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          selectionColor={ACCENT}
          underlineColorAndroid="transparent"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={c => c.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={require("@/assets/images/empty_chat.png")} style={styles.emptyImg} resizeMode="contain" />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No conversations yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.id, name: item.participantName } })}
            style={[styles.chatRow, { borderBottomColor: colors.border }]}
            activeOpacity={0.7}
          >
            <View style={{ position: "relative" }}>
              <Image
                source={{ uri: resolveMediaUrl(item.participantAvatar) ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.participantId}` }}
                style={styles.avatar}
              />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.chatName, { color: colors.text }]}>{item.participantName}</Text>
              <Text style={[styles.chatLast, { color: colors.mutedForeground }]} numberOfLines={1}>
                {item.lastMessage || "No messages yet"}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <Text style={[styles.chatTime, { color: colors.mutedForeground }]}>
                {formatTime(item.lastMessageTime)}
              </Text>
              {item.unreadCount > 0 && (
                <View style={[styles.badge, { backgroundColor: ACCENT }]}>
                  <Text style={styles.badgeText}>{item.unreadCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, height: 46, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular", backgroundColor: "transparent", borderWidth: 0 },
  chatRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  chatName: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  chatLast: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  chatTime: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  badge: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Poppins_700Bold" },
  empty: { alignItems: "center", gap: 12, paddingTop: 60 },
  emptyImg: { width: 160, height: 130 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
