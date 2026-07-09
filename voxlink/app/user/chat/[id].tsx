import React, { useState, useRef, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Image, Platform, KeyboardAvoidingView, ActivityIndicator, Modal } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useChat, Message } from "@/context/ChatContext";
import { useLanguage } from "@/context/LanguageContext";
import { API, resolveMediaUrl } from "@/services/api";
import { appendFileToFormData } from "@/utils/fileUpload";
import { alertDialog, confirmDialog } from "@/utils/dialog";
import * as ImagePicker from "expo-image-picker";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import * as Haptics from "expo-haptics";
import { WEB_INPUT_RESET } from "@workspace/shared-ui/utils";

function formatTime(ts: number) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { conversations, sendMessage, retryMessage, editMessage, deleteMessage, markRead, loadMessages, sendTyping } = useChat();
  const { t } = useLanguage();
  const [text, setText] = useState("");
  // Long-press action sheet + inline edit state.
  const [actionMsg, setActionMsg] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [participantName, setParticipantName] = useState(t.chatScreen.defaultName);
  const [participantAvatar, setParticipantAvatar] = useState(`https://api.dicebear.com/7.x/avataaars/png?seed=${id}`);
  const listRef = useRef<FlatList>(null);
  // Typing debounce — track whether we've already told the other side
  // we're typing (so we don't spam the relay) and a timer that auto-stops
  // typing after the user goes idle.
  const typingStateRef = useRef<{ active: boolean }>({ active: false });
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const convo = conversations.find((c) => c.id === id || c.roomId === id);
  const roomId = convo?.roomId ?? id ?? "";
  const convoKey = convo?.id ?? id ?? "";
  // Header status text + color: typing > online > offline. Default to
  // "Offline" when we haven't loaded the convo yet so we never show a
  // stale / fake "Online" pill.
  const headerStatus: { text: string; color: string } = convo?.isTyping
    ? { text: t.chat.typing, color: colors.primary }
    : convo?.participantIsOnline
      ? { text: t.chat.online, color: colors.online }
      : { text: t.chat.offline, color: colors.mutedForeground };

  useEffect(() => {
    if (!id) return;
    if (convo) {
      setParticipantName(convo.participantName);
      if (convo.participantAvatar) setParticipantAvatar(resolveMediaUrl(convo.participantAvatar) ?? convo.participantAvatar);
      markRead(convo.id);
      if (convo.messages.length === 0) {
        setLoading(true);
        loadMessages(convo.id, roomId).finally(() => setLoading(false));
      }
    } else {
      setLoading(true);
      loadMessages(id, id).catch(() => { showErrorToast(t.chatScreen.failedLoadMessages); }).finally(() => setLoading(false));
    }
  }, [id]);

  const messages = convo?.messages ?? [];
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // Mark the thread read whenever the message list grows while it's open (a
  // live inbound message arriving on-screen), so the unread badge + the
  // sender's "Seen" receipt stay accurate without leaving + re-entering.
  useEffect(() => {
    if (convo && messages.length > 0) markRead(convo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Long-press a received message to report it to moderation.
  const reportMessage = (item: Message) => {
    if (!roomId || item.senderId === "me" || item.senderId === user?.id) return;
    confirmDialog({
      title: "Report message?",
      message: "This message will be sent to our moderation team for review.",
      confirmText: "Report",
      destructive: true,
      onConfirm: async () => {
        try {
          await API.reportMessage(roomId, item.id, "Reported from chat");
          showSuccessToast("Reported. Our team will review it.");
        } catch {
          showErrorToast("Couldn't report. Please try again.");
        }
      },
    });
  };

  // Best-effort "stop typing" cleanup — fire whenever we leave a typing-
  // active state (sent message, navigated away, app crashed, etc.) so the
  // other side's "typing…" pill clears immediately instead of waiting for
  // its safety timeout.
  const stopTyping = (notifyServer = true) => {
    if (typingStopTimer.current) {
      clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
    }
    if (typingStateRef.current.active) {
      typingStateRef.current.active = false;
      if (notifyServer && convoKey) sendTyping(convoKey, false);
    }
  };

  // Notify on unmount so the other side never sees a stuck typing indicator
  // when the user backs out mid-typing.
  useEffect(() => {
    return () => stopTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convoKey]);

  const handleChangeText = (next: string) => {
    setText(next);
    if (!convoKey) return;
    if (next.trim().length === 0) {
      // User cleared the input — stop typing right away.
      stopTyping();
      return;
    }
    if (!typingStateRef.current.active) {
      typingStateRef.current.active = true;
      sendTyping(convoKey, true);
    }
    // Reset idle timer: if no further keystroke for ~2.5s, signal stop.
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => stopTyping(), 2500);
  };

  const handleSend = async () => {
    if (!text.trim() || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const msg = text.trim();
    setText("");
    stopTyping();
    // Edit mode: PATCH the existing message instead of sending a new one.
    if (editingId) {
      const eid = editingId;
      setEditingId(null);
      await editMessage(convo?.id ?? id, eid, msg);
      return;
    }
    await sendMessage(convo?.id ?? id, msg);
    setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
  };

  // Long-press → contextual actions (edit/delete own; report others).
  const openActions = (item: Message) => {
    if (item.deleted) return;
    setActionMsg(item);
  };
  const startEdit = (item: Message) => {
    setActionMsg(null);
    setEditingId(item.id);
    setText(item.content);
  };
  const cancelEdit = () => { setEditingId(null); setText(""); };
  const confirmDelete = (item: Message) => {
    setActionMsg(null);
    confirmDialog({
      title: "Delete message?",
      message: "This message will be removed for everyone.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => { void deleteMessage(convo?.id ?? (id as string), item.id); },
    });
  };

  const handleAttachPhoto = async () => {
    if (!id || sendingPhoto) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        alertDialog(t.chatScreen.permissionTitle, t.chatScreen.permissionPhoto);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setSendingPhoto(true);
      const fd = new FormData();
      const rawExt = (asset.uri.split(".").pop() || "jpg").toLowerCase();
      const mime = rawExt === "jpg" ? "jpeg" : rawExt;
      await appendFileToFormData(fd, "file", asset.uri, `chat.${rawExt}`, `image/${mime}`);
      const res = await API.uploadFile(fd);
      const url = res?.url ? (resolveMediaUrl(res.url) || res.url) : null;
      if (!url) { showErrorToast(t.chatScreen.uploadFailed); return; }
      await sendMessage(convo?.id ?? id, url, "image");
      setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
    } catch {
      showErrorToast(t.chatScreen.photoSendFailed);
    } finally {
      setSendingPhoto(false);
    }
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
          ) : item.type === "image" ? (
            <Image
              source={{ uri: item.content }}
              style={styles.bubbleImage}
              resizeMode="cover"
              accessibilityLabel={t.chatScreen.a11yPhotoMessage}
            />
          ) : (
            <Text style={[styles.bubbleText, { color: isMe ? "#fff" : colors.foreground }]}>{item.content}</Text>
          )}
          <View style={styles.bubbleMetaRow}>
            {item.edited && !item.deleted && (
              <Text style={[styles.bubbleStatus, { color: isMe ? "rgba(255,255,255,0.6)" : colors.mutedForeground, fontStyle: "italic" }]}>edited</Text>
            )}
            <Text style={[styles.bubbleTime, { color: isMe ? "rgba(255,255,255,0.6)" : colors.mutedForeground }]}>
              {formatTime(item.timestamp)}
            </Text>
            {isMe && item.status === "sending" && (
              <Text style={[styles.bubbleStatus, { color: "rgba(255,255,255,0.7)" }]}>{t.chatScreen.sending}</Text>
            )}
            {isMe && item.status === "failed" && (
              <TouchableOpacity
                onPress={() => retryMessage(convo?.id ?? (id as string), item.id)}
                accessibilityRole="button"
                accessibilityLabel={t.chatScreen.a11yRetry}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={[styles.bubbleStatus, { color: "#FFD2D2", textDecorationLine: "underline" }]}>{t.chatScreen.tapToRetry}</Text>
              </TouchableOpacity>
            )}
            {/* Delivery / read receipt for our own delivered messages. */}
            {isMe && item.status !== "sending" && item.status !== "failed" && (
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
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t.chatScreen.a11yBack}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: colors.foreground }} resizeMode="contain" />
        </TouchableOpacity>
        <Image source={{ uri: participantAvatar }} style={styles.headerAvatar} />
        <View style={styles.headerInfo}>
          <Text style={[styles.headerName, { color: colors.foreground }]}>{participantName}</Text>
          <Text
            style={[
              styles.headerStatus,
              { color: headerStatus.color, fontStyle: convo?.isTyping ? "italic" : "normal" },
            ]}
            accessibilityLiveRegion="polite"
          >
            {headerStatus.text}
          </Text>
        </View>
        <Image source={require("@/assets/icons/ic_notify.png")} style={{ width: 20, height: 20, tintColor: colors.mutedForeground }} resizeMode="contain" />
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
            <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>{t.chatScreen.emptyHint}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={reversedMessages}
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
          <TouchableOpacity onPress={handleAttachPhoto} disabled={sendingPhoto || !!editingId} style={[styles.iconBtn, { backgroundColor: colors.muted }]} accessibilityRole="button" accessibilityLabel={t.chatScreen.a11yAttach}>
            {sendingPhoto ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Image source={require("@/assets/icons/ic_photo.png")} style={{ width: 18, height: 18, tintColor: colors.mutedForeground }} resizeMode="contain" />
            )}
          </TouchableOpacity>
          <View style={[styles.inputWrap, { backgroundColor: colors.muted }]}>
            <TextInput
              value={text}
              onChangeText={handleChangeText}
              placeholder={t.chat.typeMessage}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground }]}
              multiline
              returnKeyType="send"
              onSubmitEditing={handleSend}
              selectionColor="#A00EE7"
              underlineColorAndroid="transparent"
            />
          </View>
          <TouchableOpacity
            onPress={handleSend}
            disabled={!text.trim()}
            style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.primary : colors.muted }]}
            accessibilityRole="button"
            accessibilityLabel={t.chatScreen.a11ySend}
          >
            <Image source={require("@/assets/icons/ic_send.png")} style={{ width: 18, height: 18, tintColor: text.trim() ? "#fff" : colors.mutedForeground }} resizeMode="contain" />
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
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
