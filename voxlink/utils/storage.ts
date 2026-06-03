// VoxLink Storage Utility
// Type-safe AsyncStorage wrapper with error handling
//
// SECURITY (#27): AsyncStorage on React Native is NOT encrypted at rest. The
// auth token, refresh token, and FCM push token live here in plaintext, which
// means a rooted/jailbroken device or a malicious app with shared storage can
// read them. The right fix is to migrate sensitive keys (AUTH_TOKEN,
// REFRESH_TOKEN, PUSH_TOKEN) to expo-secure-store, which uses the iOS Keychain
// and Android Keystore. Non-sensitive UX state (LANGUAGE, THEME, drafts,
// caches) can stay here.
//
// TODO: introduce a thin secure-store wrapper and switch the StorageKeys above
// that hold credentials over to it. Keep this file's API unchanged so callers
// don't need to know which backend stores which key.

export {
  StorageKeys,
  setItem,
  getItem,
  removeItem,
  clearAll,
  getMultiple,
  appendToArray,
  updateInArray,
} from "@workspace/shared-ui/utils";
export type { StorageKey } from "@workspace/shared-ui/utils";
