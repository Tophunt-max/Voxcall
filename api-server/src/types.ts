export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  CALL_SIGNALING: DurableObjectNamespace;
  NOTIFICATION_HUB: DurableObjectNamespace;
  JWT_SECRET: string;
  CF_CALLS_APP_ID: string;
  CF_CALLS_APP_SECRET: string;
  CF_ACCOUNT_ID: string;
}

export interface JWTPayload {
  sub: string;
  role: 'user' | 'host' | 'admin';
  name: string;
  iat: number;
  exp: number;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  gender: string | null;
  bio: string;
  coins: number;
  role: string;
  is_verified: number;
  created_at: number;
}

export interface HostRow {
  id: string;
  user_id: string;
  display_name: string;
  specialties: string;
  languages: string;
  coins_per_minute: number;
  total_minutes: number;
  total_earnings: number;
  rating: number;
  review_count: number;
  is_online: number;
  is_top_rated: number;
  is_active: number;
}
