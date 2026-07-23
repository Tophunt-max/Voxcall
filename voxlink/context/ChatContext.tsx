import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { API, resolveMediaUrl } from "@/services/api";
import socketService from "@/services/SocketService";
import { SocketEvents } from "@/constants/events";
import { showErrorToast } from "@/components/Toast";

export type MessageType = "text" | "image" | "audio" | "gift";
export type MessageStatus = "sending" | "sent" | "failed";

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
  /** Delivery status for optimistic outgoing messages. Undefined == delivered
   *  (e.g. messages loaded from the server). */
  status?: MessageStatus;
  /** Sender edited this message after sending. */
  edited?: boolean;
  /** Sender deleted this message ("deleted for everyone") — render a placeholder. */
  deleted?: boolean;
}

export interface Conversation {
  id: string;
  /** The other party's "logical" id (host.id or user.id depending on context). */
  participantId: string;
  participantName: string;
  participantAvatar?: string;
  /**
   * The other party's `users.id` — used to correlate presence:update events
   * (which carry user_id) with this conversation. Optional because the
   * /rooms endpoint is the only source that knows it; in-memory rooms
   * created via getOrCreateConversation may not have it yet.
   */
  participantUserId?: string;
  /** Live online/offline state — driven by /chat/rooms initially and then
   *  kept fresh by PRESENCE_UPDATE events from the WebSocket. */
  participantIsOnline: boolean;
  /** Whether the other party is an active VIP + their tier (for a chat badge). */
  isVip?: boolean;
  vipTier?: string | null;
  /** True when the OTHER party is currently typing in this room. Set by
   *  MESSAGE_TYPING events and cleared either by MESSAGE_TYPING_STOP or by
   *  a safety timeout (in case the stop event is dropped). */
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
  /** Send a coin-priced gift. Returns the new coin balance on success. */
  sendGift: (conversationId: string, gift: { id: string; name: string; icon: string; price_coins: number }) => Promise<number | null>;
  retryMessage: (conversationId: string, messageId: string) => Promise<void>;
  editMessage: (conversationId: string, messageId: string, content: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  markRead: (conversationId: string) => void;
  loadConversations: (userId: string) => Promise<void>;
  loadMessages: (conversationId: string, roomId: string) => Promise<void>;
  getOrCreateConversation: (
    participantId: string,
    participantName: string,
    avatar?: string,
    roomId?: string,
    opts?: { participantUserId?: string; isOnline?: boolean },
  ) => Conversation;
  /**
   * Notify the other participant that we started/stopped typing in this room.
   * Best-effort — never throws into the UI. Caller is responsible for
   * debouncing (e.g. send `true` on first keystroke, `false` after a short
   * idle period or on send).
   */
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  /** Tell the context which room is currently open on screen (null when none)
   *  so inbound messages for it don't inflate the unread badge. */
  setActiveRoom: (roomId: string | null) => void;
  totalUnread: number;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** How long we keep showing "typing…" after the last MESSAGE_TYPING event,
 *  even if no MESSAGE_TYPING_STOP arrives. Network drops, app backgrounding
 *  on the sender, etc., can swallow the stop event and leave the indicator
 *  stuck — this guarantees it always clears. */
const TYPING_AUTO_CLEAR_MS = 5000;

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // One auto-clear timer per (roomId or convoId) — refreshed on every
  // MESSAGE_TYPING event we receive for that room.
  const typingClearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // roomId the user currently has OPEN. Inbound messages for this room must not
  // bump the unread badge (they're already on screen) — the chat screen sets
  // this on focus and clears it on blur. Null = no thread open (safe default).
  const activeRoomRef = useRef<string | null>(null);
  const setActiveRoom = useCallback((roomId: string | null) => { activeRoomRef.current = roomId; }, []);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  // ─── Helpers ───────────────────────────────────────────────────────────
  const setIsTyping = useCallback((roomOrConvoId: string, isTyping: boolean) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === roomOrConvoId || c.roomId === roomOrConvoId
          ? { ...c, isTyping }
          : c,
      ),
    );
  }, []);

  const clearTypingTimer = useCallback((key: string) => {
    const t = typingClearTimers.current.get(key);
    if (t) {
      clearTimeout(t);
      typingClearTimers.current.delete(key);
    }
  }, []);

  // ─── Realtime: presence + typing ───────────────────────────────────────
  // Wire socket → conversation state. We keep the listeners mounted for the
  // whole app session (ChatProvider lives at the root) so updates land even
  // when the user is not on the chat screen — the chat list / badge can
  // reflect them too.
  useEffect(() => {
    // PRESENCE_UPDATE — payload may carry hostId (hosts.id) and/or userId
    // (users.id). We match both so it works regardless of how the convo was
    // created (via host detail page → host.id, or via /rooms → host_user_id).
    const offPresence = socketService.on(SocketEvents.PRESENCE_UPDATE, (data: any) => {
      const hostId: string | undefined = data?.hostId ?? data?.host_id;
      const userId: string | undefined = data?.userId ?? data?.user_id;
      const isOnline: boolean = !!(data?.isOnline ?? data?.is_online);
      if (!hostId && !userId) return;
      setConversations((prev) =>
        prev.map((c) => {
          const matchesHost = hostId && c.participantId === hostId;
          const matchesUser = userId && c.participantUserId === userId;
          return matchesHost || matchesUser ? { ...c, participantIsOnline: isOnline } : c;
        }),
      );
    });

    const handleTyping = (data: any, isTyping: boolean) => {
      const roomId: string | undefined = data?.roomId ?? data?.room_id;
      if (!roomId) return;
      setIsTyping(roomId, isTyping);
      // Always (re)arm or clear the safety timer so a stuck "typing…" can't
      // outlive a dropped stop event.
      clearTypingTimer(roomId);
      if (isTyping) {
        const t = setTimeout(() => {
          setIsTyping(roomId, false);
          typingClearTimers.current.delete(roomId);
        }, TYPING_AUTO_CLEAR_MS);
        typingClearTimers.current.set(roomId, t);
      }
    };

    const offTypingStart = socketService.on(SocketEvents.MESSAGE_TYPING, (d) => handleTyping(d, true));
    const offTypingStop = socketService.on(SocketEvents.MESSAGE_TYPING_STOP, (d) => handleTyping(d, false));

    // ─── Realtime: inbound message ───────────────────────────────────────
    // A new message from the OTHER party — append it live to the matching
    // conversation, bump the preview + unread badge. Deduped by id so a
    // double-delivery (or our own echo) never doubles a bubble.
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
      const viewingThisRoom = activeRoomRef.current != null && (activeRoomRef.current === roomId);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== roomId && c.roomId !== roomId) return c;
          if (c.messages.some((m) => m.id === incoming.id)) return c; // dedupe
          const viewing = viewingThisRoom || (activeRoomRef.current != null && activeRoomRef.current === c.id);
          return {
            ...c,
            messages: [...c.messages, viewing ? { ...incoming, isRead: true } : incoming],
            lastMessage: preview,
            lastMessageTime: incoming.timestamp,
            // FIX (unread flicker/off-by-one): don't bump the badge for a room
            // the user is already viewing — the chat screen shows it live.
            unreadCount: viewing ? c.unreadCount : c.unreadCount + 1,
          };
        }),
      );
      // Persist read state so the server badge + sender receipt stay in sync.
      if (viewingThisRoom) API.markChatRead(roomId).catch(() => {});
    });

    // ─── Realtime: read receipt ──────────────────────────────────────────
    // The other party read the thread → mark our sent bubbles "Seen".
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

    // ─── Realtime: message edited / deleted by the other party ───────────
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

    return () => {
      offPresence();
      offTypingStart();
      offTypingStop();
      offMessage();
      offRead();
      offEdited();
      offDeleted();
      typingClearTimers.current.forEach((t) => clearTimeout(t));
      typingClearTimers.current.clear();
    };
  }, [setIsTyping, clearTypingTimer]);

  // ─── Server data loaders ───────────────────────────────────────────────
  const loadConversations = useCallback(async (_userId: string) => {
    try {
      const rooms = await API.getChatRooms();
      if (rooms && rooms.length > 0) {
        const convos: Conversation[] = rooms.map((r: any) => ({
          id: r.id,
          // Keep the existing semantics: participantId = host.id (rooms.host_id)
          // when the caller is a regular user. The host_id column lines up with
          // what the user app's host cache uses, so PRESENCE_UPDATE.host_id
          // continues to match.
          participantId: r.host_id ?? r.user_id,
          participantName: r.other_name ?? "Host",
          // Resolve relative avatar paths to absolute so chat list + thread
          // avatars render on web instead of 404-ing to a blank circle.
          participantAvatar: resolveMediaUrl(r.other_avatar) ?? undefined,
          participantUserId: r.other_user_id ?? r.host_user_id ?? undefined,
          participantIsOnline: !!(r.other_is_online ?? r.host_is_online),
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
          // For media messages the bubble renders `content` as the URL; gifts
          // render from their denormalized gift_* fields.
          content: mtype === "text" ? (m.content ?? "") : mtype === "gift" ? (m.gift_name ?? "Gift") : (m.media_url ?? m.content ?? ""),
          type: mtype,
          timestamp: (m.created_at ?? 0) * 1000,
          // is_read reflects whether the recipient has read it — for OUR sent
          // messages this drives the "Seen" indicator.
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
    const isMedia = type === "image" || type === "audio";
    const preview = isMedia ? (type === "image" ? "📷 Photo" : "🎤 Voice") : content;

    const tempId = "tmp_" + Date.now();
    const tempMsg: Message = {
      id: tempId,
      senderId: "me",
      receiverId: conversationId,
      content,
      type,
      timestamp: Date.now(),
      isRead: true,
      status: "sending",
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, tempMsg], lastMessage: preview, lastMessageTime: Date.now() }
          : c
      )
    );

    try {
      // For media, `content` holds the URL → send it as media_url with the type.
      const sent = await API.sendMessage(
        roomId,
        isMedia ? "" : content,
        isMedia ? content : undefined,
        isMedia ? type : undefined,
      );
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === tempId
                ? { ...m, id: sent.id ?? m.id, senderId: sent.sender_id ?? "me", status: "sent" as MessageStatus }
                : m
            ),
          };
        })
      );
    } catch (e) {
      // Don't leave a failed message looking delivered — mark it so the UI can
      // show a "Not sent" indicator, and surface the failure to the user.
      console.warn("sendMessage API error:", e);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === tempId ? { ...m, status: "failed" as MessageStatus } : m
            ),
          };
        })
      );
      showErrorToast("Message not sent. Check your connection and try again.");
    }
  }, [conversations]);

  // Send a coin-priced gift. Optimistically appends a gift bubble, calls the
  // gift endpoint (which debits coins + credits the host), and reconciles the
  // bubble id. Returns the sender's new coin balance (or null on failure).
  const sendGift = useCallback(async (
    conversationId: string,
    gift: { id: string; name: string; icon: string; price_coins: number },
  ): Promise<number | null> => {
    const convo = conversations.find((c) => c.id === conversationId || c.roomId === conversationId);
    const roomId = convo?.roomId ?? conversationId;
    if (!roomId) return null;

    const tempId = "tmp_gift_" + Date.now();
    const tempMsg: Message = {
      id: tempId,
      senderId: "me",
      receiverId: conversationId,
      content: gift.name,
      type: "gift",
      timestamp: Date.now(),
      isRead: true,
      status: "sending",
      giftIcon: gift.icon,
      giftName: gift.name,
      giftAmount: gift.price_coins,
    };
    const preview = `🎁 ${gift.name}`;
    setConversations((prev) =>
      prev.map((c) =>
        (c.id === conversationId || c.roomId === conversationId)
          ? { ...c, messages: [...c.messages, tempMsg], lastMessage: preview, lastMessageTime: Date.now() }
          : c,
      ),
    );

    try {
      const res = await API.sendGift(roomId, gift.id);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId && c.roomId !== conversationId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === tempId ? { ...m, id: res.message_id ?? m.id, status: "sent" as MessageStatus } : m,
            ),
          };
        }),
      );
      return typeof res.new_balance === "number" ? res.new_balance : null;
    } catch (e: any) {
      // Roll the optimistic bubble back — the coins were not spent.
      setConversations((prev) =>
        prev.map((c) =>
          (c.id === conversationId || c.roomId === conversationId)
            ? { ...c, messages: c.messages.filter((m) => m.id !== tempId) }
            : c,
        ),
      );
      const msg = String(e?.message || "");
      showErrorToast(/coin/i.test(msg) ? msg : "Couldn't send gift. Please try again.");
      return null;
    }
  }, [conversations]);

  // Re-attempt a previously-failed message in place (tap-to-retry). Reuses the
  // existing optimistic bubble (same id) instead of appending a duplicate.
  const retryMessage = useCallback(async (conversationId: string, messageId: string) => {
    const convo = conversations.find((c) => c.id === conversationId || c.roomId === conversationId);
    if (!convo) return;
    const roomId = convo.roomId ?? conversationId;
    const msg = convo.messages.find((m) => m.id === messageId);
    if (!msg || msg.status !== "failed") return;

    const setStatus = (status: MessageStatus, patch?: Partial<Message>) =>
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convo.id
            ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, status, ...patch } : m)) }
            : c
        )
      );

    setStatus("sending");
    try {
      const isMedia = msg.type === "image" || msg.type === "audio";
      const sent = await API.sendMessage(
        roomId,
        isMedia ? "" : msg.content,
        isMedia ? msg.content : undefined,
        isMedia ? msg.type : undefined,
      );
      setStatus("sent", { id: sent.id ?? msg.id, senderId: sent.sender_id ?? "me" });
    } catch (e) {
      console.warn("retryMessage API error:", e);
      setStatus("failed");
      showErrorToast("Still couldn't send. Please try again.");
    }
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
    try {
      await API.editMessage(roomId, messageId, trimmed);
    } catch {
      showErrorToast("Couldn't edit message. Please try again.");
    }
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
    try {
      await API.deleteMessage(roomId, messageId);
    } catch {
      showErrorToast("Couldn't delete message. Please try again.");
    }
  }, [conversations]);

  const markRead = useCallback((conversationId: string) => {
    const convo = conversations.find((c) => c.id === conversationId || c.roomId === conversationId);
    const roomId = convo?.roomId ?? conversationId;
    // Only reset the unread badge here — we must NOT flip our own messages'
    // isRead (that flag means "seen by the other party" and is driven solely
    // by the chat_read receipt).
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId || c.roomId === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    );
    // Persist to the server (best-effort): clears unread cross-device and
    // fires the read receipt so the sender sees "Seen".
    if (roomId) API.markChatRead(roomId).catch(() => {});
  }, [conversations]);

  const getOrCreateConversation = useCallback((
    participantId: string,
    participantName: string,
    avatar?: string,
    roomId?: string,
    opts?: { participantUserId?: string; isOnline?: boolean },
  ): Conversation => {
    const existing = conversations.find(
      (c) =>
        c.participantId === participantId ||
        c.id === participantId ||
        (roomId && c.roomId === roomId),
    );
    if (existing) {
      // Patch in any missing identity / presence we just learned about.
      const patch: Partial<Conversation> = {};
      if (roomId && !existing.roomId) patch.roomId = roomId;
      if (opts?.participantUserId && !existing.participantUserId) {
        patch.participantUserId = opts.participantUserId;
      }
      if (opts?.isOnline !== undefined) patch.participantIsOnline = !!opts.isOnline;
      if (Object.keys(patch).length > 0) {
        setConversations((prev) =>
          prev.map((c) => (c.id === existing.id ? { ...c, ...patch } : c)),
        );
        return { ...existing, ...patch };
      }
      return existing;
    }
    const newConvo: Conversation = {
      id: roomId ?? participantId,
      participantId,
      participantName,
      participantAvatar: avatar,
      participantUserId: opts?.participantUserId,
      participantIsOnline: !!opts?.isOnline,
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

  const sendTyping = useCallback((conversationId: string, isTyping: boolean) => {
    const convo = conversations.find(
      (c) => c.id === conversationId || c.roomId === conversationId,
    );
    const roomId = convo?.roomId ?? conversationId;
    if (!roomId) return;
    // Best-effort: never surface a typing-relay failure to the user. The
    // chat header simply won't update on the other side.
    API.sendChatTyping(roomId, isTyping).catch((err) =>
      console.warn("[ChatContext] sendChatTyping failed:", err),
    );
  }, [conversations]);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        sendMessage,
        sendGift,
        retryMessage,
        editMessage,
        deleteMessage,
        markRead,
        loadConversations,
        loadMessages,
        getOrCreateConversation,
        sendTyping,
        setActiveRoom,
        totalUnread,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
