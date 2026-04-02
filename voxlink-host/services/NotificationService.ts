// VoxLink Host — Notification Service
// FCM-based push notifications + in-app notification store (Host-specific)

import { Platform } from "react-native";
import { appendToArray, getItem, setItem, StorageKeys } from "@/utils/storage";
import { requestFCMPermission, getFCMToken, setupBackgroundMessageHandler } from "./fcm";

export interface InAppNotification {
  id: string;
  type: "call" | "message" | "system" | "review" | "payment" | "earning";
  title: string;
  body: string;
  timestamp: number;
  isRead: boolean;
  avatar?: string;
  actionUrl?: string;
  data?: Record<string, unknown>;
}

function generateNotifId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Web Browser Notification ────────────────────────────────────────────────

function isWebNotificationSupported(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && "Notification" in window;
}

async function showBrowserNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!isWebNotificationSupported()) return;
  try {
    if ((window as any).Notification.permission === "granted") {
      const n = new (window as any).Notification(title, {
        body,
        icon: "/assets/images/icon.png",
        data,
        requireInteraction: data?.type === "incoming_call",
      });
      if (data?.type !== "incoming_call") {
        setTimeout(() => n.close(), 6000);
      }
    }
  } catch {}
}

// ─── FCM Setup ───────────────────────────────────────────────────────────────

export async function configurePushNotifications(): Promise<void> {
  try {
    await requestFCMPermission();
    if (Platform.OS !== "web") {
      setupBackgroundMessageHandler();
    }
  } catch (err) {
    console.warn("[Notifications] configure error:", err);
  }
}

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const token = await getFCMToken();
    if (token) await setItem(StorageKeys.PUSH_TOKEN, token);
    return token;
  } catch (err) {
    console.warn("[Notifications] register error:", err);
    return null;
  }
}

// ─── Local / Scheduled Notification ─────────────────────────────────────────

export async function scheduleLocalNotification(params: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  delaySeconds?: number;
}): Promise<void> {
  if (Platform.OS === "web") {
    if (params.delaySeconds) {
      setTimeout(
        () => showBrowserNotification(params.title, params.body, params.data),
        params.delaySeconds * 1000
      );
    } else {
      await showBrowserNotification(params.title, params.body, params.data);
    }
    return;
  }
}

export async function cancelAllNotifications(): Promise<void> {}

// ─── In-App Notification Store ───────────────────────────────────────────────

export async function addNotification(
  notif: Omit<InAppNotification, "id" | "timestamp" | "isRead">
): Promise<InAppNotification> {
  const full: InAppNotification = {
    id: generateNotifId(),
    timestamp: Date.now(),
    isRead: false,
    ...notif,
  };
  await appendToArray<InAppNotification>(StorageKeys.NOTIFICATION_LIST, full, 200);
  return full;
}

export async function getNotifications(): Promise<InAppNotification[]> {
  const notifs = await getItem<InAppNotification[]>(StorageKeys.NOTIFICATION_LIST);
  return (notifs ?? []).sort((a, b) => b.timestamp - a.timestamp);
}

export async function markNotificationRead(id: string): Promise<void> {
  const all = await getNotifications();
  const updated = all.map((n) => (n.id === id ? { ...n, isRead: true } : n));
  await setItem(StorageKeys.NOTIFICATION_LIST, updated);
}

export async function markAllNotificationsRead(): Promise<void> {
  const all = await getNotifications();
  await setItem(
    StorageKeys.NOTIFICATION_LIST,
    all.map((n) => ({ ...n, isRead: true }))
  );
}

export async function clearNotifications(): Promise<void> {
  await setItem(StorageKeys.NOTIFICATION_LIST, []);
}

export async function getUnreadCount(): Promise<number> {
  const all = await getNotifications();
  return all.filter((n) => !n.isRead).length;
}

// ─── Host-Specific Notification Types ────────────────────────────────────────

export function notifyIncomingCall(userName: string, userAvatar: string) {
  scheduleLocalNotification({
    title: "Incoming Call",
    body: `${userName} wants to call you`,
    data: { type: "incoming_call" },
  });
  return addNotification({
    type: "call",
    title: "Incoming Call",
    body: `${userName} wants to call you`,
    avatar: userAvatar,
    actionUrl: "/calls/incoming",
  });
}

export function notifyNewMessage(senderName: string, message: string, chatId: string) {
  scheduleLocalNotification({
    title: senderName,
    body: message,
    data: { type: "chat_message", room_id: chatId },
  });
  return addNotification({
    type: "message",
    title: senderName,
    body: message,
    actionUrl: `/chat/${chatId}`,
  });
}

export function notifyCallEarning(userName: string, coinsEarned: number, durationSecs: number) {
  const mins = Math.floor(durationSecs / 60);
  const secs = durationSecs % 60;
  const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  scheduleLocalNotification({
    title: `+${coinsEarned} coins earned!`,
    body: `Call with ${userName} for ${durStr}`,
    data: { type: "earning" },
  });
  return addNotification({
    type: "earning",
    title: `+${coinsEarned} coins earned`,
    body: `Call with ${userName} · ${durStr}`,
    actionUrl: "/calls/history",
  });
}

export function notifyReviewReceived(userName: string, rating: number) {
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  scheduleLocalNotification({
    title: "New Review",
    body: `${userName} rated you ${stars}`,
    data: { type: "review" },
  });
  return addNotification({
    type: "review",
    title: "New Review",
    body: `${userName} rated you ${stars}`,
    actionUrl: "/(tabs)/",
  });
}

export function notifyWithdrawalStatus(amount: number, status: "approved" | "rejected") {
  const title = status === "approved" ? "Withdrawal Approved" : "Withdrawal Rejected";
  const body =
    status === "approved"
      ? `Your withdrawal of ${amount} coins has been processed.`
      : `Your withdrawal of ${amount} coins was rejected. Please contact support.`;
  scheduleLocalNotification({ title, body, data: { type: "payment" } });
  return addNotification({
    type: "payment",
    title,
    body,
    actionUrl: "/(tabs)/wallet",
  });
}

export function notifyKYCStatus(status: "approved" | "rejected") {
  const title = status === "approved" ? "KYC Verified!" : "KYC Rejected";
  const body =
    status === "approved"
      ? "Your identity has been verified. You can now go online!"
      : "Your KYC was rejected. Please re-submit your documents.";
  scheduleLocalNotification({ title, body, data: { type: "system" } });
  return addNotification({
    type: "system",
    title,
    body,
    actionUrl: "/auth/status",
  });
}
