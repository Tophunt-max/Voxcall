import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  Platform,
} from "react-native";
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
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    if (user) loadConversations(user.id);
  }, [user?.id]);

  const filtered = conversations.filter((c) =>
    !search || c.participantName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={[styles.container, { backgroundColor: "#F3E4FF" }]}>
      <View style={[styles.header, { paddingTop: insets.top + 14, backgroundColor: "#F3E4FF" }]}>
        {showSearch ? (
          <View style={styles.searchBar}>
            <Feather name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search conversations..."
              placeholderTextColor={colors.mutedForeground}
              autoFocus
            />
            <TouchableOpacity onPress={() => { setShowSearch(false); setSearch(""); }}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Chats</Text>
            <TouchableOpacity onPress={() => setShowSearch(true)} style={styles.searchBtn}>
              <Feather name="search" size={20} color="#111329" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {filtered.length === 0 ? (
        <View style={[styles.emptyWrap, { backgroundColor: colors.background }]}>
          <Image source={require("@/assets/images/empty_chat.png")} style={styles.emptyImg} resizeMode="contain" />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {search ? "No conversations found" : "No conversations yet"}
          </Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
            {search ? "Try a different name" : "Start chatting after a call with a host"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          style={{ backgroundColor: colors.background }}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/chat/${item.id}`)}
              style={styles.convoRow}
              activeOpacity={0.75}
            >
              <View style={styles.avatarWrap}>
                <Image
                  source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.participantId}` }}
                  style={styles.avatar}
                />
                <View style={[styles.onlineDot, { backgroundColor: colors.online, borderColor: colors.background }]} />
              </View>
              <View style={styles.info}>
                <View style={styles.topRow}>
                  <Text style={[styles.name, { color: colors.text }]}>{item.participantName}</Text>
                  {item.lastMessageTime && (
                    <Text style={[styles.time, { color: colors.mutedForeground }]}>{formatRelativeTime(item.lastMessageTime)}</Text>
                  )}
                </View>
                <View style={styles.bottomRow}>
                  <Text style={[styles.lastMsg, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.lastMessage ?? "Start a conversation"}
                  </Text>
                  {item.unreadCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: "#A00EE7" }]}>
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
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#111329" },
  searchBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.8)", alignItems: "center", justifyContent: "center" },
  searchBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", color: "#111329" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 80 },
  emptyImg: { width: 180, height: 140 },
  emptyTitle: { fontSize: 18, fontFamily: "Poppins_600SemiBold" },
  emptyDesc: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", paddingHorizontal: 40 },
  convoRow: { flexDirection: "row", paddingHorizontal: 20, paddingVertical: 14, gap: 14, alignItems: "center" },
  avatarWrap: { position: "relative" },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  onlineDot: { position: "absolute", right: 2, bottom: 2, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  info: { flex: 1, gap: 4 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  time: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lastMsg: { fontSize: 13, fontFamily: "Poppins_400Regular", flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: "Poppins_700Bold" },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 86 },
});
