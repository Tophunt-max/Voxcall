import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Image, Platform, KeyboardAvoidingView, ActivityIndicator, Alert, Modal } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgIcon } from "@/components/SvgIcon";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useChat, Message } from "@/context/ChatContext";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import * as Haptics from "expo-haptics";
import { useLanguage } from "@/context/LanguageContext";
import { WEB_INPUT_RESET } from "@workspace/shared-ui/utils";

function formatTime(ts: number) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function vipTierEmoji(tier?: string | null): string {
  switch (tier) {
    case "platinum": return "💎";
    case "gold": return "👑";
    case "silver": return "⭐";
    case "weekly": return "🎫";
    default: return "👑";
  }
}

export default function ChatScreen() {
  const { t } = useLanguage();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { conversations, sendMessage, editMessage, deleteMessage, markRead, loadMessages, sendTyping, setActiveRoom } = useChat();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState(t.chatThreadScreen.defaultName);
  const [participantAvatar, setParticipantAvatar] = useState(`https://api.dicebear.com/7.x/avataaars/png?seed=${id}`);
  const listRef = useRef<FlatList>(null);
  const typingStateRef = useRef<{ active: boolean }>({ active: false });
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const convo = conversations.find((c) => c.id === id || c.roomId === id);
  const roomId = convo?.roomId ?? id ?? "";
  const convoKey = convo?.id ?? id ?? "";
  // Header status: typing > online > offline (no more hardcoded "Online").
  const headerStatus = convo?.isTyping
    ? { text: "typing…", color: colors.primary }
    : convo?.participantIsOnline
      ? { text: t.chatThreadScreen.online, color: colors.online }
      : { text: "Offline", color: colors.mutedForeground };

  useEffect(() => {
    if (!id) return;
    if (convo) {
      setParticipantName(convo.participantName);
      // Resolve relative avatar paths to absolute (matches the user app) so the
      // chat header/message avatars render on web instead of a blank circle.
      if (convo.participantAvatar) setParticipantAvatar(resolveMediaUrl(convo.participantAvatar) || convo.participantAvatar);
      markRead(convo.id);
      if (convo.messages.length === 0) {
        setLoading(true);
        loadMessages(convo.id, roomId).finally(() => setLoading(false));
      }
    } else {
      setLoading(true);
      loadMessages(id, id).catch(() => { showErrorToast(t.chatThreadScreen.loadFailed); }).finally(() => setLoading(false));
    }
  }, [id]);

  // Mark this room active while the thread is open so inbound messages for it
  // don't inflate the unread badge; clear on unmount.
  useEffect(() => {
    setActiveRoom(roomId || id || null);
    return () => setActiveRoom(null);
  }, [roomId, id, setActiveRoom]);

  const messages = convo?.messages ?? [];

  // Keep the thread marked read as live messages arrive while it's open.
  useEffect(() => {
    if (convo && messages.length > 0) markRead(convo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Long-press a received message to report it to moderation.
  const reportMessage = (item: Message) => {
    if (!roomId || item.senderId === "me" || item.senderId === user?.id) return;
    const doReport = async () => {
      try {
        await API.reportMessage(roomId, item.id, "Reported from chat");
        showSuccessToast("Reported. Our team will review it.");
      } catch {
        showErrorToast("Couldn't report. Please try again.");
      }
    };
    // Alert.alert works on native (the host app's primary surface); fall back
    // to window.confirm on web (same pattern as gallery.tsx).
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm("Report this message to moderation?")) void doReport();
    } else {
      Alert.alert("Report message?", "This message will be sent to our moderation team for review.", [
        { text: "Cancel", style: "cancel" },
        { text: "Report", style: "destructive", onPress: () => void doReport() },
      ]);
    }
  };

  // ─── Typing indicator (debounced) ───────────────────────────────────────
  const stopTyping = (notifyServer = true) => {
    if (typingStopTimer.current) { clearTimeout(typingStopTimer.current); typingStopTimer.current = null; }
    if (typingStateRef.current.active) {
      typingStateRef.current.active = false;
      if (notifyServer && convoKey) sendTyping(convoKey, false);
    }
  };
  useEffect(() => {
    return () => stopTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convoKey]);
  const handleChangeText = (next: string) => {
    setText(next);
    if (!convoKey || editingId) return; // don't emit typing while editing
    if (next.trim().length === 0) { stopTyping(); return; }
    if (!typingStateRef.current.active) { typingStateRef.current.active = true; sendTyping(convoKey, true); }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => stopTyping(), 2500);
  };

  // ─── Long-press actions (edit/delete own; report others) ─────────────────
  const openActions = (item: Message) => { if (!item.deleted) setActionMsg(item); };
  const startEdit = (item: Message) => { setActionMsg(null); setEditingId(item.id); setText(item.content); };
  const cancelEdit = () => { setEditingId(null); setText(""); };
  const confirmDelete = (item: Message) => {
    setActionMsg(null);
    const doDelete = () => { void deleteMessage(convo?.id ?? (id as string), item.id); };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm("Delete this message for everyone?")) doDelete();
    } else {
      Alert.alert("Delete message?", "This message will be removed for everyone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const handleSend = async () => {
    if (!text.trim() || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const msg = text.trim();
    setText("");
    stopTyping();
    if (editingId) {
      const eid = editingId;
      setEditingId(null);
      await editMessage(convo?.id ?? id, eid, msg);
      return;
    }
    await sendMessage(convo?.id ?? id, msg);
    setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.senderId === "me" || item.senderId === user?.id;
    return (
      <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
        {!isMe && <Image source={{ uri: participantAvatar }} style={styles.msgAvatar} />}
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => openActions(item)}
          delayLongPress={350}
          style={[
            styles.bubble,
            isMe ? { backgroundColor: colors.primary } : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
          ]}>
          {item.deleted ? (
            <Text style={[styles.bubbleText, { fontStyle: "italic", color: isMe ? "rgba(255,255,255,0.7)" : colors.mutedForeground }]}>
              🚫 This message was deleted
            </Text>
          ) : item.type === "gift" ? (
            <View style={styles.giftInner}>
              <Text style={styles.giftEmoji}>{item.giftIcon ?? "🎁"}</Text>
              <Text style={[styles.giftName, { color: isMe ? "#fff" : colors.foreground }]} numberOfLines={1}>{item.giftName ?? "Gift"}</Text>
              <Text style={[styles.giftCoins, { color: isMe ? "rgba(255,255,255,0.9)" : colors.accent }]}>+{(item.giftAmount ?? 0).toLocaleString()} coins</Text>
            </View>
          ) : item.type === "image" ? (
            <Image source={{ uri: item.content }} style={styles.bubbleImage} resizeMode="cover" />
          ) : (
            <Text style={[styles.bubbleText, { color: isMe ? "#fff" : colors.foreground }]}>{item.content}</Text>
          )}
          <View style={styles.bubbleMetaRow}>
            {item.edited && !item.deleted && (
              <Text style={[styles.bubbleStatus, { color: isMe ? "rgba(255,255,255,0.6)" : colors.mutedForeground, fontStyle: "italic" }]}>edited</Text>
            )}
            <Text style={[styles.bubbleTime, { color: isMe ? "rgba(255,255,255,0.6)" : colors.mutedForeground }]}>
              {item.failed ? t.chatThreadScreen.notSent : formatTime(item.timestamp)}
            </Text>
            {isMe && !item.failed && !item.deleted && (
              <Text style={[styles.bubbleStatus, { color: "rgba(255,255,255,0.7)" }]}>
                {item.isRead ? "Seen" : "Sent"}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: colors.foreground }} resizeMode="contain" />
        </TouchableOpacity>
        <Image source={{ uri: participantAvatar }} style={styles.headerAvatar} />
        <View style={styles.headerInfo}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.headerName, { color: colors.foreground }]} numberOfLines={1}>{participantName}</Text>
            {convo?.isVip && (
              <View style={styles.vipChip}>
                <Text style={styles.vipChipText}>{vipTierEmoji(convo.vipTier)} VIP</Text>
              </View>
            )}
          </View>
          <Text style={[styles.headerStatus, { color: headerStatus.color, fontStyle: convo?.isTyping ? "italic" : "normal" }]} accessibilityLiveRegion="polite">{headerStatus.text}</Text>
        </View>
        <SvgIcon name="info" size={20} color={colors.mutedForeground} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <Image source={{ uri: participantAvatar }} style={styles.emptyAvatar} />
            <Text style={[styles.emptyName, { color: colors.foreground }]}>{participantName}</Text>
            <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>{t.chatThreadScreen.startConvo}</Text>
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

        {editingId && (
          <View style={[styles.editBanner, { backgroundColor: colors.muted, borderTopColor: colors.border }]}>
            <Text style={[styles.editBannerText, { color: colors.foreground }]} numberOfLines={1}>Editing message</Text>
            <TouchableOpacity onPress={cancelEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: colors.primary, fontFamily: "Poppins_600SemiBold", fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.muted }]}>
            <Image source={require("@/assets/icons/ic_photo.png")} style={styles.inputIcon} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>
          <View style={[styles.inputWrap, { backgroundColor: colors.muted }]}>
            <TextInput
              value={text}
              onChangeText={handleChangeText}
              placeholder={t.chatThreadScreen.typePlaceholder}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground }]}
              multiline
              returnKeyType="send"
              onSubmitEditing={handleSend}
              selectionColor={colors.accent}
              underlineColorAndroid="transparent"
            />
          </View>
          <TouchableOpacity
            onPress={handleSend}
            disabled={!text.trim()}
            style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.primary : colors.muted }]}
          >
            <Image source={require("@/assets/icons/ic_send.png")} style={styles.inputIcon} tintColor={text.trim() ? "#fff" : colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Long-press action sheet */}
      <Modal visible={!!actionMsg} transparent animationType="fade" onRequestClose={() => setActionMsg(null)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setActionMsg(null)}>
          <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
            {actionMsg && (actionMsg.senderId === "me" || actionMsg.senderId === user?.id) ? (
              <>
                {actionMsg.type !== "image" && (
                  <TouchableOpacity style={styles.sheetBtn} onPress={() => startEdit(actionMsg)}>
                    <Text style={[styles.sheetBtnText, { color: colors.foreground }]}>Edit</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.sheetBtn} onPress={() => confirmDelete(actionMsg)}>
                  <Text style={[styles.sheetBtnText, { color: "#E5484D" }]}>Delete</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.sheetBtn} onPress={() => { const m = actionMsg; setActionMsg(null); if (m) reportMessage(m); }}>
                <Text style={[styles.sheetBtnText, { color: "#E5484D" }]}>Report</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.sheetBtn} onPress={() => setActionMsg(null)}>
              <Text style={[styles.sheetBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
  vipChip: { backgroundColor: "#F5E8FF", borderColor: "#E2C2FF", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  vipChipText: { fontSize: 9, fontFamily: "Poppins_700Bold", color: "#A00EE7" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 40 },
  emptyAvatar: { width: 72, height: 72, borderRadius: 36 },
  emptyName: { fontSize: 18, fontFamily: "Poppins_600SemiBold" },
  emptyHint: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center" },
  msgRow: { flexDirection: "row", gap: 8, marginBottom: 12, alignItems: "flex-end" },
  msgRowMe: { flexDirection: "row-reverse" },
  msgAvatar: { width: 28, height: 28, borderRadius: 14 },
  bubble: { maxWidth: "72%", padding: 12, borderRadius: 18, gap: 4 },
  bubbleText: { fontSize: 14, fontFamily: "Poppins_400Regular", lineHeight: 20 },
  bubbleImage: { width: 200, height: 200, borderRadius: 12, marginBottom: 2 },
  giftInner: { alignItems: "center", gap: 3, paddingVertical: 2, minWidth: 96 },
  giftEmoji: { fontSize: 42, lineHeight: 48 },
  giftName: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  giftCoins: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  bubbleMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  bubbleTime: { fontSize: 10, fontFamily: "Poppins_400Regular", alignSelf: "flex-end" },
  bubbleStatus: { fontSize: 10, fontFamily: "Poppins_500Medium" },
  editBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  editBannerText: { flex: 1, fontSize: 12, fontFamily: "Poppins_500Medium" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { paddingTop: 8, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetBtn: { paddingVertical: 16, alignItems: "center" },
  sheetBtnText: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  inputBar: { flexDirection: "row", padding: 12, gap: 8, alignItems: "flex-end", borderTopWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  inputWrap: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100 },
  input: { fontSize: 14, fontFamily: "Poppins_400Regular", padding: 0, ...(WEB_INPUT_RESET as any) },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  inputIcon: { width: 18, height: 18 },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
