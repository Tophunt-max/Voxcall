// Global ban state — drives the blocking BanGate popup (host app).
//
// Module-level store (not React state) so api.ts + SocketService can flip it
// from anywhere. We never log the user out; the popup blocks all app usage
// until the ban is lifted or expires.

import { apiRequest } from "@/services/api";
import { secureGet, StorageKeys } from "@/utils/storage";

export interface BanInfo {
  reason?: string | null;
  expires_at?: string | null;
}

let current: BanInfo | null = null;
const listeners = new Set<(b: BanInfo | null) => void>();

export function getBanState(): BanInfo | null {
  return current;
}

export function setBanState(b: BanInfo | null): void {
  current = b;
  listeners.forEach((l) => {
    try { l(current); } catch { /* ignore */ }
  });
}

export function subscribeBanState(l: (b: BanInfo | null) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// Re-check ban status with the server. Works WHILE banned (not behind the
// ban-blocking middleware), so the popup persists across restarts and
// auto-dismisses when the ban lifts. Returns true if currently banned.
export async function checkBanStatus(): Promise<boolean> {
  // Skip the network call when there's no auth token yet (app boot, login/
  // onboarding screens). Without a token the endpoint returns 400 "Token
  // required" — noisy but benign — and an unauthenticated user can't be banned.
  const token = await secureGet(StorageKeys.AUTH_TOKEN);
  if (!token) {
    if (current) setBanState(null);
    return false;
  }
  try {
    const res = await apiRequest<{ banned: boolean; reason?: string | null; expires_at?: string | null }>(
      "POST",
      "/api/auth/account-status",
      {},
    );
    if (res?.banned) {
      setBanState({ reason: res.reason ?? null, expires_at: res.expires_at ?? null });
      return true;
    }
    setBanState(null);
    return false;
  } catch {
    return !!current;
  }
}
