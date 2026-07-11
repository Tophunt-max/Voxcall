// VoxLink Storage Utility
// Type-safe AsyncStorage wrapper with error handling
//
// SECURITY FIX (#27): Auth tokens are now stored in expo-secure-store (encrypted
// at rest via iOS Keychain / Android Keystore). The secureSet/secureGet/secureRemove
// helpers handle AUTH_TOKEN, REFRESH_TOKEN, and PUSH_TOKEN. Non-sensitive UX
// state (LANGUAGE, THEME, drafts, caches) stays in AsyncStorage for performance.
//
// See lib/shared-ui/src/utils/secureStorage.ts for the implementation and
// graceful fallback to AsyncStorage on platforms without SecureStore support.

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
export { secureSet, secureGet, secureRemove, isSecureKey, SECURE_KEYS } from "@workspace/shared-ui/utils";
