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
    // Refresh bhi fail hua — token revoked ya expired, force logout karo
    try {
      const { removeItem } = await import('@/utils/storage');
      await removeItem(StorageKeys.AUTH_TOKEN);
      await removeItem(StorageKeys.USER);
      const { router } = await import('expo-router');
      router.replace('/auth/login');
    } catch {}
    throw new Error('SESSION_EXPIRED');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Host level system types ───────────────────────────────────────────────
export interface HostLevelPerks {
  /** Legacy combined cap (= max of audio/video). Kept for back-compat. */
  max_rate: number;
  /** Admin-set max coins/min for AUDIO calls at this level. */
  max_audio_rate: number;
  /** Admin-set max coins/min for VIDEO calls at this level. */
  max_video_rate: number;
  earning_share: number;
  rank_boost: number;
}

export interface HostLevelDef {
  level: number;
  name: string;
  badge: string;
  color: string;
  min_calls: number;
  min_rating: number;
  coin_reward: number;
  description: string;
  perks: HostLevelPerks;
}

export interface HostLevelResponse {
  level: number;
  current: HostLevelDef;
  next: HostLevelDef | null;
  is_max_level: boolean;
  progress_pct: number;
  requirements: {
    calls: { current: number; required: number; pct: number; met: boolean };
    rating: { current: number; required: number; pct: number; met: boolean };
  };
  perks: HostLevelPerks;
  levels: HostLevelDef[];
  stats: {
    total_calls: number;
    total_minutes: number;
    total_earnings: number;
    rating: number;
    review_count: number;
  };
}

