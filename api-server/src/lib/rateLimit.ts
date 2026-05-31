// ============================================================================
// Atomic D1 rate limiter (FIX #7)
// ============================================================================
//
// The previous limiters did a read (`SELECT attempts`) followed by a separate
// write (`UPDATE attempts + 1`). Two concurrent requests could both read the
// same count and undercount, letting bursts exceed the limit (TOCTOU).
//
// This does the whole check-and-increment in a SINGLE `INSERT … ON CONFLICT …
// RETURNING` statement, which SQLite/D1 executes atomically:
//   • new key            → row inserted with attempts = 1
//   • existing, expired  → attempts reset to 1, window slid forward
//   • existing, in-window → attempts incremented
// The returned `attempts` is the authoritative post-increment count.
//
// Callers decide whether to fail OPEN (don't block on D1 error) — appropriate
// for non-security limits — or fail CLOSED. The helper throws on DB error so
// the caller chooses; `checkRateLimit` (fail-open) is provided for convenience.

export interface RateLimitResult {
  limited: boolean;
  attempts: number;
  retryAfterSec: number;
}

/**
 * Atomically register one hit against `key` and report whether `maxAttempts`
 * has been exceeded within `windowSecs`. Throws if the DB op fails (caller
 * decides fail-open vs fail-closed).
 */
export async function registerHit(
  db: D1Database,
  key: string,
  maxAttempts: number,
  windowSecs: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const newReset = now + windowSecs;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (id, attempts, window_reset) VALUES (?1, 1, ?3)
       ON CONFLICT(id) DO UPDATE SET
         attempts = CASE WHEN rate_limits.window_reset <= ?2 THEN 1 ELSE rate_limits.attempts + 1 END,
         window_reset = CASE WHEN rate_limits.window_reset <= ?2 THEN ?3 ELSE rate_limits.window_reset END
       RETURNING attempts, window_reset`,
    )
    .bind(key, now, newReset)
    .first<{ attempts: number; window_reset: number }>();
  const attempts = row?.attempts ?? 1;
  const windowReset = row?.window_reset ?? newReset;
  return {
    limited: attempts > maxAttempts,
    attempts,
    retryAfterSec: Math.max(1, windowReset - now),
  };
}

/**
 * Fail-open convenience wrapper: returns `{ limited: false }` if the DB op
 * throws (e.g. table not migrated / brief D1 outage) and logs the failure.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  maxAttempts: number,
  windowSecs: number,
): Promise<RateLimitResult> {
  try {
    return await registerHit(db, key, maxAttempts, windowSecs);
  } catch (e) {
    console.warn('[rate-limit] failing open after DB error:', e);
    return { limited: false, attempts: 0, retryAfterSec: 0 };
  }
}
