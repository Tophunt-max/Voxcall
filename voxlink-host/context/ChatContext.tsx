import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { API, resolveMediaUrl } from "@/services/api";
import socketService from "@/services/SocketService";
import { SocketEvents } from "@/constants/events";
import { showErrorToast } from "@/components/Toast";

export type MessageType = "text" | "image" | "audio" | "gift";

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: MessageType;
  timestamp: number;
  isRead: boolean;
  /** Gift message fields (type === 'gift'). */
  giftIcon?: string;
  giftName?: string;
  giftAmount?: number;
  /** Set when the optimistic send failed at the API so the UI can flag it. */
  failed?: boolean;
  /** Sender edited this message after sending. */
  edited?: boolean;
  /** Sender deleted this message for everyone — render a placeholder. */
  deleted?: boolean;
}

export interface Conversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar?: string;
  /** The other party's users.id — used to match presence:update events. */
  participantUserId?: string;
  /** Live online/offline state, kept fresh by PRESENCE_UPDATE events. */
  participantIsOnline: boolean;
  /** Whether the other party (the caller) is an active VIP + their tier. */
  isVip?: boolean;
  vipTier?: string | null;
  /** True when the other party is currently typing in this room. */
  isTyping: boolean;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
  messages: Message[];
  roomId?: string;
}

