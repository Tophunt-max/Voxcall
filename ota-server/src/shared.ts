// ============================================================================
// Shared types, constants and helpers used by both the Expo Updates protocol
// server (index.ts) and the web console (console/*). Kept dependency-free so
// there are no import cycles between the two.
// ============================================================================

export interface Env {
  STORAGE: R2Bucket;
  /** PKCS8 PEM private key. When set (secret) + the client asks, manifests are signed. */
  CODE_SIGNING_PRIVATE_KEY?: string;
  /** keyid advertised in the expo-signature header (default "root"). */
  CODE_SIGNING_KEY_ID?: string;
  /**
   * Bearer token that unlocks the built-in web console at `/console`. Set it as
   * a secret (`wrangler secret put CONSOLE_PASSWORD`). When UNSET the console's
   * data + management endpoints are disabled (503) — safe by default, so the
   * worker never exposes an open rollback/force switch.
   */
  CONSOLE_PASSWORD?: string;
}

export const PROTOCOL_VERSION = '1';
export const APPS = new Set(['user', 'host']);
export const UPDATES_PREFIX = 'ota/updates';
export const CHANNELS_PREFIX = 'ota/channels';
export const METRICS_PREFIX = 'ota/metrics';

export interface AssetRecord {
  key: string;
  contentType: string;
  hash: string;
  fileExtension?: string;
  storageKey: string;
}

export interface PlatformRecord {
  /**
   * The runtimeVersion this platform's bundle was built against. Present when
   * the publisher used the "fingerprint" policy (iOS/Android can differ). When
   * absent (appVersion policy) the record's top-level runtimeVersion applies.
   */
  runtimeVersion?: string;
  launchAsset: AssetRecord;
  assets: AssetRecord[];
}

export interface UpdateRecord {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  extra?: Record<string, unknown>;
  platforms: Partial<Record<'ios' | 'android', PlatformRecord>>;
}

/** Filesystem-safe form used for channel/runtimeVersion path segments in R2. */
export function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** JSON response with a no-store cache policy. */
export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
