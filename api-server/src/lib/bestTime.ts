// ============================================================================
// Best-Time-To-Notify engine — send each user their nudges when THEY are active.
// ============================================================================
//
// Blasting every user at the same clock time wastes reach — a notification seen
// at the user's typical active hour converts far better and annoys less. This
// engine learns each user's most-active IST hour from their real behaviour and
// lets the engagement send-path prefer that window.
//
// HOW IT LEARNS (daily cron, ONE windowed query — not per-user):
//   Activity signals = call_sessions.created_at (they were online + calling)
//   + notifications they OPENED (is_read = 1) — i.e. moments they engaged.
//   For each user we take the modal (most frequent) IST hour over a lookback
//   window and store it in users.active_hour_ist (0..23; -1 = unknown).
//
// HOW IT'S USED:
//   notifyEngagement() calls isWithinActiveWindow(): when smart timing is ON
//   and we KNOW the user's active hour, a nudge is only delivered if the
//   current IST hour is within ±window of it. Since most engagement crons run
//   hourly, each user naturally receives their nudge close to their peak hour.
//   Users with an unknown active hour are never suppressed (fail-open).
//
// Admin-tunable, defaults DISABLED — pure opt-in, zero behaviour change until on.
// ============================================================================

const IST_OFFSET_SEC = (5 * 60 + 30) * 60; // +5:30

async function readInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}
async function readBool(db: D1Database, key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallback;
    return row.value !== '0' && row.value.toLowerCase() !== 'false';
  } catch { return fallback; }
}

/** Current IST hour (0..23). */
export function currentIstHour(now = Math.floor(Date.now() / 1000)): number {
  return Math.floor(((now + IST_OFFSET_SEC) % 86400) / 3600);
}

/** Circular distance between two hours on a 24h clock (0..12). */
export function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/**
 * Recompute each user's modal active IST hour and store it on users.active_hour_ist.
 * Runs from a daily cron. ONE windowed aggregate query + batched updates — no
 * per-user round-trips. Best-effort; never throws.
 *
 * @returns number of users whose active hour was (re)written.
 */
export async function recomputeActiveHours(db: D1Database): Promise<number> {
  try {
    if (!(await readBool(db, 'smart_timing_enabled', false))) return 0;
    const lookbackDays = Math.max(1, await readInt(db, 'smart_timing_lookback_days', 21));
    const maxUsers = Math.max(1, Math.min(20000, await readInt(db, 'smart_timing_max_users', 10000)));
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - lookbackDays * 86400;

    // For each user, the IST hour with the most activity events over the window.
    // ROW_NUMBER picks the top hour; ties break to the earlier hour for stability.
    // IST hour of a unix ts = ((ts + 19800) / 3600) % 24.
    const rows = await db
      .prepare(
        `WITH activity AS (
           SELECT caller_id AS uid, ((created_at + ${IST_OFFSET_SEC}) / 3600) % 24 AS h
             FROM call_sessions WHERE created_at > ?1 AND caller_id IS NOT NULL
           UNION ALL
           SELECT user_id AS uid, ((created_at + ${IST_OFFSET_SEC}) / 3600) % 24 AS h
             FROM notifications WHERE created_at > ?1 AND is_read = 1
         ),
         counts AS (
           SELECT uid, h, COUNT(*) AS n FROM activity GROUP BY uid, h
         ),
         ranked AS (
           SELECT uid, h, ROW_NUMBER() OVER (PARTITION BY uid ORDER BY n DESC, h ASC) AS rn
             FROM counts
         )
         SELECT uid, h FROM ranked WHERE rn = 1 LIMIT ?2`,
      )
      .bind(cutoff, maxUsers)
      .all<{ uid: string; h: number }>();

    const results = rows.results ?? [];
    if (results.length === 0) return 0;

    // Batched updates (D1 batch limit is 100; use 90 for headroom).
    let written = 0;
    for (let i = 0; i < results.length; i += 90) {
      const chunk = results.slice(i, i + 90);
      try {
        await db.batch(
          chunk.map((r) =>
            db.prepare('UPDATE users SET active_hour_ist = ? WHERE id = ?')
              .bind(Math.max(0, Math.min(23, Number(r.h) || 0)), r.uid),
          ),
        );
        written += chunk.length;
      } catch (e) {
        console.warn('[bestTime] active-hour update batch failed (non-fatal):', e);
      }
    }
    return written;
  } catch (e) {
    console.warn('[bestTime] recomputeActiveHours failed:', e);
    return 0;
  }
}

/**
 * Should an engagement nudge to this user be delivered RIGHT NOW under smart
 * timing? Returns true (deliver) when:
 *   - smart timing is disabled (feature off), OR
 *   - the user's active hour is unknown (-1) — never suppress on no data, OR
 *   - the current IST hour is within ±window of the user's learned active hour.
 * Returns false (suppress) only when we CONFIDENTLY know this is a bad time.
 * Best-effort; any error → deliver (fail-open).
 */
export async function isWithinActiveWindow(db: D1Database, userId: string): Promise<boolean> {
  try {
    if (!(await readBool(db, 'smart_timing_enabled', false))) return true;
    const window = Math.max(0, Math.min(12, await readInt(db, 'smart_timing_window_hours', 2)));
    const row = await db.prepare('SELECT active_hour_ist FROM users WHERE id = ?').bind(userId)
      .first<{ active_hour_ist: number | null }>();
    const activeHour = row?.active_hour_ist;
    if (activeHour == null || activeHour < 0) return true; // unknown → don't suppress
    return hourDistance(currentIstHour(), Number(activeHour)) <= window;
  } catch {
    return true;
  }
}