interface ChatContextValue {
  conversations: Conversation[];
  sendMessage: (conversationId: string, content: string, type?: MessageType) => Promise<void>;
  editMessage: (conversationId: string, messageId: string, content: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  markRead: (conversationId: string) => void;
  loadConversations: (userId: string) => Promise<void>;
  loadMessages: (conversationId: string, roomId: string) => Promise<void>;
  getOrCreateConversation: (participantId: string, participantName: string, avatar?: string, roomId?: string) => Conversation;
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  totalUnread: number;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** Safety timeout to clear a stuck "typing…" if the stop event is dropped. */
const TYPING_AUTO_CLEAR_MS = 5000;

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const typingClearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const setIsTyping = useCallback((roomOrConvoId: string, isTyping: boolean) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === roomOrConvoId || c.roomId === roomOrConvoId ? { ...c, isTyping } : c)),
    );
  }, []);

  // ─── Realtime: messages, receipts, presence, typing, edit/delete ───────
  // Mounted for the whole session so the chat list badge + header update even
  // when the host isn't on a thread screen.
  useEffect(() => {
    // Presence — the customer opened/closed the app. Match by users.id.
    const offPresence = socketService.on(SocketEvents.PRESENCE_UPDATE, (data: any) => {
      const userId: string | undefined = data?.userId ?? data?.user_id;
      const isOnline = !!(data?.isOnline ?? data?.is_online);
      if (!userId) return;
      setConversations((prev) =>
        prev.map((c) => (c.participantUserId === userId ? { ...c, participantIsOnline: isOnline } : c)),
      );
    });

    // Typing — customer is typing in a room. Auto-clear if the stop is dropped.
    const handleTyping = (d: any, isTyping: boolean) => {
      const roomId: string | undefined = d?.roomId ?? d?.room_id;
      if (!roomId) return;
      setIsTyping(roomId, isTyping);
      const existing = typingClearTimers.current.get(roomId);
      if (existing) { clearTimeout(existing); typingClearTimers.current.delete(roomId); }
      if (isTyping) {
        const t = setTimeout(() => { setIsTyping(roomId, false); typingClearTimers.current.delete(roomId); }, TYPING_AUTO_CLEAR_MS);
        typingClearTimers.current.set(roomId, t);
      }
    };
    const offTypingStart = socketService.on(SocketEvents.MESSAGE_TYPING, (d) => handleTyping(d, true));
    const offTypingStop = socketService.on(SocketEvents.MESSAGE_TYPING_STOP, (d) => handleTyping(d, false));

    // Edited / deleted by the other party.
    const offEdited = socketService.on(SocketEvents.MESSAGE_EDITED, (data: any) => {
      const roomId: string | undefined = data?.roomId ?? data?.room_id;
      if (!roomId || !data?.id) return;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === roomId || c.roomId === roomId
            ? { ...c, messages: c.messages.map((m) => (m.id === data.id ? { ...m, content: data.content ?? "", edited: true } : m)) }
            : c,
        ),
      );
    });
    const offDeleted = socketService.on(SocketEvents.MESSAGE_DELETED, (data: any) => {
      const roomId: string | undefined = data?.roomId ?? data?.room_id;
      if (!roomId || !data?.id) return;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === roomId || c.roomId === roomId
            ? { ...c, messages: c.messages.map((m) => (m.id === data.id ? { ...m, content: "", type: "text" as MessageType, deleted: true } : m)) }
            : c,
        ),
      );
    });

    const offMessage = socketService.on(SocketEvents.MESSAGE_RECEIVED, (data: any) => {
      const roomId: string | undefined = data?.chatId ?? data?.roomId ?? data?.room_id;
      if (!roomId) return;
      const isGift = data?.kind === "gift" || !!data?.giftName;
      const mediaType = data?.mediaType as MessageType | null | undefined;
      const type: MessageType = isGift ? "gift" : mediaType ? mediaType : "text";
      const incoming: Message = {
        id: data.id,
        senderId: data.senderId ?? "other",
        receiverId: "",
        content: type === "text" ? (data.text ?? "") : type === "gift" ? (data.giftName ?? "Gift") : (data.mediaUrl ?? data.text ?? ""),
        type,
        timestamp: data.timestamp ?? Date.now(),
        isRead: false,
        ...(isGift ? { giftIcon: data.giftIcon, giftName: data.giftName, giftAmount: data.giftAmount } : {}),
      };
      const preview = type === "text" ? incoming.content : type === "gift" ? `🎁 ${incoming.giftName ?? "Gift"}` : (type === "image" ? "📷 Photo" : "🎤 Voice");
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== roomId && c.roomId !== roomId) return c;
          if (c.messages.some((m) => m.id === incoming.id)) return c; // dedupe
          return {
            ...c,
            messages: [...c.messages, incoming],
            lastMessage: preview,
            lastMessageTime: incoming.timestamp,
            unreadCount: c.unreadCount + 1,
          };
        }),
      );
    });

    const offRead = socketService.on(SocketEvents.MESSAGE_READ, (data: any) => {
      const roomId: string | undefined = data?.roomId ?? data?.room_id;
      if (!roomId) return;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === roomId || c.roomId === roomId
            ? { ...c, messages: c.messages.map((m) => ({ ...m, isRead: true })) }
            : c,
        ),
      );
    });

    return () => {
      offPresence();
      offTypingStart();
      offTypingStop();
      offEdited();
      offDeleted();
      offMessage();
      offRead();
      typingClearTimers.current.forEach((t) => clearTimeout(t));
      typingClearTimers.current.clear();
    };
  }, [setIsTyping]);

  const loadConversations = useCallback(async (_userId: string) => {
    try {
      const rooms = await API.getChatRooms();
      if (rooms && rooms.length > 0) {
        const convos: Conversation[] = rooms.map((r: any) => ({
          id: r.id,
          participantId: r.host_id ?? r.user_id,
          participantName: r.other_name ?? "Host",
          // Resolve relative avatar paths to absolute so chat list + thread
          // avatars render on web instead of 404-ing to a blank circle.
          participantAvatar: resolveMediaUrl(r.other_avatar) ?? undefined,
          participantUserId: r.other_user_id ?? undefined,
          participantIsOnline: !!(r.other_is_online),
          isVip: !!r.other_is_vip,
          vipTier: r.other_vip_tier ?? undefined,
          isTyping: false,
          lastMessage: r.last_message ?? "",
          lastMessageTime: r.last_message_at ? r.last_message_at * 1000 : Date.now(),
          unreadCount: r.unread_count ?? 0,
          messages: [],
          roomId: r.id,
        }));
        setConversations(convos);
      }
    } catch (e) {
      console.warn("loadConversations error:", e);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, roomId: string) => {
    try {
      const msgs = await API.getMessages(roomId);
      const mapped: Message[] = (msgs ?? []).map((m: any) => {
        const isGift = m.msg_kind === "gift";
        const mtype: MessageType = isGift ? "gift" : ((m.media_type as MessageType) ?? "text");
        return {
          id: m.id,
          senderId: m.sender_id,
          receiverId: "",
          content: mtype === "text" ? (m.content ?? "") : mtype === "gift" ? (m.gift_name ?? "Gift") : (m.media_url ?? m.content ?? ""),
          type: mtype,
          timestamp: (m.created_at ?? 0) * 1000,
          isRead: !!m.is_read,
          edited: !!m.edited_at,
          deleted: !!m.is_deleted,
          ...(isGift ? { giftIcon: m.gift_icon, giftName: m.gift_name, giftAmount: Number(m.gift_amount) || 0 } : {}),
        };
      });
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversationId || c.roomId === conversationId);
        if (exists) {
          return prev.map((c) =>
            (c.id === conversationId || c.roomId === conversationId)
              ? { ...c, messages: mapped, roomId: roomId }
              : c
          );
        }
        const newConvo: Conversation = {
          id: conversationId,
          participantId: conversationId,
          participantName: "Chat",
          participantIsOnline: false,
          isTyping: false,
          lastMessage: mapped.length > 0 ? mapped[mapped.length - 1].content : "",
          lastMessageTime: mapped.length > 0 ? mapped[mapped.length - 1].timestamp : Date.now(),
          unreadCount: 0,
          messages: mapped,
          roomId,
        };
        return [newConvo, ...prev];
      });
    } catch (e) {
      console.warn("loadMessages error:", e);
    }
  }, []);

  const sendMessage = useCallback(async (conversationId: string, content: string, type: MessageType = "text") => {
    const convo = conversations.find((c) => c.id === conversationId);
    const roomId = convo?.roomId ?? conversationId;

    const tempId = "tmp_" + Date.now();
    const tempMsg: Message = {
      id: tempId,
      senderId: "me",
      receiverId: conversationId,
      content,
      type,
      timestamp: Date.now(),
      isRead: true,
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, tempMsg], lastMessage: content, lastMessageTime: Date.now() }
          : c
      )
    );

    try {
      const sent = await API.sendMessage(roomId, content);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === tempId
                ? { ...m, id: sent.id ?? m.id, senderId: sent.sender_id ?? "me", failed: false }
                : m
            ),
          };
        })
      );
    } catch (e) {
      console.warn("sendMessage API error:", e);
      // FIX (M3): mark the optimistic bubble as failed instead of leaving it
      // looking delivered, and let the user know it didn't send.
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => (m.id === tempId ? { ...m, failed: true } : m)),
          };
        })
      );
      showErrorToast("Message failed to send. Tap to retry or check your connection.");
    }
  }, [conversations]);

  const sendTyping = useCallback((conversationId: string, isTyping: boolean) => {
    const convo = conversations.find((c) => c.id === conversationId || c.roomId === conversationId);
    const roomId = convo?.roomId ?? conversationId;
    if (!roomId) return;
    API.sendChatTyping(roomId, isTyping).catch(() => {});
  }, [conversations]);

  const editMessage = useCallback(async (conversationId: string, messageId: string, content: string) => {
    const convo = conversations.find((c) => c.id === conversationId || c.roomId === conversationId);
    const roomId = convo?.roomId ?? conversationId;
    const trimmed = content.trim();
    if (!roomId || !trimmed) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convo?.id || c.roomId === roomId
          ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, content: trimmed, edited: true } : m)) }
          : c,
      ),
    );
    try { await API.editMessage(roomId, messageId, trimmed); }
    catch { showErrorToast("Couldn't edit message. Please try again."); }
  }, [conversations]);

  const deleteMessage = useCallback(async (conversationId: string, messageId: string) => {
    const convo = conversations.find((c) => c.id === conversationId || c.roomId === conversationId);
    const roomId = convo?.roomId ?? conversationId;
    if (!roomId) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convo?.id || c.roomId === roomId
          ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, content: "", type: "text" as MessageType, deleted: true } : m)) }
          : c,
      ),
    );
    try { await API.deleteMessage(roomId, messageId); }
    catch { showErrorToast("Couldn't delete message. Please try again."); }
  }, [conversations]);

  const markRead = useCallback((conversationId: string) => {
    const convo = conversations.find((c) => c.id === conversationId || c.roomId === conversationId);
    const roomId = convo?.roomId ?? conversationId;
    // Reset the unread badge only — own messages' isRead ("seen") is driven by
    // the chat_read receipt, never here.
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId || c.roomId === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    );
    if (roomId) API.markChatRead(roomId).catch(() => {});
  }, [conversations]);

  const getOrCreateConversation = useCallback((participantId: string, participantName: string, avatar?: string, roomId?: string): Conversation => {
    const existing = conversations.find((c) => c.participantId === participantId || c.id === participantId || (roomId && c.roomId === roomId));
    if (existing) {
      if (roomId && !existing.roomId) {
        setConversations((prev) => prev.map((c) => c.id === existing.id ? { ...c, roomId } : c));
        return { ...existing, roomId };
      }
      return existing;
    }
    const newConvo: Conversation = {
      id: roomId ?? participantId,
      participantId,
      participantName,
      participantAvatar: avatar,
      participantIsOnline: false,
      isTyping: false,
      lastMessage: "",
      lastMessageTime: Date.now(),
      unreadCount: 0,
      messages: [],
      roomId,
    };
    setConversations((prev) => [newConvo, ...prev]);
    return newConvo;
  }, [conversations]);

  return (
    <ChatContext.Provider value={{ conversations, sendMessage, editMessage, deleteMessage, markRead, loadConversations, loadMessages, getOrCreateConversation, sendTyping, totalUnread }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
