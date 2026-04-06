// VoxLink API Client — connects to Cloudflare Workers backend
import { getItem, setItem } from '@/utils/storage';
import { StorageKeys } from '@/utils/storage';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080';

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
  googleLogin: (email: string, name: string, google_id: string, avatar_url?: string | null, device_id?: string | null) =>
    apiRequest<{ token: string; user: any }>('POST', '/api/auth/google-login', { email, name, google_id, avatar_url, device_id: device_id ?? null }, false),
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
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || 'Avatar upload failed');
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
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || 'Upload failed');
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

  pushTracks: (sessionId: string, sdp: string, type: string, tracks: Array<{ mid: string; trackName: string }>) =>
    apiRequest<{ answer: { type: string; sdp: string }; tracks: any[]; role: string }>('POST', `/api/calls/${sessionId}/sdp/push`, { sdp, type, tracks }),
  pullTracks: (sessionId: string, trackNames: string[]) =>
    apiRequest<{ offer: { type: string; sdp: string } | null; tracks: Array<{ mid?: string; trackName?: string; errorCode?: string }>; role: string; retryable?: boolean }>('POST', `/api/calls/${sessionId}/sdp/pull`, { trackNames }),
  sendPullAnswer: (sessionId: string, sdp: string, type: string) =>
    apiRequest<{ success: boolean }>('POST', `/api/calls/${sessionId}/sdp/answer`, { sdp, type }),

  // Chat
  getChatRooms: () => apiRequest<any[]>('GET', '/api/chat/rooms'),
  createChatRoom: (host_id: string) => apiRequest<any>('POST', '/api/chat/rooms', { host_id }),
  getMessages: (room_id: string, before?: number) =>
    apiRequest<any[]>('GET', `/api/chat/rooms/${room_id}/messages${before ? `?before=${before}` : ''}`),
  sendMessage: (room_id: string, content: string, media_url?: string, media_type?: string) =>
    apiRequest('POST', `/api/chat/rooms/${room_id}/messages`, { content, media_url, media_type }),
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
      'POST', '/api/coins/apply-promo', { code, plan_id }, false
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
