// ============================================================================
// D1 data retention — keep unbounded tables from marching toward the 10 GB cap.
// ============================================================================
//
// D1 is SQLite: a single logical database with a HARD ~10 GB size ceiling and a
// single writer. A calling app appends to several tables forever, so without a
// retention sweep they grow without bound until D1 refuses writes (a full
// outage). This job deletes rows older than a per-table retention window.
//
// SAFETY:
//   • coin_transactions is DELIBERATELY EXCLUDED. It is the financial ledger,
//     and the coin-reconciliation watchdog asserts
//         SUM(users.coins) == SUM(coin_transactions.amount).
//     Deleting ledger rows would break that invariant and page an operator
//     every hour. Financial history should be ARCHIVED to R2, not deleted —
//     out of scope here (see the note in index.ts / the review summary).
//   • Every window is admin-tunable via app_settings; setting a key to 0
//     DISABLES pruning that table. `retention_enabled = 0` disables the whole
//     sweep.
//   • Deletes run in bounded batches with a per-run cap so one sweep can never
//     lock the DB with a giant DELETE or blow the Worker CPU budget. Anything
//     left over is picked up on the next run.
//   • Each table is independent and best-effort — a missing table or transient
//     error is logged and skipped, never aborting the rest of the sweep.
// ============================================================================

import type { Env } from '../types';

// Per-table default retention in DAYS. 0 anywhere = "keep forever" (disabled).
// Chosen conservatively: only data that is genuinely transient or safely
// re-derivable gets a short window.
const DEFAULTS: Record<string, number> = {
  // Only used for short recency windows (decline cooldown ~minutes, demand
  // balancing 60 min, daily cap 24 h). Nothing reads it beyond ~a day.
  random_match_history: 30,
  // In-app notification feed. 90 days is far longer than any user scrolls.
  notifications: 90,
  // Per-call quality telemetry (admin charts). Aggregates, not source of truth.
  call_quality: 90,
  // Ended call history. Long window keeps recent history/analytics; older rows
  // are rarely surfaced. Only `status='ended'` rows are pruned.
  call_sessions: 365,
  // Chat message history. Generous window; set to 0 to keep chat forever.
  messages: 180,
};

// Batch + cap so a single run stays cheap and never holds a long write lock.
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_TABLE = 20; // ≤ 10k rows/table/run; the rest waits for next run
const PRUNE_INTERVAL_SEC = 6 * 3600; // sweep at most every 6h

async function readIntSetting(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Delete rows older than `cutoff` (unix seconds) from `table`, in bounded
 * batches. Uses `rowid IN (SELECT ... LIMIT n)` because SQLite/D1 do not
 * support `DELETE ... LIMIT`. Table/column names are hardcoded constants (never
 * user input), so the interpolation is safe. Returns rows deleted this run.
 */
async function pruneTable(
  db: D1Database,
  table: string,
  cutoff: number,
  extraWhere = '',
): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_TABLE; i++) {
    const res = await db
      .prepare(
        `DELETE FROM ${table}
          WHERE rowid IN (
            SELECT rowid FROM ${table}
             WHERE created_at < ?${extraWhere ? ` AND ${extraWhere}` : ''}
             LIMIT ${BATCH_SIZE}
          )`,
      )
      .bind(cutoff)
      .run();
    const changes = Number(res.meta?.changes) || 0;
    total += changes;
    if (changes < BATCH_SIZE) break; // drained
  }
  return total;
}

/**
 * Run the retention sweep. Self-gated: safe to call every cron tick; it no-ops
 * until PRUNE_INTERVAL_SEC has elapsed since the last run. Returns a per-table
 * deleted-row report (or `{ skipped: true }` when gated / disabled).
 */
export async function pruneRetention(
  env: Env,
): Promise<{ skipped?: boolean; deleted?: Record<string, number> }> {
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  // Master switch.
  if ((await readIntSetting(db, 'retention_enabled', 1)) === 0) return { skipped: true };

  // Interval gate — claim the slot BEFORE running so overlapping cron ticks
  // don't double-run the sweep.
  const last = await readIntSetting(db, 'last_retention_prune_run', 0);
  if (now - last < PRUNE_INTERVAL_SEC) return { skipped: true };
  await db
    .prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_retention_prune_run', ?, unixepoch())")
    .bind(String(now))
    .run();

  const deleted: Record<string, number> = {};
  const extraWhere: Record<string, string> = {
    // Never prune a live/pending call — only finalized history.
    call_sessions: "status = 'ended'",
  };

  for (const table of Object.keys(DEFAULTS)) {
    const days = await readIntSetting(db, `retention_${table}_days`, DEFAULTS[table]);
    if (days <= 0) continue; // disabled for this table
    const cutoff = now - days * 86400;
    try {
      const n = await pruneTable(db, table, cutoff, extraWhere[table] ?? '');
      if (n > 0) deleted[table] = n;
    } catch (e) {
      // Missing table / schema lag / transient error — skip this table only.
      console.warn(`[retention] prune ${table} failed (non-fatal):`, e);
    }
  }

  if (Object.keys(deleted).length) {
    console.log('[Cron] Retention prune:', JSON.stringify(deleted));
  }
  return { deleted };
}
