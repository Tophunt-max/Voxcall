// VoxLink Chat Service
// Message send/receive simulation with AsyncStorage persistence

import { setItem, getItem, appendToArray } from "@/utils/storage";

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  type: "text" | "image" | "voice" | "system";
  timestamp: number;
  isRead: boolean;
  isDelivered: boolean;
  imageUrl?: string;
  audioDuration?: number;
}

export interface Conversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  isOnline: boolean;
  isPinned?: boolean;
}

const CHAT_PREFIX = "chat:";
const CONV_KEY = "conversations";

function chatKey(chatId: string) {
  return `${CHAT_PREFIX}${chatId}`;
}

function generateMsgId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function sendMessage(params: {
  chatId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  type?: ChatMessage["type"];
}): Promise<ChatMessage> {
  const msg: ChatMessage = {
    id: generateMsgId(),
    chatId: params.chatId,
    senderId: params.senderId,
    senderName: params.senderName,
    senderAvatar: params.senderAvatar,
    text: params.text,
    type: params.type ?? "text",
    timestamp: Date.now(),
    isRead: false,
    isDelivered: true,
  };

  await appendToArray<ChatMessage>(chatKey(params.chatId), msg);
  return msg;
}

export async function getMessages(chatId: string): Promise<ChatMessage[]> {
  const msgs = await getItem<ChatMessage[]>(chatKey(chatId));
  return (msgs ?? []).sort((a, b) => a.timestamp - b.timestamp);
}

export async function markMessagesRead(chatId: string, userId: string): Promise<void> {
  const msgs = await getMessages(chatId);
  const updated = msgs.map((m) => {
    if (m.senderId !== userId) return { ...m, isRead: true };
    return m;
  });
  await setItem(chatKey(chatId), updated);
}

export async function getConversations(): Promise<Conversation[]> {
  const convs = await getItem<Conversation[]>(CONV_KEY);
  return (convs ?? []).sort((a, b) => b.lastMessageTime - a.lastMessageTime);
}

export async function updateConversation(conv: Conversation): Promise<void> {
  const all = await getConversations();
  const idx = all.findIndex((c) => c.id === conv.id);
  if (idx !== -1) {
    all[idx] = conv;
  } else {
    all.unshift(conv);
  }
  await setItem(CONV_KEY, all.sort((a, b) => b.lastMessageTime - a.lastMessageTime));
}

export async function deleteConversation(chatId: string): Promise<void> {
  const all = await getConversations();
  await setItem(CONV_KEY, all.filter((c) => c.id !== chatId));
  const { removeItem } = await import("@/utils/storage");
  await removeItem(chatKey(chatId));
}

export async function simulateMockReply(
  chatId: string,
  hostName: string,
  hostAvatar: string
): Promise<ChatMessage> {
  const replies = [
    "Hello! How can I help you today?",
    "That's a great question!",
    "I'm here and ready to listen.",
    "Let me know what's on your mind.",
    "I understand, tell me more.",
    "Sure, I'd be happy to talk about that.",
    "Thank you for reaching out!",
    "Feel free to share your thoughts.",
  ];

  await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1000));
  const text = replies[Math.floor(Math.random() * replies.length)];

  return sendMessage({
    chatId,
    senderId: `host_${chatId}`,
    senderName: hostName,
    senderAvatar: hostAvatar,
    text,
    type: "text",
  });
}
