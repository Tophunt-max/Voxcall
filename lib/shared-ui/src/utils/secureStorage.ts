// ============================================================================
// Secure Storage — encrypted at-rest wrapper for sensitive credentials
// ============================================================================
//
// SECURITY FIX: Auth tokens, refresh tokens, and push tokens were previously
// stored in AsyncStorage (plaintext on disk), readable by any app with shared
// storage access on a rooted/jailbroken device. This module wraps
// expo-secure-store, which uses:
//   - iOS:     Keychain Services (AES-256-GCM, hardware-backed on devices with
//              Secure Enclave)
//   - Android: Android Keystore (AES-256, TEE/StrongBox when available)
//
// Usage: import { secureSet, secureGet, secureRemove } and use for
// StorageKeys.AUTH_TOKEN, REFRESH_TOKEN, and PUSH_TOKEN. Non-sensitive UX
// state (LANGUAGE, THEME, drafts, caches) should remain in AsyncStorage
// (faster, larger capacity, survives backup/restore).
//
// Graceful degradation: if expo-secure-store is not available (e.g. web,
// Expo Go on older SDKs), falls back to AsyncStorage with a console warning
// so the app never crashes on a missing native module.
// ============================================================================

let SecureStore: typeof import('expo-secure-store') | null = null;

try {
  // Dynamic require so the module resolves at runtime — avoids a hard crash
  // on platforms where the native module isn't linked (web, Expo Go < SDK 49).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SecureStore = require('expo-secure-store');
} catch {
  // expo-secure-store not available — will fall back to AsyncStorage below.
}

import AsyncStorage from '@react-native-async-storage/async-storage';

const SECURE_PREFIX = '@voxlink:secure:';

/**
 * Store a sensitive value in the platform's encrypted keychain/keystore.
 * Falls back to AsyncStorage if SecureStore is unavailable.
 */
export async function secureSet(key: string, value: string): Promise<void> {
  try {
    if (SecureStore?.setItemAsync) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
  } catch (err) {
    console.warn('[SecureStorage] setItemAsync failed, falling back to AsyncStorage:', err);
  }
  // Fallback: AsyncStorage (unencrypted but better than crashing)
  await AsyncStorage.setItem(`${SECURE_PREFIX}${key}`, value);
}

/**
 * Retrieve a sensitive value from the platform's encrypted keychain/keystore.
 * Falls back to AsyncStorage if SecureStore is unavailable.
 */
export async function secureGet(key: string): Promise<string | null> {
  try {
    if (SecureStore?.getItemAsync) {
      const val = await SecureStore.getItemAsync(key);
      if (val !== null) return val;
      // Migration: check if the value still lives in the old AsyncStorage
      // location (from before this secure wrapper was introduced). If found,
      // migrate it to SecureStore and delete the old entry.
      const legacy = await AsyncStorage.getItem(`@voxlink:${key}`);
      if (legacy !== null) {
        const parsed = JSON.parse(legacy);
        const str = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
        await SecureStore.setItemAsync(key, str);
        await AsyncStorage.removeItem(`@voxlink:${key}`);
        return str;
      }
      return null;
    }
  } catch (err) {
    console.warn('[SecureStorage] getItemAsync failed, falling back to AsyncStorage:', err);
  }
  // Fallback
  const raw = await AsyncStorage.getItem(`${SECURE_PREFIX}${key}`);
  if (raw !== null) return raw;
  // Try legacy location
  const legacy = await AsyncStorage.getItem(`@voxlink:${key}`);
  if (legacy !== null) {
    try {
      const parsed = JSON.parse(legacy);
      return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    } catch {
      return legacy;
    }
  }
  return null;
}

/**
 * Remove a sensitive value from the platform's encrypted keychain/keystore.
 * Also clears legacy AsyncStorage entries for the same key.
 */
export async function secureRemove(key: string): Promise<void> {
  try {
    if (SecureStore?.deleteItemAsync) {
      await SecureStore.deleteItemAsync(key);
    }
  } catch (err) {
    console.warn('[SecureStorage] deleteItemAsync failed:', err);
  }
  // Always clean both locations to handle migration residue
  await AsyncStorage.removeItem(`${SECURE_PREFIX}${key}`).catch(() => {});
  await AsyncStorage.removeItem(`@voxlink:${key}`).catch(() => {});
}

/** Keys that MUST use secure storage (credentials / tokens). */
export const SECURE_KEYS = ['auth_token', 'refresh_token', 'push_token'] as const;

/** Returns true if this key should use secure storage instead of AsyncStorage. */
export function isSecureKey(key: string): boolean {
  return (SECURE_KEYS as readonly string[]).includes(key);
}
