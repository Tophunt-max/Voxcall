import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  FlatList, Platform, TextInput
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";

const MOCK_USER_CHATS = [
  { id: "u1", name: "Sarah M.", avatar: "sarah", lastMsg: "Thank you so much for the session!", time: "2m", unread: 2, online: true },
  { id: "u2", name: "John D.", avatar: "john", lastMsg: "Can we schedule another call?", time: "15m", unread: 1, online: true },
  { id: "u3", name: "Priya K.", avatar: "priya", lastMsg: "That was really helpful, thanks!", time: "1h", unread: 0, online: false },
  { id: "u4", name: "Marcus L.", avatar: "marcus", lastMsg: "I'll try the techniques you suggested", time: "3h", unread: 0, online: false },
];

export default function HostChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const topPad = insets.top;

  const filtered = MOCK_USER_CHATS.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Messages</Text>
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search conversations..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={c => c.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 2 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={require("@/assets/images/empty_chat.png")} style={styles.emptyImg} resizeMode="contain" />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No conversations yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/shared/chat/[id]", params: { id: item.id } })}
            style={[styles.chatRow, { borderBottomColor: colors.border }]}
            activeOpacity={0.7}
          >
            <View style={{ position: "relative" }}>
              <Image source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.avatar}` }} style={styles.avatar} />
              {item.online && <View style={styles.onlineDot} />}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.chatName, { color: colors.text }]}>{item.name}</Text>
              <Text style={[styles.chatLast, { color: colors.mutedForeground }]} numberOfLines={1}>{item.lastMsg}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <Text style={[styles.chatTime, { color: colors.mutedForeground }]}>{item.time}</Text>
              {item.unread > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                  <Text style={styles.badgeText}>{item.unread}</Text>
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
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular" },
  chatRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  onlineDot: { position: "absolute", bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: "#0BAF23", borderWidth: 2, borderColor: "#fff" },
  chatName: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  chatLast: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  chatTime: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  badge: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Poppins_700Bold" },
  empty: { alignItems: "center", gap: 12, paddingTop: 60 },
  emptyImg: { width: 160, height: 130 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
