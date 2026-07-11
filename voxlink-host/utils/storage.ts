// VoxLink Host Storage Utility — re-exports shared storage helpers.
// SECURITY FIX: sensitive keys (AUTH_TOKEN, REFRESH_TOKEN, PUSH_TOKEN) now
// have a SecureStore-backed alternative via secureSet/secureGet/secureRemove.
// See lib/shared-ui/src/utils/secureStorage.ts for details.

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
