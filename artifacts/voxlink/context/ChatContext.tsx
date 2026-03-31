import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { API } from "@/services/api";

export type MessageType = "text" | "image" | "audio";

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: MessageType;
  timestamp: number;
  isRead: boolean;
}

export interface Conversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
  messages: Message[];
  roomId?: string;
}

interface ChatContextValue {
  conversations: Conversation[];
  sendMessage: (conversationId: string, content: string, type?: MessageType) => Promise<void>;
  markRead: (conversationId: string) => void;
  loadConversations: (userId: string) => Promise<void>;
  loadMessages: (conversationId: string, roomId: string) => Promise<void>;
  getOrCreateConversation: (participantId: string, participantName: string, avatar?: string) => Conversation;
  totalUnread: number;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const loadConversations = useCallback(async (_userId: string) => {
    try {
      const rooms = await API.getChatRooms();
      if (rooms && rooms.length > 0) {
        const convos: Conversation[] = rooms.map((r: any) => ({
          id: r.id,
          participantId: r.host_id ?? r.user_id,
          participantName: r.other_name ?? "Host",
          participantAvatar: r.other_avatar ?? undefined,
          lastMessage: r.last_message ?? "",
          lastMessageTime: r.last_message_at ? r.last_message_at * 1000 : Date.now(),
          unreadCount: 0,
          messages: [],
          roomId: r.id,
        }));
        setConversations(convos);
      }
    } catch (e) {
      console.log("loadConversations error:", e);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, roomId: string) => {
    try {
      const msgs = await API.getMessages(roomId);
      const mapped: Message[] = (msgs ?? []).map((m: any) => ({
        id: m.id,
        senderId: m.sender_id,
        receiverId: "",
        content: m.content ?? "",
        type: (m.media_type as MessageType) ?? "text",
        timestamp: (m.created_at ?? 0) * 1000,
        isRead: true,
      }));
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, messages: mapped } : c))
      );
    } catch (e) {
      console.log("loadMessages error:", e);
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
                ? { ...m, id: sent.id ?? m.id, senderId: sent.sender_id ?? "me" }
                : m
            ),
          };
        })
      );
    } catch (e) {
      console.log("sendMessage API error:", e);
    }
  }, [conversations]);

  const markRead = useCallback((conversationId: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, unreadCount: 0, messages: c.messages.map((m) => ({ ...m, isRead: true })) }
          : c
      )
    );
  }, []);

  const getOrCreateConversation = useCallback((participantId: string, participantName: string, avatar?: string): Conversation => {
    const existing = conversations.find((c) => c.participantId === participantId || c.id === participantId);
    if (existing) return existing;
    const newConvo: Conversation = {
      id: participantId,
      participantId,
      participantName,
      participantAvatar: avatar,
      lastMessage: "",
      lastMessageTime: Date.now(),
      unreadCount: 0,
      messages: [],
    };
    setConversations((prev) => [newConvo, ...prev]);
    return newConvo;
  }, [conversations]);

  return (
    <ChatContext.Provider value={{ conversations, sendMessage, markRead, loadConversations, loadMessages, getOrCreateConversation, totalUnread }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
