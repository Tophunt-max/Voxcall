// Use VITE_API_URL env var for direct connection to production API,
// or fall back to Vite proxy (localhost:8080) for local dev
const API = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

export function getToken() { return localStorage.getItem('voxlink_admin_token') || ''; }

function handleSessionExpired() {
  localStorage.removeItem('voxlink_admin_token');
  localStorage.removeItem('voxlink_admin_user');
  if (!window.location.pathname.endsWith('/login')) {
    window.location.href = import.meta.env.BASE_URL || '/admin-panel/';
  }
}

// ─── Token Auto-Refresh ──────────────────────────────────────────────────────
// On 401: silently refresh the token via /api/auth/refresh and retry once.
// Multiple concurrent 401s are collapsed into a single refresh call.
let _refreshing: Promise<boolean> | null = null;

// Build request headers. The Authorization header is only attached when a
// legacy localStorage Bearer token exists; the primary auth path is now the
// httpOnly admin session cookie (sent automatically via credentials:'include').
export function authHeaders(hasBody: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (hasBody) h['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// Refresh the admin session. Two flows are supported:
//   • Cookie flow (primary): POST /api/admin-auth/refresh with credentials —
//     the server re-issues the httpOnly cookie. Returns true on success.
//   • Legacy Bearer flow: POST /api/auth/refresh with the localStorage token —
//     stores the new token so authHeaders() attaches it. Returns true.
// Concurrent 401s are collapsed into a single in-flight refresh.
async function refreshAdminToken(): Promise<boolean> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      // Cookie session refresh (primary). credentials:'include' sends the
      // httpOnly admin_session cookie; the server rotates it in the response.
      const cookieRes = await fetch(`${API}/admin-auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (cookieRes.ok) return true;

      // Legacy Bearer refresh (migration bridge) — only if a token exists.
      const oldToken = localStorage.getItem('voxlink_admin_token');
      if (!oldToken) return false;
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: oldToken }),
      });
      if (!res.ok) return false;
      const data = await res.json() as { token?: string };
      if (data.token) {
        localStorage.setItem('voxlink_admin_token', data.token);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

export async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const doFetch = () =>
    fetch(`${API}${path}`, {
      method,
      // credentials:'include' sends the httpOnly admin session cookie — the
      // primary auth mechanism. authHeaders() adds a Bearer token only if a
      // legacy localStorage token is still present.
      credentials: 'include',
      headers: authHeaders(!!body),
      body: body ? JSON.stringify(body) : undefined,
    });

  const r = await doFetch();
  // FIX #3: On 401, try refreshing the session and retry once before giving up.
  // Previously, a 401 immediately killed the session, losing any unsaved admin work.
  if (r.status === 401 && !path.includes('/auth/')) {
    const refreshed = await refreshAdminToken();
    if (refreshed) {
      const retry = await doFetch();
      if (retry.status === 401) {
        handleSessionExpired();
        throw new Error('Session expired. Please log in again.');
      }
      if (!retry.ok) {
        const err = await retry.json().catch(() => ({ error: retry.statusText }));
        throw new Error((err as any).error || retry.statusText);
      }
      return retry.json();
    }
    handleSessionExpired();
    throw new Error('Session expired. Please log in again.');
  }
  if (!r.ok) {
    const err = await r.json().catch(() => null);
    const message = (err as any)?.error || r.statusText || `Request failed (${r.status})`;
    throw new Error(message);
  }
  return r.json();
}

export const api = {
  login: (email: string, password: string) => req<{ token: string; user: any }>('POST', '/auth/login', { email, password, role: 'admin' }),
  dashboard: () => req<any>('GET', '/admin/dashboard'),
  // ── New production-grade dashboard endpoints ─────────────────────────
  // Bundled financial + pending + live + recent + leaderboards +
  // call-type split + admin actions + anomalies. Called every 20 s from
  // the redesigned Dashboard.
  dashboardSummary: () => req<any>('GET', '/admin/dashboard/summary'),
  // SLA & data-integrity signals — API errors, FX freshness, coin
  // reconciliation, migration state, reward-budget fill, security counters.
  monitoringHealth: () => req<any>('GET', '/admin/monitoring/health'),
  // Full health monitor page data — live probes + uptime + latency + incidents
  healthFull: () => req<any>('GET', '/admin/health/full'),
  // Kill-switch state for the emergency-switches card on the dashboard.
  emergencyFlags: () =>
    req<{ payouts_frozen: boolean; registrations_paused: boolean; new_calls_paused: boolean }>(
      'GET',
      '/admin/emergency-flags',
    ),
  setEmergencyFlag: (flag: 'payouts_frozen' | 'registrations_paused' | 'new_calls_paused', on: boolean) =>
    req<{ success: boolean; flag: string; on: boolean }>('PATCH', '/admin/emergency-flags', { flag, on }),
  users: (p?: string, s?: string) => req<any[]>('GET', `/admin/users?page=${p||1}&limit=21${s ? '&search='+encodeURIComponent(s) : ''}`),
  updateUser: (id: string, data: any) => req('PATCH', `/admin/users/${id}`, data),
  hosts: (page = 1, limit = 50) => req<any[]>('GET', `/admin/hosts?page=${page}&limit=${limit}`),
  updateHost: (id: string, data: any) => req('PATCH', `/admin/hosts/${id}`, data),
  withdrawals: () => req<any[]>('GET', '/admin/withdrawals'),
  updateWithdrawal: (id: string, data: any) => req('PATCH', `/admin/withdrawals/${id}`, data),
  coinPlans: () => req<any[]>('GET', '/admin/coin-plans'),
  createCoinPlan: (data: any) => req<any>('POST', '/admin/coin-plans', data),
  updateCoinPlan: (id: string, data: any) => req('PATCH', `/admin/coin-plans/${id}`, data),
  deleteCoinPlan: (id: string) => req('DELETE', `/admin/coin-plans/${id}`),
  // VIP plans (perks fully admin-managed)
  vipPlans: () => req<any[]>('GET', '/admin/vip-plans'),
  createVipPlan: (data: any) => req<any>('POST', '/admin/vip-plans', data),
  updateVipPlan: (id: string, data: any) => req('PATCH', `/admin/vip-plans/${id}`, data),
  deleteVipPlan: (id: string) => req('DELETE', `/admin/vip-plans/${id}`),
  vipSubscribers: () => req<any[]>('GET', '/admin/vip-subscribers'),
  // Chat gifts catalog
  gifts: () => req<any[]>('GET', '/admin/gifts'),
  createGift: (data: any) => req<any>('POST', '/admin/gifts', data),
  updateGift: (id: string, data: any) => req('PATCH', `/admin/gifts/${id}`, data),
  deleteGift: (id: string) => req('DELETE', `/admin/gifts/${id}`),
  settings: () => req<Record<string, string>>('GET', '/admin/settings'),
  updateSettings: (data: any) => req('PATCH', '/admin/settings', data),
  callSessions: () => req<any[]>('GET', '/admin/calls'),
  faqs: () => req<any[]>('GET', '/admin/faqs'),
  createFaq: (data: any) => req<any>('POST', '/admin/faqs', data),
  updateFaq: (id: string, data: any) => req('PATCH', `/admin/faqs/${id}`, data),
  deleteFaq: (id: string) => req('DELETE', `/admin/faqs/${id}`),
  talkTopics: () => req<any[]>('GET', '/admin/talk-topics'),
  createTalkTopic: (data: any) => req<any>('POST', '/admin/talk-topics', data),
  updateTalkTopic: (id: string, data: any) => req('PATCH', `/admin/talk-topics/${id}`, data),
  deleteTalkTopic: (id: string) => req('DELETE', `/admin/talk-topics/${id}`),
  coinTransactions: (page = 1, limit = 50) => req<any[]>('GET', `/admin/coin-transactions?page=${page}&limit=${limit}`),
  ratings: (page = 1, limit = 50) => req<any[]>('GET', `/admin/ratings?page=${page}&limit=${limit}`),
  analytics: (days?: number) => req<any>('GET', `/admin/analytics${days ? `?days=${days}` : ''}`),
  // Agora-aware P&L + volume-discount / monthly-usage tracking.
  marginAnalytics: (days?: number) => req<any>('GET', `/admin/analytics/margins${days ? `?days=${days}` : ''}`),
  // Notification analytics — sent / opened / CTR per notification type.
  notificationAnalytics: (days?: number) => req<{
    days: number; total_sent: number; total_opened: number; overall_ctr: number;
    by_type: { type: string; sent: number; opened: number; ctr: number }[];
  }>('GET', `/admin/notification-analytics${days ? `?days=${days}` : ''}`),
  streakAnalytics: () => req<any>('GET', '/admin/streak-analytics'),
  coinReconciliation: () => req<any>('GET', '/admin/coin-reconciliation'),
  notifications: () => req<any[]>('GET', '/admin/notifications'),
  sendNotification: (data: any) => req<any>('POST', '/admin/notifications/send', data),
  post: (path: string, data: any) => req<any>('POST', path.replace('/api/admin/', '/admin/').replace('/api/', '/'), data),
  promoCodes: () => req<any[]>('GET', '/admin/promo-codes'),
  createPromoCode: (data: any) => req<any>('POST', '/admin/promo-codes', data),
  updatePromoCode: (id: string, data: any) => req('PATCH', `/admin/promo-codes/${id}`, data),
  deletePromoCode: (id: string) => req('DELETE', `/admin/promo-codes/${id}`),
  payouts: () => req<any[]>('GET', '/admin/payouts'),
  deposits: () => req<any[]>('GET', '/admin/deposits'),
  updateDeposit: (id: string, data: any) => req('PATCH', `/admin/deposits/${id}`, data),
  supportTickets: () => req<any[]>('GET', '/admin/support-tickets'),
  updateSupportTicket: (id: string, data: any) => req('PATCH', `/admin/support-tickets/${id}`, data),
  replySupportTicket: (id: string, data: any) => req('POST', `/admin/support-tickets/${id}/reply`, data),
  contentReports: () => req<any[]>('GET', '/admin/content-reports'),
  updateContentReport: (id: string, data: any) => req('PATCH', `/admin/content-reports/${id}`, data),
  // Single lightweight call that returns all actionable-queue pending counts.
  // Polled by the sidebar badges / ring alerts instead of hitting 5 endpoints.
  pendingCounts: () => req<{
    withdrawals: number;
    deposits: number;
    support_tickets: number;
    kyc_applications: number;
    content_reports: number;
    total: number;
  }>('GET', '/admin/pending-counts'),
  bannedUsers: (page = 1, limit = 50) => req<any[]>('GET', `/admin/bans?page=${page}&limit=${limit}`),
  banUser: (data: any) => req<any>('POST', '/admin/bans', data),
  unbanUser: (id: string) => req('DELETE', `/admin/bans/${id}`),

  // ─── Fraud / Abuse Risk Scoring (api-server lib/riskScore.ts) ─────────────
  // Read-only. DEFAULT OFF: when risk_scoring_enabled=0 both return
  // { enabled:false } so the page shows a "disabled" hint instead of data.
  riskFlagged: (minTier: 'medium' | 'high' = 'medium', limit = 100) =>
    req<{
      enabled: boolean;
      assessed?: number;
      min_tier?: string;
      flagged: Array<{ user_id: string; name: string | null; email: string | null; score: number; tier: 'low' | 'medium' | 'high'; reasons: string[] }>;
    }>('GET', `/admin/risk/flagged?min_tier=${minTier}&limit=${limit}`),
  riskUser: (id: string) =>
    req<{
      user_id: string;
      enabled: boolean;
      score: number;
      tier: 'low' | 'medium' | 'high';
      breakdown: Record<string, number>;
      reasons: string[];
    }>('GET', `/admin/risk/user/${id}`),
  auditLogs: (page = 1, limit = 50) => req<any[]>('GET', `/admin/audit-logs?page=${page}&limit=${limit}`),
  banners: () => req<any[]>('GET', '/admin/banners'),
  createBanner: (data: any) => req<any>('POST', '/admin/banners', data),
  updateBanner: (id: string, data: any) => req('PATCH', `/admin/banners/${id}`, data),
  deleteBanner: (id: string) => req('DELETE', `/admin/banners/${id}`),
  // Reward tasks: the catalog powering the user Rewards page.
  rewardTasks: () => req<any[]>('GET', '/admin/reward-tasks'),
  createRewardTask: (data: any) => req<any>('POST', '/admin/reward-tasks', data),
  updateRewardTask: (id: string, data: any) => req('PATCH', `/admin/reward-tasks/${id}`, data),
  deleteRewardTask: (id: string) => req('DELETE', `/admin/reward-tasks/${id}`),

  // Lucky Spin config
  rewardSpin: () => req<{ config: any; stats: any; distribution: any[] }>('GET', '/admin/reward-spin'),
  updateRewardSpin: (data: any) => req('PATCH', '/admin/reward-spin', data),

  // Campaigns
  rewardCampaigns: () => req<any[]>('GET', '/admin/reward-campaigns'),
  createRewardCampaign: (data: any) => req<any>('POST', '/admin/reward-campaigns', data),
  updateRewardCampaign: (id: string, data: any) => req('PATCH', `/admin/reward-campaigns/${id}`, data),
  deleteRewardCampaign: (id: string) => req('DELETE', `/admin/reward-campaigns/${id}`),

  // Coupons
  rewardCoupons: () => req<any[]>('GET', '/admin/reward-coupons'),
  createRewardCoupon: (data: any) => req<any>('POST', '/admin/reward-coupons', data),
  updateRewardCoupon: (id: string, data: any) => req('PATCH', `/admin/reward-coupons/${id}`, data),
  deleteRewardCoupon: (id: string) => req('DELETE', `/admin/reward-coupons/${id}`),

  // Achievements
  rewardAchievements: () => req<any[]>('GET', '/admin/reward-achievements'),
  createRewardAchievement: (data: any) => req<any>('POST', '/admin/reward-achievements', data),
  updateRewardAchievement: (id: string, data: any) => req('PATCH', `/admin/reward-achievements/${id}`, data),
  deleteRewardAchievement: (id: string) => req('DELETE', `/admin/reward-achievements/${id}`),

  // Analytics
  rewardAnalytics: () => req<any>('GET', '/admin/reward-analytics'),
  referrals: () => req<any>('GET', '/admin/referrals'),
  referralConfig: () => req<any>('GET', '/admin/referral-config'),
  updateReferralConfig: (data: any) => req('PUT', '/admin/referral-config', data),
  // Referral integrity review queue (flagged: velocity cap / high risk).
  referralQueue: (status = 'review') => req<any[]>('GET', `/admin/referral-queue?status=${encodeURIComponent(status)}`),
  referralQueueStats: () => req<any>('GET', '/admin/referral-queue/stats'),
  actOnReferral: (id: string, data: { action: 'approve' | 'reject'; reason?: string }) =>
    req('PATCH', `/admin/referral-queue/${id}`, data),
  liveCalls: () => req<any[]>('GET', '/admin/calls/live'),
  // Mints an Agora token so the admin can silently listen in on an active call
  // (audio-only, never publishes). channel = call session id.
  getCallAgoraToken: (id: string) => req<{
    provider: 'agora';
    app_id: string;
    channel: string;
    uid: number;
    token: string;
    call_type: 'audio' | 'video';
  }>('GET', `/admin/calls/${id}/agora-token`),
  forceEndCall: (id: string) => req<any>('POST', `/admin/calls/${id}/force-end`, {}),
  cleanupStaleCalls: (maxHours?: number) => req<any>('POST', '/admin/calls/stale-cleanup', { max_hours: maxHours ?? 4 }),
  appConfig: () => req<any>('GET', '/admin/app-config'),
  updateAppConfig: (data: any) => req('PUT', '/admin/app-config', data),
  recalculateHostLevels: () => req<any>('POST', '/admin/hosts/recalculate-levels', {}),
  getLevelConfig: () => req<any[]>('GET', '/admin/level-config'),
  updateLevelConfig: (data: any[]) => req<any>('PUT', '/admin/level-config', data),

  // ─── India coin economy seed ─────────────────────────────────────────────
  // Destructive: wipes coin_plans + replaces level_config + upserts the
  // canonical app_settings (coin_value_inr=0.05, min_withdrawal=1000,
  // host_revenue_share=0.70, rates 25/40). The backend requires both ?confirm=true AND
  // the X-Confirm-Seed header — bare `req()` doesn't pass custom headers,
  // so we call fetch directly with the same auth/error handling.
  seedIndiaDefaults: async (): Promise<{
    success: boolean;
    plans_seeded: number;
    level_count: number;
    settings_updated: string[];
  }> => {
    const r = await fetch(`${API}/admin/seed/india-defaults?confirm=true`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...authHeaders(true),
        // Backend cross-checks this header against a fixed magic string
        // before applying the (destructive) seed. Without the header the
        // endpoint 400s — protects against accidental URL-share clicks.
        'X-Confirm-Seed': 'india-coin-economy',
      },
      body: '{}',
    });
    if (r.status === 401) {
      handleSessionExpired();
      throw new Error('Session expired. Please log in again.');
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error((err as any).error || r.statusText);
    }
    return r.json();
  },
  paymentGateways: () => req<any[]>('GET', '/admin/payment-gateways'),
  createPaymentGateway: (data: any) => req<any>('POST', '/admin/payment-gateways', data),
  updatePaymentGateway: (id: string, data: any) => req('PATCH', `/admin/payment-gateways/${id}`, data),
  deletePaymentGateway: (id: string) => req('DELETE', `/admin/payment-gateways/${id}`),
  manualQRCodes: () => req<any[]>('GET', '/admin/manual-qr-codes'),
  createManualQRCode: (data: any) => req<any>('POST', '/admin/manual-qr-codes', data),
  updateManualQRCode: (id: string, data: any) => req('PATCH', `/admin/manual-qr-codes/${id}`, data),
  deleteManualQRCode: (id: string) => req('DELETE', `/admin/manual-qr-codes/${id}`),

  // Upload QR image directly to R2 (returns URL to use in createManualQRCode)
  uploadQRImage: async (file: File): Promise<{ url: string; key: string; filename: string; size: number }> => {
    const formData = new FormData();
    formData.append('file', file);
    const baseUrl = import.meta.env.VITE_API_URL
      ? `${import.meta.env.VITE_API_URL}/api`
      : `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;
    // FormData sets its own Content-Type boundary — only attach a Bearer token
    // if a legacy one exists; the httpOnly cookie rides credentials:'include'.
    const post = () =>
      fetch(`${baseUrl}/upload/admin-qr`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(false),
        body: formData,
      });
    let r = await post();
    if (r.status === 401) {
      const refreshed = await refreshAdminToken();
      if (!refreshed) { handleSessionExpired(); throw new Error('Session expired'); }
      r = await post();
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error((err as any).error || r.statusText);
    }
    return r.json();
  },
  // Upload a promotional banner image directly to R2 (returns URL for banners.image_url)
  uploadBannerImage: async (file: File): Promise<{ url: string; key: string; filename: string; size: number }> => {
    const formData = new FormData();
    formData.append('file', file);
    const baseUrl = import.meta.env.VITE_API_URL
      ? `${import.meta.env.VITE_API_URL}/api`
      : `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;
    const post = () =>
      fetch(`${baseUrl}/upload/admin-banner`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(false),
        body: formData,
      });
    let r = await post();
    if (r.status === 401) {
      const refreshed = await refreshAdminToken();
      if (!refreshed) { handleSessionExpired(); throw new Error('Session expired'); }
      r = await post();
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error((err as any).error || r.statusText);
    }
    return r.json();
  },
  runMigrations: () => req<any>('POST', '/admin/run-migrations', {}),

  // ─── Optimized (INR) coin economy seed ───────────────────────────────────
  // One-click production setup: applies ₹0.05/coin, 70% host share,
  // 8 INR plans (₹49→₹4999), INR call rates, and broadcasts a real-time
  // settings update to every connected app. Goes through req() so it uses the
  // correct API base URL (VITE_API_URL) and auth token (voxlink_admin_token).
  seedCoinEconomy: () => req<{
    success: boolean;
    details?: {
      coin_value?: { inr: number; usd: number; display: string };
      host_revenue_share?: number;
      min_withdrawal_coins?: number;
      plans?: Array<{ name: string; price: number; coins: number; bonus: number }>;
    };
    settings_updated?: string[];
    error?: string;
    message?: string;
  }>('POST', '/admin/seed-coin-economy', {}),
};
