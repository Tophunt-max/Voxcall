// VoxLink API Client — connects to Cloudflare Workers backend
import { getItem } from '@/utils/storage';
import { StorageKeys } from '@/utils/storage';

// In development: localhost:8080 (wrangler dev)
// In production: set EXPO_PUBLIC_API_URL env var to your deployed worker URL
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080';

async function getToken(): Promise<string> {
  const token = await getItem<string>(StorageKeys.AUTH_TOKEN);
  return token || '';
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = true
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
  register: (name: string, email: string, password: string, phone?: string) =>
    apiRequest<{ token: string; user: any }>('POST', '/api/auth/register', { name, email, password, phone }, false),
  me: () => apiRequest<any>('GET', '/api/user/me'),
  updateProfile: (data: any) => apiRequest('PATCH', '/api/user/me', data),
  updateAvatar: async (formData: FormData) => {
    const token = await getToken();
    const res = await fetch(`${BASE_URL}/api/upload/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
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
  setHostOnline: (online: boolean) => apiRequest('PATCH', '/api/host/status', { is_online: online }),
  getEarnings: () => apiRequest<any>('GET', '/api/host/earnings'),

  // Coins
  getCoinPlans: () => apiRequest<any[]>('GET', '/api/coins/plans'),
  getBalance: () => apiRequest<{ coins: number }>('GET', '/api/coins/balance'),
  purchaseCoins: (plan_id: string, payment_method: string, payment_ref?: string) =>
    apiRequest('POST', '/api/coins/purchase', { plan_id, payment_method, payment_ref }),
  getCoinHistory: () => apiRequest<any[]>('GET', '/api/coins/history'),
  requestWithdrawal: (coins_requested: number, method: string, account_info: string) =>
    apiRequest('POST', '/api/coins/withdraw', { coins_requested, method, account_info }),

  // Calls
  initiateCall: (host_id: string, call_type: 'audio' | 'video') =>
    apiRequest<any>('POST', '/api/calls/initiate', { host_id, call_type }),
  endCall: (session_id: string, duration_seconds: number) =>
    apiRequest('POST', '/api/calls/end', { session_id, duration_seconds }),
  rateCall: (session_id: string, rating: number, comment?: string) =>
    apiRequest('POST', '/api/calls/rate', { session_id, rating, comment }),
  getCallHistory: () => apiRequest<any[]>('GET', '/api/calls/history'),

  // Chat
  getChatRooms: () => apiRequest<any[]>('GET', '/api/chat/rooms'),
  createChatRoom: (host_id: string) => apiRequest<any>('POST', '/api/chat/rooms', { host_id }),
  getMessages: (room_id: string, before?: number) =>
    apiRequest<any[]>('GET', `/api/chat/rooms/${room_id}/messages${before ? `?before=${before}` : ''}`),
  sendMessage: (room_id: string, content: string, media_url?: string, media_type?: string) =>
    apiRequest('POST', `/api/chat/rooms/${room_id}/messages`, { content, media_url, media_type }),

  // Talk topics (public)
  getTalkTopics: () => apiRequest<any[]>('GET', '/api/talk-topics', undefined, false),

  // Notifications
  getNotifications: () => apiRequest<any[]>('GET', '/api/user/notifications'),
  markNotificationsRead: () => apiRequest('PATCH', '/api/user/notifications/read', {}),
  markOneNotificationRead: (id: string) => apiRequest('PATCH', `/api/user/notifications/${id}/read`, {}),
};
