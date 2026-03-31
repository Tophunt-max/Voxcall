import React, { useState, useRef } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Image, Platform, KeyboardAvoidingView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useChat, Message } from "@/context/ChatContext";
import { formatRelativeTime, MOCK_HOSTS } from "@/data/mockData";
import * as Haptics from "expo-haptics";

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { conversations, sendMessage, markRead } = useChat();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const convo = conversations.find((c) => c.id === id);
  const host = MOCK_HOSTS.find((h) => h.id === id);
  const participantName = convo?.participantName ?? host?.name ?? "Unknown";
  const participantAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${id}`;

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const handleSend = () => {
    if (!text.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (id) {
      if (!convo) {
        // Create conversation on demand
      }
      sendMessage(id, text.trim());
    }
    setText("");
  };

  const messages = convo?.messages ?? [];

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.senderId === "me" || item.senderId === user?.id;
    return (
      <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
        {!isMe && <Image source={{ uri: participantAvatar }} style={styles.msgAvatar} />}
        <View style={[
          styles.bubble,
          isMe ? { backgroundColor: colors.primary } : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
        ]}>
          <Text style={[styles.bubbleText, { color: isMe ? "#fff" : colors.foreground }]}>{item.content}</Text>
          <Text style={[styles.bubbleTime, { color: isMe ? "rgba(255,255,255,0.6)" : colors.mutedForeground }]}>
            {formatRelativeTime(item.timestamp)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: colors.foreground }} resizeMode="contain" />
        </TouchableOpacity>
        <Image source={{ uri: participantAvatar }} style={styles.headerAvatar} />
        <View style={styles.headerInfo}>
          <Text style={[styles.headerName, { color: colors.foreground }]}>{participantName}</Text>
          <Text style={[styles.headerStatus, { color: colors.online }]}>Online</Text>
        </View>
        <TouchableOpacity onPress={() => host && router.push(`/hosts/${host.id}`)}>
          <Feather name="info" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Image source={{ uri: participantAvatar }} style={styles.emptyAvatar} />
            <Text style={[styles.emptyName, { color: colors.foreground }]}>{participantName}</Text>
            <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>Send a message to start the conversation</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={[...messages].reverse()}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={{ padding: 16 }}
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: bottomPad + 8 }]}>
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.muted }]}>
            <Feather name="image" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={[styles.inputWrap, { backgroundColor: colors.muted }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type a message..."
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground }]}
              multiline
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
          </View>
          <TouchableOpacity
            onPress={handleSend}
            disabled={!text.trim()}
            style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.primary : colors.muted }]}
          >
            <Feather name="send" size={18} color={text.trim() ? "#fff" : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerAvatar: { width: 38, height: 38, borderRadius: 19 },
  headerInfo: { flex: 1, gap: 1 },
  headerName: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  headerStatus: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 40 },
  emptyAvatar: { width: 72, height: 72, borderRadius: 36 },
  emptyName: { fontSize: 18, fontFamily: "Poppins_600SemiBold" },
  emptyHint: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center" },
  msgRow: { flexDirection: "row", gap: 8, marginBottom: 12, alignItems: "flex-end" },
  msgRowMe: { flexDirection: "row-reverse" },
  msgAvatar: { width: 28, height: 28, borderRadius: 14 },
  bubble: { maxWidth: "72%", padding: 12, borderRadius: 18, gap: 4 },
  bubbleText: { fontSize: 14, fontFamily: "Poppins_400Regular", lineHeight: 20 },
  bubbleTime: { fontSize: 10, fontFamily: "Poppins_400Regular", alignSelf: "flex-end" },
  inputBar: { flexDirection: "row", padding: 12, gap: 8, alignItems: "flex-end", borderTopWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  inputWrap: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100 },
  input: { fontSize: 14, fontFamily: "Poppins_400Regular", padding: 0 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
