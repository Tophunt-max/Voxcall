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
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/context/ChatContext";
import { useLanguage } from "@/context/LanguageContext";
import { formatRelativeTime } from "@/utils/format";

const ACCENT = "#A00EE7";

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { conversations, loadConversations } = useChat();
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    if (user) loadConversations(user.id);
  }, [user?.id]);

  const filtered = conversations.filter((c) =>
    !search || c.participantName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 14, backgroundColor: colors.background }]}>
        {showSearch ? (
          <View accessible={false} style={[styles.searchBar, { backgroundColor: colors.card }]}>
            <Image source={require("@/assets/icons/ic_search.png")} style={{ width: 18, height: 18, tintColor: colors.mutedForeground }} resizeMode="contain" />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={search}
              onChangeText={setSearch}
              placeholder={t.chat.searchConversations}
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              selectionColor={ACCENT}
              underlineColorAndroid="transparent"
            />
            <TouchableOpacity
              onPress={() => { setShowSearch(false); setSearch(""); }}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <Image source={require("@/assets/icons/ic_close.png")} style={{ width: 18, height: 18, tintColor: colors.mutedForeground }} resizeMode="contain" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerRow}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{t.chat.chats}</Text>
            <TouchableOpacity
              onPress={() => setShowSearch(true)}
              style={[styles.searchBtn, { backgroundColor: colors.muted }]}
              accessibilityRole="button"
              accessibilityLabel={t.chat.searchConversations}
            >
              <Image source={require("@/assets/icons/ic_search.png")} style={{ width: 20, height: 20, tintColor: colors.text }} resizeMode="contain" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {filtered.length === 0 ? (
        <View style={[styles.emptyWrap, { backgroundColor: colors.background }]}>
          <Image source={require("@/assets/images/empty_chat.png")} style={styles.emptyImg} resizeMode="contain" />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {search ? t.chat.noConversationsFound : t.chat.noConversationsYet}
          </Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
            {search ? t.chat.tryDifferentName : t.chat.startChattingAfterCall}
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
              onPress={() => router.push(`/user/chat/${item.id}`)}
              style={styles.convoRow}
              activeOpacity={0.75}
            >
              <View style={styles.avatarWrap}>
                <Image
                  source={{ uri: `https://api.dicebear.com/7.x/avataaars/png?seed=${item.participantId}` }}
                  style={styles.avatar}
                />
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
                    {item.lastMessage ?? t.chat.startConversation}
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
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", color: "#111329", backgroundColor: "transparent", borderWidth: 0 },
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


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
