// ============================================================================
// Cached app_settings reader — cut D1 reads on hot paths.
// ============================================================================
//
// `app_settings` is a tiny key/value config table that is read CONSTANTLY:
// the matchmaker (POST /match/find) alone reads ~6 keys per request, and the
// user app polls it every ~2.5s while searching. Those values (rate-limit
// knobs, match weights, feature flags, FX rates, economy rates) change rarely —
// re-reading them from D1 on every request wastes the single-writer database's
// read budget and adds latency to the hottest endpoint.
//
// This mirrors the proven per-isolate cache already used for level_config
// (lib/levels.ts getLevelConfig): each value is cached in the isolate for a
// short TTL, so a burst of requests on one isolate collapses to a single D1
// read. Staleness is bounded by the TTL (default 30s), and admin writes can
// invalidate explicitly via clearSettingCache()/clearAllSettingsCache().
//
// SCOPE: single scalar values by key. Structured/derived config (level ladder,
// coin plans) keep their own purpose-built loaders.
// ============================================================================

const DEFAULT_TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  value: string | null;
}

const cache = new Map<string, CacheEntry>();

/**
 * Read a single app_settings value, served from a per-isolate TTL cache.
 * Returns the raw string (or null when the row is absent). On a D1 error it
 * returns any cached value (even if stale) rather than throwing, then null.
 */
export async function getCachedSetting(
  db: D1Database,
  key: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    const value = row?.value ?? null;
    cache.set(key, { at: now, value });
    return value;
  } catch (e) {
    // Serve stale on error if we have anything; otherwise null (callers all
    // have their own fallbacks).
    if (hit) return hit.value;
    console.warn('[settingsCache] read failed for', key, e);
    return null;
  }
}

/** Cached positive-integer setting with a fallback. */
export async function getCachedIntSetting(
  db: D1Database,
  key: string,
  fallback: number,
  ttlMs?: number,
): Promise<number> {
  const raw = await getCachedSetting(db, key, ttlMs);
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Cached boolean feature flag. Any stored value other than '0' is enabled; a
 * missing row falls back to `fallbackEnabled`.
 */
export async function getCachedBoolSetting(
  db: D1Database,
  key: string,
  fallbackEnabled: boolean,
  ttlMs?: number,
): Promise<boolean> {
  const raw = await getCachedSetting(db, key, ttlMs);
  if (raw == null) return fallbackEnabled;
  return raw !== '0';
}

/** Invalidate one cached key (call after an admin write to that key). */
export function clearSettingCache(key: string): void {
  cache.delete(key);
}

/** Invalidate the whole settings cache (call after a bulk settings write). */
export function clearAllSettingsCache(): void {
  cache.clear();
}
