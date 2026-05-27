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
  FIREBASE_SERVICE_ACCOUNT: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  RESEND_API_KEY?: string;
}

export interface JWTPayload {
  sub: string;
  role: 'user' | 'host' | 'admin';
  name: string;
  email?: string;
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
  audio_coins_per_minute?: number;
  video_coins_per_minute?: number;
  total_minutes: number;
  total_earnings: number;
  rating: number;
  review_count: number;
  is_online: number;
  is_top_rated: number;
  is_active: number;
}

export interface CallSessionRow {
  id: string;
  caller_id: string;
  host_id: string;
  type: 'audio' | 'video';
  status: 'pending' | 'active' | 'declined' | 'ended';
  cf_session_id: string | null;
  cf_host_session_id: string | null;
  rate_per_minute: number;
  started_at?: number;
  ended_at?: number;
  duration_seconds?: number;
  coins_charged?: number;
  created_at: number;
  updated_at: number;
}

export interface CallerData {
  id: string;
  coins: number;
  name: string;
}

export interface HostData {
  id: string;
  coins_per_minute: number;
  audio_coins_per_minute?: number;
  video_coins_per_minute?: number;
  user_id: string;
  total_minutes?: number;
  total_earnings?: number;
}
