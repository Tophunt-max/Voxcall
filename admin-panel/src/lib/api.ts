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
let _refreshing: Promise<string | null> | null = null;

async function refreshAdminToken(): Promise<string | null> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      const oldToken = localStorage.getItem('voxlink_admin_token');
      if (!oldToken) return null;
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: oldToken }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { token?: string };
      if (data.token) {
        localStorage.setItem('voxlink_admin_token', data.token);
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

export async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  if (!token && !path.includes('/auth/')) {
    handleSessionExpired();
    throw new Error('Session expired. Please log in again.');
  }
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  // FIX #3: On 401, try refreshing the token and retry once before giving up.
  // Previously, a 401 immediately killed the session, losing any unsaved admin work.
  if (r.status === 401 && !path.includes('/auth/')) {
    const newToken = await refreshAdminToken();
    if (newToken) {
      // Retry the original request with the new token
      const retry = await fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newToken}` },
        body: body ? JSON.stringify(body) : undefined,
      });
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
  bannedUsers: (page = 1, limit = 50) => req<any[]>('GET', `/admin/bans?page=${page}&limit=${limit}`),
  banUser: (data: any) => req<any>('POST', '/admin/bans', data),
  unbanUser: (id: string) => req('DELETE', `/admin/bans/${id}`),
  auditLogs: (page = 1, limit = 50) => req<any[]>('GET', `/admin/audit-logs?page=${page}&limit=${limit}`),
  banners: () => req<any[]>('GET', '/admin/banners'),
  createBanner: (data: any) => req<any>('POST', '/admin/banners', data),
  updateBanner: (id: string, data: any) => req('PATCH', `/admin/banners/${id}`, data),
  deleteBanner: (id: string) => req('DELETE', `/admin/banners/${id}`),
  referrals: () => req<any>('GET', '/admin/referrals'),
  referralConfig: () => req<any>('GET', '/admin/referral-config'),
  updateReferralConfig: (data: any) => req('PUT', '/admin/referral-config', data),
  liveCalls: () => req<any[]>('GET', '/admin/calls/live'),
  forceEndCall: (id: string) => req<any>('POST', `/admin/calls/${id}/force-end`, {}),
  cleanupStaleCalls: (maxHours?: number) => req<any>('POST', '/admin/calls/stale-cleanup', { max_hours: maxHours ?? 4 }),
  appConfig: () => req<any>('GET', '/admin/app-config'),
  updateAppConfig: (data: any) => req('PUT', '/admin/app-config', data),
  recalculateHostLevels: () => req<any>('POST', '/admin/hosts/recalculate-levels', {}),
  getLevelConfig: () => req<any[]>('GET', '/admin/level-config'),
  updateLevelConfig: (data: any[]) => req<any>('PUT', '/admin/level-config', data),

  // ─── India coin economy seed ─────────────────────────────────────────────
  // Destructive: wipes coin_plans + replaces level_config + upserts the
  // India-tuned app_settings (coin_value_inr=0.10, min_withdrawal=500,
  // host_revenue_share=0.60). The backend requires both ?confirm=true AND
  // the X-Confirm-Seed header — bare `req()` doesn't pass custom headers,
  // so we call fetch directly with the same auth/error handling.
  seedIndiaDefaults: async (): Promise<{
    success: boolean;
    plans_seeded: number;
    level_count: number;
    settings_updated: string[];
  }> => {
    const token = getToken();
    if (!token) {
      handleSessionExpired();
      throw new Error('Session expired. Please log in again.');
    }
    const r = await fetch(`${API}/admin/seed/india-defaults?confirm=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
    const token = getToken();
    if (!token) {
      handleSessionExpired();
      throw new Error('Session expired. Please log in again.');
    }
    const formData = new FormData();
    formData.append('file', file);
    const baseUrl = import.meta.env.VITE_API_URL
      ? `${import.meta.env.VITE_API_URL}/api`
      : `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;
    const r = await fetch(`${baseUrl}/upload/admin-qr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (r.status === 401) {
      const newToken = await refreshAdminToken();
      if (newToken) {
        const retry = await fetch(`${baseUrl}/upload/admin-qr`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${newToken}` },
          body: formData,
        });
        if (!retry.ok) {
          const err = await retry.json().catch(() => ({ error: retry.statusText }));
          throw new Error((err as any).error || retry.statusText);
        }
        return retry.json();
      }
      handleSessionExpired();
      throw new Error('Session expired');
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