export const API = {
  // Auth
  login: (email: string, password: string) =>
    apiRequest<{ token: string; user: any }>('POST', '/api/auth/login', { email, password }, false),
  register: (name: string, email: string, password: string, gender?: string, phone?: string, referral_code?: string) =>
    apiRequest<{ token: string; user: any; signup_incomplete?: boolean }>('POST', '/api/auth/register', { name, email, password, gender, phone, referral_code }, false),
  guestLogin: (device_id?: string | null) =>
    apiRequest<{ token: string; user: any; is_returning?: boolean }>('POST', '/api/auth/guest-login', { device_id: device_id ?? null }, false),
  quickLogin: (device_id?: string | null) =>
    apiRequest<{ token: string; user: any; is_returning?: boolean }>('POST', '/api/auth/quick-login', { device_id: device_id ?? null }, false),
  // FIX: Added device_id param (was missing — causes Google/QuickLogin account merge to fail)
  googleLogin: (email: string, name: string, google_id: string, avatar_url?: string | null, device_id?: string | null, id_token?: string | null) =>
    apiRequest<{ token: string; user: any }>('POST', '/api/auth/google-login', { email, name, google_id, avatar_url, device_id: device_id ?? null, id_token: id_token ?? undefined }, false),
  forgotPassword: (email: string) =>
    apiRequest<{ success: boolean }>('POST', '/api/auth/forgot-password', { email }, false),
  resetPassword: (email: string, otp: string, new_password: string) =>
    apiRequest<{ success: boolean }>('POST', '/api/auth/reset-password', { email, otp, new_password }, false),
  // FIX: Added missing verifyOtp method (host app had no way to verify email)
  verifyOtp: (email: string, otp: string) =>
    apiRequest<{ success: boolean; bonus_coins?: number }>('POST', '/api/auth/verify-otp', { email, otp }, false),

  // Host KYC Application
  getHostAppStatus: () => apiRequest<any>('GET', '/api/host-app/status'),
  submitHostApp: (data: any) => apiRequest<any>('POST', '/api/host-app/submit', data),
  me: () => apiRequest<any>('GET', '/api/user/me'),
  updateProfile: (data: any) => apiRequest('PATCH', '/api/user/me', data),
  updateAvatar: async (formData: FormData, _retry = true): Promise<any> => {
    // Bug 6 Fix (host): 401 auto-refresh for file uploads
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
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || 'Avatar upload failed');
    }
    return res.json();
  },
  uploadFile: async (formData: FormData, _retry = true): Promise<{ url: string; key: string }> => {
    // Bug 6 Fix (host): 401 auto-refresh for file uploads
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
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || 'Upload failed');
    }
    return res.json();
  },

  // Hosts
  getHosts: (params?: { search?: string; topic?: string; online?: boolean; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.topic) q.set('topic', params.topic);
    if (params?.online) q.set('online', '1');
    if (params?.page) q.set('page', String(params.page));
    return apiRequest<any[]>('GET', `/api/hosts?${q}`);
  },
  getHost: (id: string) => apiRequest<any>('GET', `/api/hosts/${id}`),
  getHostReviews: (id: string) => apiRequest<any[]>('GET', `/api/hosts/${id}/reviews`),
  becomeHost: (data: any) => apiRequest('POST', '/api/user/become-host', data),
  updateHostProfile: (data: any) => apiRequest('PATCH', '/api/host/me', data),
  // FIX: getHostMe was missing — the new payout-method screen needs to fetch
  // the current host record (including payout_method/payout_details) on mount
  // so the form pre-fills with whatever the host saved last time.
  getHostMe: () => apiRequest<any>('GET', '/api/host/me'),
  setHostOnline: (online: boolean) => apiRequest('PATCH', '/api/host/status', { is_online: online }),
  getEarnings: () => apiRequest<any>('GET', '/api/host/earnings'),
  // Host level + progress towards the next level (drives the dashboard Level card).
  // Returns the configurable ladder, current/next level info, progress %, and
  // per-requirement breakdown (calls + rating) plus aggregate stats.
  getHostLevel: () => apiRequest<HostLevelResponse>('GET', '/api/host/level'),

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
  getPendingCall: () => apiRequest<{ id: string; caller_id: string; call_type: string; caller_name: string; caller_avatar?: string; rate_per_minute?: number; max_seconds?: number } | null>('GET', '/api/calls/pending-for-host'),
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

  // App version gate. Host app calls this on launch to determine whether to
  // show a force-update blocker or a soft nudge. Server reads from
  // `app_settings`; defaults are permissive so an unconfigured deployment
  // never accidentally locks anyone out.
  getAppVersion: (app: 'user' | 'host' = 'host') =>
    apiRequest<{
      app: 'user' | 'host';
      minSupported: string;
      latestStable: string;
      downloadUrl: string | null;
      blockMessage: string;
      recommendMessage: string;
    }>('GET', `/api/app/version?app=${app}`),

  // Public app config (coin rate, min withdrawal, etc.) — single source of
  // truth from the server's app_settings, so the client never hardcodes
  // economy values that can drift from the backend.
  getAppConfig: () =>
    apiRequest<Record<string, string>>('GET', '/api/app-config', undefined, false),

  // Chat
  getChatRooms: () => apiRequest<any[]>('GET', '/api/chat/rooms'),
  createChatRoom: (host_id: string) => apiRequest<any>('POST', '/api/chat/rooms', { host_id }),
  getMessages: (room_id: string, before?: number) =>
    apiRequest<any[]>('GET', `/api/chat/rooms/${room_id}/messages${before ? `?before=${before}` : ''}`),
  sendMessage: (room_id: string, content: string, media_url?: string, media_type?: string) =>
    apiRequest<{ id?: string; sender_id?: string; content?: string; created_at?: number }>('POST', `/api/chat/rooms/${room_id}/messages`, { content, media_url, media_type }),
  getChatStatus: (host_id: string) =>
    apiRequest<{ unlocked: boolean; reason: string }>('GET', `/api/hosts/${host_id}/chat-status`),

  // Matchmaking
  matchFind: (call_type: 'audio' | 'video') =>
    apiRequest<{ matched: boolean; host?: any; message?: string }>('POST', '/api/match/find', { call_type }),
  matchOnlineHosts: () =>
    apiRequest<any[]>('GET', '/api/match/online-hosts'),

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
};
