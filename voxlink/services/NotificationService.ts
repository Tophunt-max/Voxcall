// VoxLink Notification Service
// Local push notifications + in-app notification management

import { Platform } from "react-native";
import { appendToArray, getItem, setItem, StorageKeys } from "@/utils/storage";
import Constants from "expo-constants";

let Notifications: any = null;
try { Notifications = require("expo-notifications"); } catch {}

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

// ─── Web Browser Notification helpers ───────────────────────────────────────

function isWebNotificationSupported(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && "Notification" in window;
}

async function showBrowserNotification(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  if (!isWebNotificationSupported()) return;
  try {
    if ((window as any).Notification.permission === "granted") {
      const n = new (window as any).Notification(title, {
        body,
        icon: "/favicon.ico",
        data,
      });
      setTimeout(() => n.close(), 6000);
    }
  } catch {}
}

// ─── Push Notification Setup ────────────────────────────────────────────────

export async function configurePushNotifications(): Promise<void> {
  // Web: request browser notification permission
  if (Platform.OS === "web") {
    try {
      if (isWebNotificationSupported() && (window as any).Notification.permission === "default") {
        await (window as any).Notification.requestPermission();
      }
    } catch {}
    return;
  }
  if (!Notifications) return;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#A00EE7",
        sound: "default",
      });
      await Notifications.setNotificationChannelAsync("calls", {
        name: "Incoming Calls",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: "#A00EE7",
        sound: "default",
        enableLights: true,
        enableVibrate: true,
      });
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (err) {
    console.warn("[Notifications] configure error:", err);
  }
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Notifications || Platform.OS === "web") return null;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      "0e529a27-fcf1-4850-a306-971ef07dd2ac";
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await setItem(StorageKeys.PUSH_TOKEN, data);
    return data;
  } catch (err) {
    console.warn("[Notifications] register error:", err);
    return null;
  }
}

export async function scheduleLocalNotification(params: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  delaySeconds?: number;
}): Promise<void> {
  if (Platform.OS === "web") {
    if (params.delaySeconds) {
      setTimeout(() => showBrowserNotification(params.title, params.body, params.data), params.delaySeconds * 1000);
    } else {
      await showBrowserNotification(params.title, params.body, params.data);
    }
    return;
  }
  if (!Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        data: params.data ?? {},
        sound: true,
      },
      trigger: params.delaySeconds
        ? { seconds: params.delaySeconds }
        : null,
    });
  } catch (err) {
    console.warn("[Notifications] schedule error:", err);
  }
}

export async function cancelAllNotifications(): Promise<void> {
  if (!Notifications || Platform.OS === "web") return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
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
    actionUrl: `/shared/chat/${chatId}`,
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
    actionUrl: "/shared/coin-history",
  });
}
