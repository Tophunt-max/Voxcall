// ============================================================================
// Shared types, constants and helpers used by both the Expo Updates protocol
// server (index.ts) and the web console (console/*). Kept dependency-free so
// there are no import cycles between the two.
// ============================================================================

export interface Env {
  STORAGE: R2Bucket;
  /** Static-assets binding — serves the built React console (web-dist). */
  ASSETS: Fetcher;
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
  /**
   * Shared secret for the EAS Build webhook (`POST /console/hooks/eas`). When
   * set (`wrangler secret put EAS_WEBHOOK_SECRET`), EAS-signed build-finished
   * events are verified (HMAC-SHA1) and the finished APK/IPA is auto-published
   * to the Downloads page — no matter how the build was triggered (local
   * `eas build`, the expo.dev dashboard, or CI). Unset ⇒ the webhook is
   * disabled (503). This is the GitHub-Actions-independent, "just like Expo"
   * path; create one webhook per Expo project pointing at
   * `…/console/hooks/eas?app=user` and `…?app=host`.
   */
  EAS_WEBHOOK_SECRET?: string;
  /**
   * Write-only "publish" token for CI / scripts. When set, it authorizes ONLY
   * the build endpoints (register/upload) — never rollback/force/promote. Keep
   * it separate from CONSOLE_PASSWORD (the human login) so a leaked CI token
   * can't flip production. `wrangler secret put PUBLISH_TOKEN`.
   */
  PUBLISH_TOKEN?: string;
  /**
   * Optional incoming-webhook URL (Slack / Discord / generic). When set, the
   * server posts a short message on notable events (promote, rollback,
   * auto-rollback, new build). `wrangler secret put NOTIFY_WEBHOOK_URL`.
   */
  NOTIFY_WEBHOOK_URL?: string;
  /**
   * Retention: updates/builds older than this many days are pruned by the
   * daily cron (live pointers + the newest few are always kept). Unset/0 ⇒
   * cleanup disabled. e.g. RETENTION_DAYS = "60".
   */
  RETENTION_DAYS?: string;
  /**
   * Auto-rollback tuning (opt-in). When AUTO_ROLLBACK_FAILURE_PCT is set (1-100)
   * a live update whose client-reported failure rate exceeds it — over at least
   * AUTO_ROLLBACK_MIN_SAMPLE reports — is automatically rolled back to embedded.
   * Unset ⇒ health is only recorded (manual rollback from the console).
   */
  AUTO_ROLLBACK_FAILURE_PCT?: string;
  AUTO_ROLLBACK_MIN_SAMPLE?: string;
}

export const PROTOCOL_VERSION = '1';
export const APPS = new Set(['user', 'host']);
export const UPDATES_PREFIX = 'ota/updates';
export const CHANNELS_PREFIX = 'ota/channels';
export const METRICS_PREFIX = 'ota/metrics';
export const BUILDS_PREFIX = 'ota/builds';
export const AUDIT_PREFIX = 'ota/audit';
export const HEALTH_PREFIX = 'ota/health';

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
