export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  CALL_SIGNALING: DurableObjectNamespace;
  NOTIFICATION_HUB: DurableObjectNamespace;
  JWT_SECRET: string;
  // Agora RTC credentials — the ONLY media transport. Both MUST be set for
  // calls to work; AGORA_APP_CERTIFICATE must be a Worker SECRET (never a var).
  // The backend mints per-call join tokens at GET /api/calls/:id/agora-token.
  AGORA_APP_ID: string;
  AGORA_APP_CERTIFICATE: string;
  // Deployment environment marker. Set to "production" in the production
  // wrangler environment so runtime code can tighten behaviour.
  ENVIRONMENT?: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  RESEND_API_KEY?: string;
  // FIX #6: Optional comma-separated list of EXACT allowed CORS origins for
  // production (e.g. "https://admin.voxlink.com,https://voxlink.com"). When set,
  // it REPLACES the broad built-in dev patterns (which allow any *.pages.dev /
  // *.replit.dev). Leave unset in dev to keep the permissive fallback.
  CORS_ALLOWED_ORIGINS?: string;
}

export interface JWTPayload {
  sub: string;
  role: 'user' | 'host' | 'admin';
  name: string;
  email?: string;
  iat: number;
  exp: number;
  // FIX (currency auto-detect): the auth middleware enriches the request-scoped
  // payload with the user's detected country + currency so route handlers can
  // localize prices without an extra DB read. These are NOT signed into the
  // JWT itself — they're hydrated per-request from the users row.
  country?: string;
  currency?: string;
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
  level?: number;
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
