import React, { createContext, useContext, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
}

interface ChatContextValue {
  conversations: Conversation[];
  sendMessage: (conversationId: string, content: string, type?: MessageType) => void;
  markRead: (conversationId: string) => void;
  loadConversations: (userId: string) => Promise<void>;
  getOrCreateConversation: (participantId: string, participantName: string, avatar?: string) => Conversation;
  totalUnread: number;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const loadConversations = useCallback(async (userId: string) => {
    try {
      const raw = await AsyncStorage.getItem(`@voxlink_chats_${userId}`);
      if (raw) {
        setConversations(JSON.parse(raw));
      } else {
        const mockConvos: Conversation[] = [
          {
            id: "c1",
            participantId: "host1",
            participantName: "Aria Chen",
            lastMessage: "Thanks for the great call!",
            lastMessageTime: Date.now() - 3600000,
            unreadCount: 2,
            messages: [
              { id: "m1", senderId: "host1", receiverId: userId, content: "Thanks for the great call!", type: "text", timestamp: Date.now() - 3600000, isRead: false },
              { id: "m2", senderId: "host1", receiverId: userId, content: "Hope we can talk again soon.", type: "text", timestamp: Date.now() - 3500000, isRead: false },
            ],
          },
        ];
        setConversations(mockConvos);
      }
    } catch {}
  }, []);

  const sendMessage = useCallback((conversationId: string, content: string, type: MessageType = "text") => {
    const msg: Message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
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
          ? { ...c, messages: [...c.messages, msg], lastMessage: content, lastMessageTime: msg.timestamp }
          : c
      )
    );
  }, []);

  const markRead = useCallback((conversationId: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, unreadCount: 0, messages: c.messages.map((m) => ({ ...m, isRead: true })) }
          : c
      )
    );
  }, []);

  const getOrCreateConversation = useCallback((participantId: string, participantName: string, avatar?: string) => {
    let convo = conversations.find((c) => c.participantId === participantId);
    if (!convo) {
      convo = {
        id: participantId,
        participantId,
        participantName,
        participantAvatar: avatar,
        unreadCount: 0,
        messages: [],
      };
      setConversations((prev) => [convo!, ...prev]);
    }
    return convo;
  }, [conversations]);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <ChatContext.Provider value={{ conversations, sendMessage, markRead, loadConversations, getOrCreateConversation, totalUnread }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
