// VoxLink Notification Service
// FCM-based push notifications (Firebase Cloud Messaging)
// Native: @react-native-firebase/messaging
// Web: Firebase Web Messaging + Service Worker
// In-app: AsyncStorage-backed notification list

import { Platform } from "react-native";
import { appendToArray, getItem, setItem, StorageKeys } from "@/utils/storage";
import { requestFCMPermission, getFCMToken, setupBackgroundMessageHandler } from "./fcm";

export interface InAppNotification {
  id: string;
  type: "call" | "message" | "promo" | "system" | "review" | "payment";
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

// ─── Web Browser Notification (foreground) ───────────────────────────────────

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
  // On native, FCM handles all push — local notifications via notifee (optional)
  // Background push is handled by Firebase automatically
}

export async function cancelAllNotifications(): Promise<void> {
  // Handled by FCM / OS — no local scheduler to cancel
}

// ─── In-App Notification Store ──────────────────────────────────────────────

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

// ─── Pre-built Notification Types ───────────────────────────────────────────

export function notifyIncomingCall(hostName: string, hostAvatar: string) {
  scheduleLocalNotification({
    title: "Incoming Call",
    body: `${hostName} is calling you`,
    data: { type: "incoming_call" },
  });
  return addNotification({
    type: "call",
    title: "Incoming Call",
    body: `${hostName} is calling you`,
    avatar: hostAvatar,
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
    actionUrl: `/user/chat/${chatId}`,
  });
}

export function notifyLowCoins(balance: number) {
  scheduleLocalNotification({
    title: "Low Coin Balance",
    body: `You have ${balance} coins left. Recharge to keep calling!`,
    data: { type: "system" },
  });
  return addNotification({
    type: "system",
    title: "Low Coin Balance",
    body: `You have ${balance} coins left. Recharge to keep calling!`,
    actionUrl: "/user/payment/checkout",
  });
}

export function notifyPurchaseSuccess(coins: number) {
  scheduleLocalNotification({
    title: "Purchase Successful",
    body: `${coins.toLocaleString()} coins added to your wallet!`,
    data: { type: "payment" },
  });
  return addNotification({
    type: "payment",
    title: "Purchase Successful",
    body: `${coins.toLocaleString()} coins added to your wallet!`,
    actionUrl: "/user/coin-history",
  });
}
