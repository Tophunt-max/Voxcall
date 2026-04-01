// VoxLink Notification Service
// Local push notifications + in-app notification management

import { Platform } from "react-native";
import { appendToArray, getItem, setItem, StorageKeys } from "@/utils/storage";

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

// ─── Push Notification Setup ────────────────────────────────────────────────

export async function configurePushNotifications(): Promise<void> {
  if (!Notifications || Platform.OS === "web") return;
  try {
    await Notifications.setNotificationChannelAsync?.("default", {
      name: "Default",
      importance: Notifications.AndroidImportance?.HIGH ?? 4,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#A00EE7",
    });

    Notifications.setNotificationHandler?.({
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
    const { data } = await Notifications.getExpoPushTokenAsync();
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
  if (!Notifications || Platform.OS === "web") return;
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
  await appendToArray<InAppNotification>(StorageKeys.NOTIFICATION_SETTINGS, full, 200);
  return full;
}

export async function getNotifications(): Promise<InAppNotification[]> {
  const notifs = await getItem<InAppNotification[]>(StorageKeys.NOTIFICATION_SETTINGS);
  return (notifs ?? []).sort((a, b) => b.timestamp - a.timestamp);
}

export async function markNotificationRead(id: string): Promise<void> {
  const all = await getNotifications();
  const updated = all.map((n) => (n.id === id ? { ...n, isRead: true } : n));
  await setItem(StorageKeys.NOTIFICATION_SETTINGS, updated);
}

export async function markAllNotificationsRead(): Promise<void> {
  const all = await getNotifications();
  await setItem(
    StorageKeys.NOTIFICATION_SETTINGS,
    all.map((n) => ({ ...n, isRead: true }))
  );
}

export async function clearNotifications(): Promise<void> {
  await setItem(StorageKeys.NOTIFICATION_SETTINGS, []);
}

export async function getUnreadCount(): Promise<number> {
  const all = await getNotifications();
  return all.filter((n) => !n.isRead).length;
}

// ─── Pre-built Notification Types ───────────────────────────────────────────

export function notifyIncomingCall(hostName: string, hostAvatar: string) {
  return addNotification({
    type: "call",
    title: "Incoming Call",
    body: `${hostName} is calling you`,
    avatar: hostAvatar,
  });
}

export function notifyNewMessage(senderName: string, message: string, chatId: string) {
  return addNotification({
    type: "message",
    title: senderName,
    body: message,
    actionUrl: `/shared/chat/${chatId}`,
  });
}

export function notifyLowCoins(balance: number) {
  return addNotification({
    type: "system",
    title: "Low Coin Balance",
    body: `You have ${balance} coins left. Recharge to keep calling!`,
    actionUrl: "/user/payment/checkout",
  });
}

export function notifyPurchaseSuccess(coins: number) {
  return addNotification({
    type: "payment",
    title: "Purchase Successful",
    body: `${coins.toLocaleString()} coins added to your wallet!`,
    actionUrl: "/shared/coin-history",
  });
}
