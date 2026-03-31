// Use VITE_API_URL env var for direct connection to production API,
// or fall back to Vite proxy (localhost:8080) for local dev
const API = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

export function getToken() { return localStorage.getItem('voxlink_admin_token') || ''; }

export async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((err as any).error || r.statusText);
  }
  return r.json();
}

export const api = {
  login: (email: string, password: string) => req<{ token: string; user: any }>('POST', '/auth/login', { email, password }),
  dashboard: () => req<any>('GET', '/admin/dashboard'),
  users: (p?: string, s?: string) => req<any[]>('GET', `/admin/users?page=${p||1}${s ? '&search='+encodeURIComponent(s) : ''}`),
  updateUser: (id: string, data: any) => req('PATCH', `/admin/users/${id}`, data),
  hosts: () => req<any[]>('GET', '/admin/hosts'),
  updateHost: (id: string, data: any) => req('PATCH', `/admin/hosts/${id}`, data),
  withdrawals: () => req<any[]>('GET', '/admin/withdrawals'),
  updateWithdrawal: (id: string, data: any) => req('PATCH', `/admin/withdrawals/${id}`, data),
  coinPlans: () => req<any[]>('GET', '/admin/coin-plans'),
  createCoinPlan: (data: any) => req<any>('POST', '/admin/coin-plans', data),
  updateCoinPlan: (id: string, data: any) => req('PATCH', `/admin/coin-plans/${id}`, data),
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
  coinTransactions: () => req<any[]>('GET', '/admin/coin-transactions'),
  ratings: () => req<any[]>('GET', '/admin/ratings'),
  analytics: () => req<any>('GET', '/admin/analytics'),
  notifications: () => req<any[]>('GET', '/admin/notifications'),
  sendNotification: (data: any) => req<any>('POST', '/admin/notifications/send', data),
  post: (path: string, data: any) => req<any>('POST', path.replace('/api/admin/', '/admin/').replace('/api/', '/'), data),
  recalculateHostLevels: () => req<any>('POST', '/admin/hosts/recalculate-levels', {}),
  getLevelConfig: () => req<any[]>('GET', '/admin/level-config'),
  updateLevelConfig: (data: any[]) => req<any>('PUT', '/admin/level-config', data),
};
