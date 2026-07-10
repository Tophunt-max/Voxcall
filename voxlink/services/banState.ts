// Global ban state — drives the blocking BanGate popup.
//
// Kept as a module-level store (NOT React state) so non-React code
// (api.ts error interceptor, SocketService) can flip it from anywhere. The
// BanGate component subscribes and renders a non-dismissable full-screen popup
// while `current` is set. We intentionally do NOT log the user out — the popup
// simply blocks all app usage until the ban is lifted or expires.

import { apiRequest } from "@/services/api";

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

// Re-check ban status with the server. This endpoint keeps working WHILE the
// user is banned (it is not behind the ban-blocking middleware), so it lets the
// popup persist across app restarts and auto-dismiss the moment the ban lifts.
// Returns true if currently banned.
export async function checkBanStatus(): Promise<boolean> {
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
    // Network/token error — keep whatever state we already have.
    return !!current;
  }
}
