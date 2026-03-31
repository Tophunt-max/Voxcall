// VoxLink Storage Utility
// Type-safe AsyncStorage wrapper with error handling

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "@voxlink:";

function key(k: string) {
  return `${PREFIX}${k}`;
}

export const StorageKeys = {
  USER: "user",
  AUTH_TOKEN: "auth_token",
  REFRESH_TOKEN: "refresh_token",
  LANGUAGE: "language",
  THEME: "theme",
  ONBOARDING_DONE: "onboarding_done",
  PUSH_TOKEN: "push_token",
  CALL_HISTORY: "call_history",
  COIN_HISTORY: "coin_history",
  CHAT_DRAFTS: "chat_drafts",
  NOTIFICATION_SETTINGS: "notification_settings",
  HOST_AVAILABILITY: "host_availability",
  PAYOUT_METHOD: "payout_method",
  RECENT_SEARCHES: "recent_searches",
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

export async function setItem<T>(k: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key(k), JSON.stringify(value));
  } catch (err) {
    console.warn("[Storage] setItem error:", err);
  }
}

export async function getItem<T>(k: string, fallback?: T): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key(k));
    if (raw === null) return fallback ?? null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn("[Storage] getItem error:", err);
    return fallback ?? null;
  }
}

export async function removeItem(k: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(k));
  } catch (err) {
    console.warn("[Storage] removeItem error:", err);
  }
}

export async function clearAll(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const voxlinkKeys = allKeys.filter((k) => k.startsWith(PREFIX));
    await AsyncStorage.multiRemove(voxlinkKeys);
  } catch (err) {
    console.warn("[Storage] clearAll error:", err);
  }
}

export async function getMultiple<T extends Record<string, unknown>>(
  keys: string[]
): Promise<Partial<T>> {
  try {
    const pairs = await AsyncStorage.multiGet(keys.map(key));
    const result: Partial<T> = {};
    for (const [k, v] of pairs) {
      const cleanKey = k.replace(PREFIX, "") as keyof T;
      result[cleanKey] = v ? (JSON.parse(v) as T[keyof T]) : undefined;
    }
    return result;
  } catch (err) {
    console.warn("[Storage] getMultiple error:", err);
    return {};
  }
}

export async function appendToArray<T>(k: string, item: T, maxLength = 100): Promise<void> {
  try {
    const existing = await getItem<T[]>(k, []);
    const arr = existing ?? [];
    arr.unshift(item);
    await setItem(k, arr.slice(0, maxLength));
  } catch (err) {
    console.warn("[Storage] appendToArray error:", err);
  }
}

export async function updateInArray<T extends { id: string }>(
  k: string,
  id: string,
  updates: Partial<T>
): Promise<void> {
  try {
    const arr = await getItem<T[]>(k, []) ?? [];
    const idx = arr.findIndex((x) => x.id === id);
    if (idx !== -1) {
      arr[idx] = { ...arr[idx], ...updates };
      await setItem(k, arr);
    }
  } catch (err) {
    console.warn("[Storage] updateInArray error:", err);
  }
}
