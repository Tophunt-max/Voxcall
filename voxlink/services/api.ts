// VoxLink API Client — connects to Cloudflare Workers backend
import { getItem, setItem } from '@/utils/storage';
import { StorageKeys } from '@/utils/storage';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://voxlink-api.ssunilkumarmohanta3.workers.dev';

export function resolveMediaUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function getToken(): Promise<string> {
  const token = await getItem<string>(StorageKeys.AUTH_TOKEN);
  return token || '';
}

// ─── JWT Auto-Refresh ─────────────────────────────────────────────────────────
// On 401: silently refresh token and retry the original request once.
// Multiple concurrent 401s are collapsed into a single refresh call.
let _refreshing: Promise<string | null> | null = null;

async function refreshAuthToken(): Promise<string | null> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      const old = await getItem<string>(StorageKeys.AUTH_TOKEN);
      if (!old) return null;
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: old }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { token: string };
      if (data.token) {
        await setItem(StorageKeys.AUTH_TOKEN, data.token);
        return data.token;
      }
      return null;
    } catch {
      return null;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

// Exported so SocketService can drive the same single-flight refresh logic
// when its WebSocket upgrade is rejected with 401. Browsers/RN don't surface
// the HTTP status on a failed WS upgrade — only `onclose` fires — so the
// SocketService heuristic (no `onopen` before `onclose`) is what triggers
// this. We intentionally reuse the in-flight Promise from api.ts so a 401
// REST call and a failed WS upgrade racing each other only issue ONE refresh
// network call.
export { refreshAuthToken };

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
  _retry = true
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Auto-refresh on 401 then retry once
  if (res.status === 401 && auth && _retry) {
    const newToken = await refreshAuthToken();
    if (newToken) return apiRequest<T>(method, path, body, auth, false);
    // Refresh bhi fail hua — token revoked ya expired hai, force logout karo
    try {
      const { removeItem } = await import('@/utils/storage');
      await removeItem(StorageKeys.AUTH_TOKEN);
      await removeItem(StorageKeys.USER);
      const { router } = await import('expo-router');
      router.replace('/user/auth/login');
    } catch {}
    // FIX: Throw after force-logout so callers know the session expired
    // Without this, execution falls through to the generic error handler
    throw new Error('SESSION_EXPIRED');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const API = {
  // Auth
  login: (email: string, password: string) =>
    apiRequest<{ token: string; user: any }>('POST', '/api/auth/login', { email, password }, false),
  register: (name: string, email: string, password: string, gender?: string, phone?: string, referral_code?: string) =>
    apiRequest<{ token: string; user: any }>('POST', '/api/auth/register', { name, email, password, gender, phone, referral_code }, false),
  guestLogin: (device_id?: string | null) =>
    apiRequest<{ token: string; user: any; is_returning?: boolean }>('POST', '/api/auth/guest-login', { device_id: device_id ?? null }, false),
  quickLogin: (device_id?: string | null) =>
    apiRequest<{ token: string; user: any; is_returning?: boolean }>('POST', '/api/auth/quick-login', { device_id: device_id ?? null }, false),
  googleLogin: (email: string, name: string, google_id: string, avatar_url?: string | null, device_id?: string | null, id_token?: string | null) =>
    apiRequest<{ token: string; user: any }>('POST', '/api/auth/google-login', { email, name, google_id, avatar_url, device_id: device_id ?? null, id_token: id_token ?? undefined }, false),
  forgotPassword: (email: string) =>
    apiRequest<{ success: boolean }>('POST', '/api/auth/forgot-password', { email }, false),
  verifyOtp: (email: string, otp: string) =>
    apiRequest<{ success: boolean; bonus_coins?: number }>('POST', '/api/auth/verify-otp', { email, otp }, false),
  resetPassword: (email: string, otp: string, new_password: string) =>
    apiRequest<{ success: boolean }>('POST', '/api/auth/reset-password', { email, otp, new_password }, false),

  // Host KYC Application
  getHostAppStatus: () => apiRequest<any>('GET', '/api/host-app/status'),
  submitHostApp: (data: any) => apiRequest<any>('POST', '/api/host-app/submit', data),
  me: () => apiRequest<any>('GET', '/api/user/me'),
  updateProfile: (data: any) => apiRequest('PATCH', '/api/user/me', data),

  // Daily streak — Layer 4 engagement reward. Caller renders a "Daily
  // Reward" card from getStreak(); when the user taps Claim, calls
  // claimDailyStreak() and credits coins. Both endpoints are idempotent
  // within an IST calendar day so a fast double-tap won't double-credit.
  getStreak: () =>
    apiRequest<{
      streak_days: number;
      last_claim_at: number;
      can_claim_now: boolean;
      next_claim_at: number;
      next_reward: number;
      next_reward_base: number;
      next_reward_milestone: number;
      schedule: number[];
      milestones: Record<string, number>;
      enabled: boolean;
      // Variable "lucky wheel" mode (Priority 4) — optional; older backends omit.
      variable_enabled?: boolean;
      variable_table?: Array<{ m: number; p: number }>;
    }>('GET', '/api/user/streak'),
  claimDailyStreak: () =>
    apiRequest<{
      success: boolean;
      claimed: boolean;
      // OK | ALREADY_CLAIMED | FEATURE_DISABLED | USER_NOT_FOUND
      code: string;
      streak_days: number;
      reward: number;
      base_reward: number;
      milestone_bonus: number;
      next_claim_at: number;
      new_balance?: number;
      // Set when the lucky-wheel determined the reward (Priority 4).
      variable?: boolean;
      multiplier?: number;
    }>('POST', '/api/user/streak/claim', {}),

  // Call quality sample ingestion — caller's app posts every ~30s during
  // an active call. NULL fields are allowed (early in the call before
  // RTCP gives us a real measurement). Best-effort — failure must never
  // break the active call.
  postCallQuality: (
    sessionId: string,
    sample: { jitter_ms?: number | null; packet_loss_pct?: number | null; rtt_ms?: number | null; codec?: string | null },
  ) =>
    apiRequest<{ ok: boolean; recorded: boolean }>('POST', `/api/calls/${sessionId}/quality`, sample),
  updateAvatar: async (formData: FormData, _retry = true): Promise<any> => {
    // Bug 6 Fix: Use shared token getter with 401 auto-refresh (same as apiRequest)
    let token = await getToken();
    const res = await fetch(`${BASE_URL}/api/upload/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (res.status === 401 && _retry) {
      const newToken = await refreshAuthToken();
      if (newToken) return API.updateAvatar(formData, false);
    }
    if (!res.ok) {
      let errorMsg = 'Avatar upload failed';
      try {
        const err = await res.json();
        errorMsg = (err as any).error || errorMsg;
      } catch (parseErr) {
        console.error('[updateAvatar] Response JSON parse failed:', parseErr);
      }
      throw new Error(errorMsg);
    }
    return res.json();
  },
  uploadFile: async (formData: FormData, _retry = true): Promise<{ url: string; key: string }> => {
    // Bug 6 Fix: Use shared token getter with 401 auto-refresh (same as apiRequest)
    let token = await getToken();
    const res = await fetch(`${BASE_URL}/api/upload/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (res.status === 401 && _retry) {
      const newToken = await refreshAuthToken();
      if (newToken) return API.uploadFile(formData, false);
    }
    if (!res.ok) {
      let errorMsg = 'Upload failed';
      try {
        const err = await res.json();
        errorMsg = (err as any).error || errorMsg;
      } catch (parseErr) {
        console.error('[uploadFile] Response JSON parse failed:', parseErr);
      }
      throw new Error(errorMsg);
    }
    return res.json();
  },

  // Hosts — OPTIMIZATION #2: cursor-based pagination response: { hosts[], nextCursor }
  getHosts: (params?: { search?: string; topic?: string; online?: boolean; cursor?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.topic) q.set('topic', params.topic);
    if (params?.online) q.set('online', '1');
    if (params?.cursor) q.set('cursor', params.cursor);
    if (params?.limit) q.set('limit', String(params.limit));
    return apiRequest<{ hosts: any[]; nextCursor: string | null }>('GET', `/api/hosts?${q}`);
  },
  // Personalized "For You" rail. Server ranks hosts per-user (favorites,
  // call history, language/specialty/gender affinity + new-host exploration);
  // see api-server lib/recommend.ts. `personalized:false` means the server fell
  // back to the standard ordering (feature disabled) — render it the same way.
  getRecommendedHosts: (limit = 20) =>
    apiRequest<{ personalized: boolean; hosts: any[] }>('GET', `/api/hosts/recommended?limit=${limit}`),
  getHost: (id: string) => apiRequest<any>('GET', `/api/hosts/${id}`),
  getHostReviews: (id: string) => apiRequest<any[]>('GET', `/api/hosts/${id}/reviews`),
  becomeHost: (data: any) => apiRequest('POST', '/api/user/become-host', data),
  updateHostProfile: (data: any) => apiRequest('PATCH', '/api/host/me', data),
  setHostOnline: (online: boolean) => apiRequest('PATCH', '/api/host/status', { is_online: online }),
  getEarnings: () => apiRequest<any>('GET', '/api/host/earnings'),

  // Coins
  getCoinPlans: () => apiRequest<any[]>('GET', '/api/coins/plans'),
  getBalance: () => apiRequest<{ coins: number }>('GET', '/api/coins/balance'),
  purchaseCoins: (plan_id: string, payment_method: string, payment_ref?: string, utr_id?: string, gateway_id?: string, promo_code?: string) =>
    apiRequest('POST', '/api/coins/purchase', { plan_id, payment_method, payment_ref, utr_id, gateway_id, promo_code }),
  getCoinHistory: () => apiRequest<any[]>('GET', '/api/coins/history'),
  requestWithdrawal: (coins_requested: number, method: string, account_info: string) =>
    apiRequest('POST', '/api/coins/withdraw', { coins_requested, method, account_info }),

  // Calls
  initiateCall: (host_id: string, call_type: 'audio' | 'video') =>
    apiRequest<any>('POST', '/api/calls/initiate', { host_id, call_type }),
  answerCall: (session_id: string, accepted: boolean) =>
    apiRequest<any>('POST', `/api/calls/${session_id}/answer`, { accepted }),
  endCall: (session_id: string, duration_seconds: number) =>
    apiRequest<any>('POST', '/api/calls/end', { session_id, duration_seconds }),
  rateCall: (session_id: string, rating: number, comment?: string) =>
    apiRequest('POST', '/api/calls/rate', { session_id, rating, comment }),
  getCallHistory: () => apiRequest<any[]>('GET', '/api/calls/history'),

  getCallSession: (sessionId: string) =>
    apiRequest<any>('GET', `/api/calls/${sessionId}`),
  // FIX (no-audio / one-way audio on mobile carriers): fetch ICE config
  // (STUN + TURN) from the backend so RTCPeerConnection has TURN relay
  // candidates available. Without TURN, peers behind symmetric NATs (most
  // mobile carrier networks) silently fail to negotiate media even when
  // signalling succeeds.
  getIceConfig: () =>
    apiRequest<{
      iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
      iceCandidatePoolSize?: number;
      bundlePolicy?: string;
      rtcpMuxPolicy?: string;
      ttl?: number;
      source?: string;
    }>('GET', '/api/calls/ice-config'),
  pushTracks: (sessionId: string, sdp: string, type: string, tracks: Array<{ mid: string; trackName: string }>) =>
    apiRequest<{ answer: { type: string; sdp: string }; tracks: any[]; role: string }>('POST', `/api/calls/${sessionId}/sdp/push`, { sdp, type, tracks }),
  pullTracks: (sessionId: string, trackNames: string[]) =>
    apiRequest<{ offer: { type: string; sdp: string } | null; tracks: Array<{ mid?: string; trackName?: string; errorCode?: string }>; role: string; retryable?: boolean }>('POST', `/api/calls/${sessionId}/sdp/pull`, { trackNames }),
  sendPullAnswer: (sessionId: string, sdp: string, type: string) =>
    apiRequest<{ success: boolean }>('POST', `/api/calls/${sessionId}/sdp/answer`, { sdp, type }),
  // Relay in-call mic/camera state to the other party so their UI updates
  // instantly (camera-off avatar / muted badge) instead of polling the remote
  // track's muted flag. Best-effort — fire and forget on each toggle.
  sendMediaState: (sessionId: string, state: { audio: boolean; video: boolean }) =>
    apiRequest<{ success: boolean }>('POST', `/api/calls/${sessionId}/media-state`, state),

  // App version gate. The mobile app calls this on launch to find out
  // whether it must show a force-update modal (running build below
  // `minSupported`) or a soft update nudge (below `latestStable`). Server
  // values come from `app_settings`; defaults are permissive ('0.0.0') so
  // an unconfigured deployment never accidentally locks anyone out.
  getAppVersion: (app: 'user' | 'host' = 'user') =>
    apiRequest<{
      app: 'user' | 'host';
      minSupported: string;
      latestStable: string;
      downloadUrl: string | null;
      blockMessage: string;
      recommendMessage: string;
    }>('GET', `/api/app/version?app=${app}`),

  // Chat
  getChatRooms: () => apiRequest<any[]>('GET', '/api/chat/rooms'),
  createChatRoom: (host_id: string) => apiRequest<any>('POST', '/api/chat/rooms', { host_id }),
  getMessages: (room_id: string, before?: number) =>
    apiRequest<any[]>('GET', `/api/chat/rooms/${room_id}/messages${before ? `?before=${before}` : ''}`),
  sendMessage: (room_id: string, content: string, media_url?: string, media_type?: string) =>
    apiRequest<{ id?: string; sender_id?: string; content?: string; created_at?: number }>('POST', `/api/chat/rooms/${room_id}/messages`, { content, media_url, media_type }),
  // Typing indicator — best-effort, server relays a chat_typing event to the
  // other room participant via NotificationHub. Caller should debounce.
  sendChatTyping: (room_id: string, is_typing: boolean) =>
    apiRequest<{ success: boolean }>('POST', `/api/chat/rooms/${room_id}/typing`, { is_typing }),
  getChatStatus: (host_id: string) =>
    apiRequest<{ unlocked: boolean; reason: string }>('GET', `/api/hosts/${host_id}/chat-status`),

  // Matchmaking
  matchFind: (
    call_type: 'audio' | 'video',
    filters?: { gender?: 'male' | 'female'; languages?: string[]; min_rating?: number },
  ) =>
    apiRequest<{
      matched: boolean;
      host?: any;
      coins_per_minute?: number;
      online_count?: number;
      filtered_count?: number;
      // Stable error code so the client can localize the user-facing
      // message rather than parsing server strings:
      //   NO_HOST_AVAILABLE, NO_MATCH_WITH_FILTERS, RATE_LIMITED,
      //   INSUFFICIENT_COINS, DAILY_LIMIT_REACHED, DECLINE_COOLDOWN
      code?: string;
      retry_after_sec?: number;
      coins?: number;
      min_needed?: number;
    }>('POST', '/api/match/find', { call_type, ...(filters ?? {}) }),
  matchOnlineHosts: () =>
    apiRequest<{ hosts: any[]; online_count: number }>('GET', '/api/match/online-hosts'),
  /**
   * Live re-check before the user hits Accept on the Match Found overlay —
   * the host may have gone offline / busy between /find and Accept. Used to
   * gate Accept and surface a "find another match" hint when stale.
   */
  matchHostStatus: (host_id: string) =>
    apiRequest<{
      available: boolean;
      is_online?: boolean;
      in_call?: boolean;
      accepts_random_calls?: boolean;
      allows_video?: boolean;
      code: string;
    }>('GET', `/api/match/host-status/${host_id}`),
  /** Records a decline so the post-decline cooldown can count it. */
  matchDecline: (host_id: string) =>
    apiRequest<{ success: boolean }>('POST', '/api/match/decline', { host_id }),

  // Promo codes
  applyPromoCode: (code: string, plan_id?: string) =>
    apiRequest<{ valid: boolean; type: string; discount: number; bonus_coins: number; discount_pct: number; code: string }>(
      // FIX: Backend requires auth for apply-promo — was sending without token
      'POST', '/api/coins/apply-promo', { code, plan_id }
    ),

  // Referral
  getReferral: () => apiRequest<{ code: string; referred: number; coins_earned: number }>('GET', '/api/user/referral'),

  // Reports
  submitReport: (data: { reported_user_id: string; reported_user?: string; reason: string; category?: string; reported_type?: string }) =>
    apiRequest<{ success: boolean; id: string }>('POST', '/api/user/report', data),

  // Banners (public)
  getBanners: (position?: 'home' | 'wallet') =>
    apiRequest<any[]>('GET', position ? `/api/banners?position=${position}` : '/api/banners', undefined, false),

  // Payment Gateways (public)
  getPaymentGateways: () =>
    apiRequest<any[]>('GET', '/api/payment-gateways', undefined, false),

  // Talk topics (public)
  getTalkTopics: () => apiRequest<any[]>('GET', '/api/talk-topics', undefined, false),

  // Notifications
  getNotifications: () => apiRequest<any[]>('GET', '/api/user/notifications'),
  markNotificationsRead: () => apiRequest('PATCH', '/api/user/notifications/read', {}),
  markOneNotificationRead: (id: string) => apiRequest('PATCH', `/api/user/notifications/${id}/read`, {}),

  // Manual Payment Gateway
  getManualQR: () =>
    apiRequest<{ qr_codes: any[]; current: any | null; rotate_interval_min: number }>('GET', '/api/payment/active-qr', undefined, false),
  submitManualDeposit: (data: { plan_id: string; utr_id: string; screenshot_url?: string; qr_code_id?: string; promo_code?: string }) =>
    apiRequest<{ success: boolean; purchase_id: string; status: string; coins_added?: number; message: string }>('POST', '/api/coins/manual-deposit', data),

  // Automatic Payment Matching
  initiatePayment: (data: { plan_id: string; gateway_id?: string; promo_code?: string }) =>
    apiRequest<{ purchase_id: string; redirect_url: string | null; amount: number; coins: number; currency: string }>('POST', '/api/payment/initiate', data),
  verifyGooglePlay: (data: { purchase_token: string; product_id: string; package_name?: string; plan_id?: string; promo_code?: string }) =>
    apiRequest<{ success: boolean; purchase_id: string; coins_added?: number; already_credited?: boolean; pending?: boolean; message?: string }>('POST', '/api/payment/verify-google-play', data),
};
