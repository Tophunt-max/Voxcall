// VoxLink API Client — connects to Cloudflare Workers backend
import { StorageKeys } from '@/utils/storage';
import { secureGet, secureSet, secureRemove } from '@/utils/storage';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://voxlink-api.ssunilkumarmohanta3.workers.dev';

export function resolveMediaUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function getToken(): Promise<string> {
  const token = await secureGet(StorageKeys.AUTH_TOKEN);
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
      const old = await secureGet(StorageKeys.AUTH_TOKEN);
      if (!old) return null;
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: old }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { token: string };
      if (data.token) {
        await secureSet(StorageKeys.AUTH_TOKEN, data.token);
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
  _retry = true,
  // Some endpoints return a STRUCTURED JSON body (with a stable `code`) on an
  // HTTP error status — e.g. POST /api/match/find replies 402/429 with
  // { matched:false, code:'DAILY_LIMIT_REACHED' | 'RATE_LIMITED' | ... }.
  // Callers that pass the relevant statuses here receive that parsed body
  // instead of a thrown Error, so they can act on the code rather than
  // mistaking an expected limit for a network failure. Default keeps the
  // original throw-on-any-error behaviour for every other caller.
  returnBodyForStatuses?: number[],
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
    if (newToken) return apiRequest<T>(method, path, body, auth, false, returnBodyForStatuses);
    // Refresh bhi fail hua — token revoked ya expired hai, force logout karo
    try {
      const { removeItem } = await import('@/utils/storage');
      await secureRemove(StorageKeys.AUTH_TOKEN);
      await removeItem(StorageKeys.USER);
      const { router } = await import('expo-router');
      router.replace('/user/auth/login');
    } catch {}
    // FIX: Throw after force-logout so callers know the session expired
    // Without this, execution falls through to the generic error handler
    throw new Error('SESSION_EXPIRED');
  }

  if (!res.ok) {
    // Expected, code-bearing error response → hand the body back to the caller.
    if (returnBodyForStatuses?.includes(res.status)) {
      return res.json() as Promise<T>;
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // Account banned/suspended → show the blocking ban popup (NOT a logout).
    // The server returns 403 with a stable `code` + reason/expiry.
    if (res.status === 403 && (err as any)?.code === 'account_banned') {
      try {
        const { setBanState } = await import('@/services/banState');
        setBanState({ reason: (err as any).reason ?? null, expires_at: (err as any).expires_at ?? null });
      } catch {}
      throw new Error('ACCOUNT_BANNED');
    }
    throw new Error((err as any).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const API = {
  // Auth — user app supports ONLY Quick login (device-based guest) and Google
  // sign-in. Email/password + OTP/reset flows were never given UI and are
  // handled by the host/admin apps, so their client methods are intentionally
  // not exposed here.

  // FIX #1: Mid-call heartbeat — server-side balance cap enforcement.
  // Client calls this every 20–30s during an active call. Server force-ends
  // the call when balance is exhausted, preventing overrun abuse.
  heartbeat: (session_id: string) =>
    apiRequest<{
      ok: boolean;
      ended: boolean;
      remaining_seconds?: number;
      max_seconds?: number;
      low_balance?: boolean;
      reason?: string;
      coins_charged?: number;
      duration_seconds?: number;
    }>('POST', `/api/calls/${session_id}/heartbeat`, {}),
  quickLogin: (device_id?: string | null, referral_code?: string | null) =>
    apiRequest<{ token: string; user: any; is_returning?: boolean }>('POST', '/api/auth/quick-login', { device_id: device_id ?? null, referral_code: referral_code ?? null }, false),
  googleLogin: (email: string, name: string, google_id: string, avatar_url?: string | null, device_id?: string | null, id_token?: string | null, referral_code?: string | null) =>
    apiRequest<{ token: string; user: any }>('POST', '/api/auth/google-login', { email, name, google_id, avatar_url, device_id: device_id ?? null, id_token: id_token ?? undefined, referral_code: referral_code ?? null }, false),

  me: () => apiRequest<any>('GET', '/api/user/me'),
  updateProfile: (data: any) => apiRequest('PATCH', '/api/user/me', data),
  // Recurring daily free-minutes reward (admin-configured, all users).
  claimDailyFreeMinutes: () =>
    apiRequest<{ success: boolean; granted: number; free_call_minutes: number; next_at: number }>('POST', '/api/user/claim-daily-free-minutes'),

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
      // Engagement v2 — all optional so older backends degrade gracefully.
      seconds_until_reset?: number;
      at_risk?: boolean;
      streak_max?: number;
      freeze_enabled?: boolean;
      freezes_available?: number;
      can_repair?: boolean;
      repair_cost_coins?: number;
      chest_enabled?: boolean;
      chest_threshold?: number;
      chest_reward?: number;
      claims_this_month?: number;
      chest_claimed_this_month?: boolean;
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
      // Engagement v2 reward breakdown — optional.
      minutes_reward?: number;
      comeback_bonus?: number;
      chest_bonus?: number;
      claims_this_month?: number;
    }>('POST', '/api/user/streak/claim', {}),
  // Restore a streak after missing exactly one IST day. Spends a free freeze
  // token if available, otherwise charges coins. INSUFFICIENT_FUNDS → 402.
  repairStreak: () =>
    apiRequest<{
      success: boolean;
      repaired: boolean;
      // OK | FEATURE_DISABLED | USER_NOT_FOUND | NOTHING_TO_REPAIR | INSUFFICIENT_FUNDS
      code: string;
      method?: 'freeze' | 'coins';
      freezes_remaining?: number;
      coins_spent?: number;
      new_balance?: number;
      streak_days?: number;
      message?: string;
    }>('POST', '/api/user/streak/repair', {}),

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
    const token = await getToken();
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
    const token = await getToken();
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
  // Public host gallery (highlight photos / videos). Rows: { id, media_url,
  // media_type: 'image'|'video', caption, sort_order }.
  getHostGallery: (id: string) => apiRequest<any[]>('GET', `/api/hosts/${id}/gallery`),

  // Favorited hosts for the "Your favorites" home rail. Rows expose host_id
  // (the hosts.id) + display fields; the caller maps host_id -> id.
  // Server returns them online-first and hides banned/deleted hosts.
  getFavorites: (limit = 100) =>
    apiRequest<any[]>('GET', `/api/user/favorites?limit=${limit}`),
  // Lightweight: just the favorited host_ids — mark hearts across lists/grids
  // without downloading full host objects.
  getFavoriteIds: () => apiRequest<{ ids: string[] }>('GET', '/api/user/favorites/ids'),
  // Single-host favorite status — cheap check for the host profile heart.
  isFavorite: (hostId: string) =>
    apiRequest<{ favorite: boolean }>('GET', `/api/user/favorites/status/${hostId}`),
  // Add / remove a host from the user's favorites (hostId = hosts.id).
  // Responses carry the resulting favorite state + total count.
  addFavorite: (hostId: string) =>
    apiRequest<{ success: boolean; added?: boolean; favorite?: boolean; count?: number }>(
      'POST', `/api/user/favorites/${hostId}`
    ),
  removeFavorite: (hostId: string) =>
    apiRequest<{ success: boolean; removed?: boolean; favorite?: boolean; count?: number }>(
      'DELETE', `/api/user/favorites/${hostId}`
    ),

  // ─── User Blocking ──────────────────────────────────────────────────────────
  // Block/unblock users. Blocked users cannot call or message the blocker.
  getBlockedUsers: () => apiRequest<any[]>('GET', '/api/user/blocks'),
  blockUser: (userId: string, reason?: string) =>
    apiRequest<{ success: boolean; blocked_user?: any; already_blocked?: boolean }>(
      'POST', `/api/user/blocks/${userId}`, { reason }
    ),
  unblockUser: (userId: string) =>
    apiRequest<{ success: boolean }>('DELETE', `/api/user/blocks/${userId}`),
  isUserBlocked: (userId: string) =>
    apiRequest<{ blocked: boolean }>('GET', `/api/user/blocks/check/${userId}`),

  // ─── Notification Preferences ───────────────────────────────────────────────
  getNotificationPreferences: () =>
    apiRequest<{ preferences: Record<string, boolean>; categories: string[] }>('GET', '/api/user/notification-preferences'),
  updateNotificationPreferences: (prefs: Record<string, boolean>) =>
    apiRequest<{ success: boolean }>('PATCH', '/api/user/notification-preferences', prefs),

  // ─── Tipping / Gifting ──────────────────────────────────────────────────────
  sendTip: (host_id: string, amount: number, message?: string, call_session_id?: string) =>
    apiRequest<{ success: boolean; tip_id: string; amount: number; new_balance: number }>(
      'POST', '/api/tips/send', { host_id, amount, message, call_session_id }
    ),
  getTipsSent: () => apiRequest<any[]>('GET', '/api/tips/sent'),
  getTipsReceived: () => apiRequest<any[]>('GET', '/api/tips/received'),

  // Engagement event ingest — batched impression/click/conversion logging that
  // powers rail CTR / conversion metrics + data-driven ranking. Best-effort;
  // see services/engagement.ts for the client-side batching queue.
  logEngagementEvents: (events: unknown[]) =>
    apiRequest<{ ok: boolean; stored: number }>('POST', '/api/engagement/events', { events }),

  // Coins
  getCoinPlans: () => apiRequest<any[]>('GET', '/api/coins/plans'),
  getBalance: () => apiRequest<{ coins: number }>('GET', '/api/coins/balance'),
  // Personalized smart-discount offer for the current user (segment-aware).
  // Drives the checkout offer banner; the same bonus is granted server-side
  // on payment so the promise == the payout.
  getCoinOffer: () => apiRequest<{
    enabled: boolean;
    segment: 'welcome' | 'first_recharge' | 'winback' | 'vip' | 'returning' | 'none';
    label: string;
    description: string;
    bonus_pct: number;
    expires_at: number | null;
    expires_in_sec: number;
  }>('GET', '/api/coins/offer'),
  // Smart "best pack for you" recommendation based on the user's burn-rate.
  getCoinRecommendation: () => apiRequest<{
    enabled: boolean;
    recommended_plan_id: string | null;
    burn_rate_per_day: number;
    days_left: number | null;
    lasts_days: number | null;
    urgency: 'critical' | 'low' | 'normal';
    reason: string;
  }>('GET', '/api/coins/recommendation'),
  purchaseCoins: (plan_id: string, payment_method: string, payment_ref?: string, utr_id?: string, gateway_id?: string, promo_code?: string) =>
    apiRequest('POST', '/api/coins/purchase', { plan_id, payment_method, payment_ref, utr_id, gateway_id, promo_code }),
  getCoinHistory: () => apiRequest<any[]>('GET', '/api/coins/history'),

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
  // Agora RTC join token — the client joins the call channel with this.
  // channel = call session id, uid = 0 (Agora auto-assigns; token valid for
  // any uid). Fails with 500 if the backend has no Agora credentials set.
  getAgoraToken: (sessionId: string) =>
    apiRequest<{
      provider: 'agora';
      app_id: string;
      channel: string;
      uid: number;
      token: string;
      role: 'caller' | 'host';
      call_type: 'audio' | 'video';
      // Smart call-quality routing: recommended STARTING video tier for this
      // user based on their recent network history. Client uses it as the
      // initial encoder tier, then adapts live. Absent/older backends → 'high'.
      recommended_quality?: 'high' | 'medium' | 'low';
    }>('GET', `/api/calls/${sessionId}/agora-token`),
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
  // Chat gifts — coin-priced gifts sent inside a chat (credited to the host).
  getGifts: () => apiRequest<any[]>('GET', '/api/gifts', undefined, false),
  sendGift: (room_id: string, gift_id: string, idempotency_key?: string) =>
    apiRequest<{ success: boolean; duplicate?: boolean; message_id: string; room_id: string; gift: { id: string; name: string; icon: string; amount: number }; created_at: number; new_balance: number }>(
      'POST', '/api/gifts/send', { room_id, gift_id, idempotency_key }
    ),
  // Send a gift DURING a call — resolves/creates the chat room server-side from
  // host_id (an active call is the unlock) and relays a call_gift animation to
  // the host's call screen. idempotency_key makes a network retry safe (no
  // double-charge).
  sendCallGift: (host_id: string, gift_id: string, session_id?: string, idempotency_key?: string) =>
    apiRequest<{ success: boolean; duplicate?: boolean; message_id: string; room_id: string; gift: { id: string; name: string; icon: string; amount: number }; created_at: number; new_balance: number }>(
      'POST', '/api/gifts/send', { host_id, gift_id, session_id, idempotency_key }
    ),
  // Typing indicator — best-effort, server relays a chat_typing event to the
  // other room participant via NotificationHub. Caller should debounce.
  sendChatTyping: (room_id: string, is_typing: boolean) =>
    apiRequest<{ success: boolean }>('POST', `/api/chat/rooms/${room_id}/typing`, { is_typing }),
  // Mark all of the other party's messages in this room as read. Clears the
  // unread badge and sends a read receipt so the sender sees "Seen".
  markChatRead: (room_id: string) =>
    apiRequest<{ success: boolean; marked: number }>('POST', `/api/chat/rooms/${room_id}/read`),
  // Report an abusive message into the admin moderation queue.
  reportMessage: (room_id: string, message_id: string, reason?: string, category?: string) =>
    apiRequest<{ success: boolean }>('POST', `/api/chat/rooms/${room_id}/messages/${message_id}/report`, { reason, category }),
  // Edit your own text message (15-min window; relays a live edit event).
  editMessage: (room_id: string, message_id: string, content: string) =>
    apiRequest<{ success: boolean; edited_at?: number }>('PATCH', `/api/chat/rooms/${room_id}/messages/${message_id}`, { content }),
  // Soft-delete your own message for everyone (relays a live delete event).
  deleteMessage: (room_id: string, message_id: string) =>
    apiRequest<{ success: boolean }>('DELETE', `/api/chat/rooms/${room_id}/messages/${message_id}`),

  // ─── VIP subscription ─────────────────────────────────────────────────────
  getVipPlans: () =>
    apiRequest<any[]>('GET', '/api/vip/plans'),
  getVipStatus: () =>
    apiRequest<any>('GET', '/api/vip/status'),
  subscribeVip: (plan_id: string) =>
    apiRequest<{ success: boolean; tier: string; plan_name: string; expires_at: number; days_left: number; coins: number }>(
      'POST', '/api/vip/subscribe', { plan_id }
    ),
  claimVipDaily: () =>
    apiRequest<{ success: boolean; granted: number; free_minutes: number; coins: number; next_daily_at: number }>('POST', '/api/vip/claim-daily'),

  // ─── Support tickets (VIP priority_support applies server-side) ────────────
  createSupportTicket: (subject: string, message: string, category = 'general') =>
    apiRequest<{ success: boolean; id: string; priority: string; status: string }>('POST', '/api/support/tickets', { subject, message, category }),
  getSupportTickets: () =>
    apiRequest<any[]>('GET', '/api/support/tickets'),
  replySupportTicket: (id: string, text: string) =>
    apiRequest<{ success: boolean; messages: any[] }>('POST', `/api/support/tickets/${id}/reply`, { text }),
  getChatStatus: (host_id: string) =>
    apiRequest<{ unlocked: boolean; reason: string }>('GET', `/api/hosts/${host_id}/chat-status`),

  // Matchmaking
  matchFind: (
    call_type: 'audio' | 'video',
    filters?: { gender?: 'male' | 'female'; languages?: string[]; min_rating?: number; exclude_host_id?: string },
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
      // Limit metadata spread by the server (...abuse.meta): daily cap usage
      // for DAILY_LIMIT_REACHED, cooldown config for DECLINE_COOLDOWN.
      used?: number;
      daily_limit?: number;
      cooldown_min?: number;
      threshold?: number;
      // The server returns these limit/abuse states as HTTP 402 (insufficient
      // coins) / 429 (rate, daily cap, decline cooldown) with a code-bearing
      // body. We opt to receive that body instead of a thrown error so the UI
      // can show the real reason and stop searching immediately, rather than
      // spinning on a misleading "network error".
    }>('POST', '/api/match/find', { call_type, ...(filters ?? {}) }, true, true, [402, 429]),
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

  // ─── Smart engines (see api-server routes/smart.ts) ───────────────────────
  // All three honour a DEFAULT-OFF server flag: when the engine is disabled the
  // response is a neutral shape (`enabled:false`) so the client can call them
  // unconditionally and simply keep its existing behaviour.

  /**
   * Personalized home-rail ORDER for the current user (from their tap history).
   * `order` is a permutation of rail ids: favorites|recommended|online|
   * interest|new|top. Disabled → { enabled:false } (client keeps static order).
   */
  getRailOrder: () =>
    apiRequest<{ enabled: boolean; order?: string[] }>('GET', '/api/smart/rail-order'),

  /**
   * Data-driven "usually online" hint for one host (a probability from the
   * host's historical activity — NOT a live-presence claim). Disabled →
   * { enabled:false }. `label` is a ready-to-render string ('' when low data).
   */
  getHostAvailability: (hostId: string) =>
    apiRequest<{
      enabled: boolean;
      likelihood_now: number;
      usually_online: boolean;
      peak_hours: number[];
      next_active_hour: number | null;
      sample_count: number;
      label: string;
    }>('GET', `/api/smart/availability/${hostId}`),

  /**
   * "Talk Now" brain: best host to connect to right now for THIS user, or an
   * honest wait ETA + queue position when none are online. Disabled →
   * { enabled:false } (caller falls back to the normal random-match flow).
   */
  requestInstantConnect: (call_type: 'audio' | 'video' = 'audio') =>
    apiRequest<{
      enabled: boolean;
      call_type?: 'audio' | 'video';
      matched?: boolean;
      host_id?: string | null;
      wait_seconds?: number;
      queue_position?: number;
      reason?: string;
    }>('POST', '/api/smart/instant-connect', { call_type }),

  // Promo codes
  applyPromoCode: (code: string, plan_id?: string) =>
    apiRequest<{ valid: boolean; type: string; discount: number; bonus_coins: number; discount_pct: number; code: string }>(
      // FIX: Backend requires auth for apply-promo — was sending without token
      'POST', '/api/coins/apply-promo', { code, plan_id }
    ),

  // Referral — includes the admin-managed reward config so the screen shows
  // the actual reward amounts instead of hardcoded copy.
  getReferral: () => apiRequest<{
    code: string;
    referred: number;
    coins_earned: number;
    config?: { referrer_reward: number; new_user_reward: number; min_calls_to_unlock: number; active: boolean };
  }>('GET', '/api/user/referral'),

  getReferralLeaderboard: () => apiRequest<{
    leaderboard: { rank: number; name: string; avatar: string | null; referrals: number; coins: number; is_me: boolean }[];
    me: { referrals: number; coins: number; rank: number | null };
  }>('GET', '/api/user/referral-leaderboard'),

  // Reports
  submitReport: (data: { reported_user_id: string; reported_user?: string; reason: string; category?: string; reported_type?: string }) =>
    apiRequest<{ success: boolean; id: string }>('POST', '/api/user/report', data),

  // Banners (public) — always request the 'user' audience so the user app only
  // ever gets user-facing banners (never host-app campaigns).
  getBanners: (position?: 'home' | 'wallet' | 'search') =>
    apiRequest<any[]>('GET', `/api/banners?audience=user${position ? `&position=${position}` : ''}`, undefined, false),

  // ── Rewards Hub ───────────────────────────────────────────────────────
  // Reward tasks that let the user earn coins by completing in-app actions.
  // Task state is per-user; call getRewards() to refresh after any claim.
  getRewards: () =>
    apiRequest<{
      tasks: Array<{
        id: string;
        code: string;
        title: string;
        description: string;
        icon: string;
        category: string;
        task_type: string;
        target_count: number;
        current_count: number;
        coins_reward: number;
        cooldown_hours: number;
        cta_link: string;
        claim_count: number;
        last_claimed_at: number | null;
        total_earned: number;
        cooldown_remaining_sec: number;
        claimable: boolean;
        already_claimed: boolean;
        // Audience targeting: 'all' | 'vip' | 'free'.
        audience: string;
        // True when a VIP-only task is shown to a non-VIP user (locked upsell).
        vip_locked: boolean;
      }>;
      total_earned: number;
      claimable_count: number;
      campaigns: Array<{
        id: string;
        code: string;
        title: string;
        description: string;
        banner_image_url: string;
        starts_at: number;
        ends_at: number;
        multiplier: number;
        applies_to_task_types: string[];
        applies_to_spin: boolean;
        ends_in_sec: number;
      }>;
      spin: null | {
        enabled: boolean;
        free_spins_remaining: number;
        earned_spins_remaining: number;
        total_spins: number;
        total_coins_won: number;
        segments: Array<{ label: string; coins: number; weight: number; color: string; emoji: string }>;
      };
      achievements: Array<{
        id: string;
        code: string;
        title: string;
        description: string;
        icon: string;
        tier: string;
        trigger_type: string;
        trigger_threshold: number;
        coins_reward: number;
        duration_days: number;
        current_progress: number;
        progress_pct: number;
        started_at: number | null;
        expires_at: number | null;
        seconds_remaining: number | null;
        window_expired: boolean;
        unlocked: boolean;
        unlocked_at: number | null;
        // Server-computed urgency flag — true when the quest has <= 24h
        // remaining. Client should render a red "Expires in Xh" badge.
        expiring_soon: boolean;
        // Admin ordering — surfaced so callers can override the server's
        // urgency-first sort if they need a stable position.
        sort_order: number;
      }>;
      server_time: number;
      // Unix ts of the next UTC midnight — daily tasks reset then.
      daily_reset: number;
      // Unix ts of the UTC month end — monthly tasks reset then.
      month_end: number;
    }>('GET', '/api/user/rewards'),

  claimReward: (task_id: string) =>
    apiRequest<{
      ok: true;
      task_id: string;
      task_code: string;
      coins_awarded: number;
      base_reward: number;
      multiplier: number;
      campaign_code: string | null;
      new_balance: number;
      next_cooldown_sec: number;
      // Daily coin budget cap (0 = unlimited). Returned by every payout
      // endpoint so the client can render a "daily budget almost full"
      // hint when the cap approaches — helps avoid frustrating 429s.
      budget_cap: number;
    }>('POST', '/api/user/rewards/claim', { task_id }),

  trackReward: (event: 'watch_ad' | 'share_app') =>
    apiRequest<{ ok: true; tasks_updated: number }>(
      'POST',
      '/api/user/rewards/track',
      { event },
    ),

  // Lucky Spin — POSTs a spin action. The backend picks a weighted-random
  // segment server-side (never trust the client) and credits coins atomically.
  spinReward: () =>
    apiRequest<{
      ok: true;
      segment_index: number;
      segment_label: string;
      base_coins: number;
      coins_won: number;
      multiplier: number;
      campaign_code: string | null;
      used_free: boolean;
      free_spins_remaining: number;
      earned_spins_remaining: number;
      new_balance: number;
      budget_cap: number;
    }>('POST', '/api/user/rewards/spin'),

  // Coupon codes — redeem a code (normalised to uppercase server-side).
  redeemCoupon: (code: string) =>
    apiRequest<{
      ok: true;
      code: string;
      coins_awarded: number;
      new_balance: number;
      budget_cap: number;
    }>('POST', '/api/user/rewards/redeem-coupon', { code }),

  // ── Monthly Pass ──────────────────────────────────────────────────────
  // Chamet-style monthly battle pass. Pass Points are earned by claiming
  // reward tasks; crossing a tier threshold unlocks a Common (free) and a
  // Premium (VIP/paid) reward. Everything resets at the UTC month boundary.
  getPass: () =>
    apiRequest<{
      enabled: boolean;
      title?: string;
      description?: string;
      price_coins?: number;
      vip_auto_unlock?: boolean;
      is_vip?: boolean;
      premium_unlocked?: boolean;
      premium_via_vip?: boolean;
      purchased?: boolean;
      points?: number;
      max_points?: number;
      period_key?: string;
      month_end: number;
      server_time: number;
      coins?: number;
      tiers?: Array<{
        level: number;
        points: number;
        label: string;
        reached: boolean;
        free_coins: number;
        free_claimed: boolean;
        free_claimable: boolean;
        premium_coins: number;
        premium_claimed: boolean;
        premium_claimable: boolean;
      }>;
    }>('GET', '/api/user/pass'),

  // Unlock the Premium track for the current month by spending coins. VIP
  // members are auto-unlocked and never charged.
  purchasePass: () =>
    apiRequest<{
      success: boolean;
      premium_unlocked: boolean;
      already_unlocked?: boolean;
      via?: 'vip' | 'coins';
      price_coins?: number;
      coins?: number;
    }>('POST', '/api/user/pass/purchase'),

  // Claim a tier reward on the 'common' or 'premium' track.
  claimPass: (tier_level: number, track: 'common' | 'premium') =>
    apiRequest<{
      success: boolean;
      tier_level: number;
      track: 'common' | 'premium';
      coins_awarded: number;
      coins: number;
    }>('POST', '/api/user/pass/claim', { tier_level, track }),

  // Payment Gateways (public)
  getPaymentGateways: () =>
    apiRequest<any[]>('GET', '/api/payment-gateways', undefined, false),

  // Talk topics (public)
  getTalkTopics: () => apiRequest<any[]>('GET', '/api/talk-topics', undefined, false),

  // Public app config (economy values + operator settings: maintenance gate,
  // support_email, legal links). Single source of truth from app_settings so
  // the client never hardcodes values that can drift from the backend / admin.
  getAppConfig: () =>
    apiRequest<Record<string, string>>('GET', '/api/app-config', undefined, false),

  // Admin-managed FAQs (public) — rendered in the Help Center. Falls back to a
  // bundled list in the screen if this is empty / errors.
  getFaqs: () => apiRequest<any[]>('GET', '/api/faqs', undefined, false),

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
