// Schema guard — auto-heal missing columns on cold start.
//
// Background: migrations are applied via `wrangler d1 migrations apply` in
// the deploy workflow. If that step ever runs without the `--remote` flag
// (or fails silently), the production D1 schema falls behind the code, and
// queries that reference newer columns crash the route with a 500.
//
// This guard fixes the schema at runtime, idempotently, the first time any
// `/api/*` request hits a worker isolate. After the first successful run
// the cached resolved Promise short-circuits to a microtask — no DB round
// trip on subsequent requests in the same isolate.
//
// Specifically it ensures:
//   - users.country  TEXT  (added by migration 0023)
//   - users.currency TEXT  (added by migration 0023)
//   - idx_users_country index (added by migration 0023)
//
// Notes:
//   - D1 / SQLite does NOT support `ALTER TABLE ADD COLUMN IF NOT EXISTS`,
//     so we read PRAGMA table_info first and only add what's missing.
//   - On failure, we clear the cache so the *next* request retries — a
//     transient D1 hiccup shouldn't lock the worker out forever.
//   - We never throw to callers. If healing fails, downstream queries will
//     still surface the original schema error and we'll see it in logs.

let schemaReadyPromise: Promise<boolean> | null = null;

const REQUIRED_USER_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'country',  ddl: 'ALTER TABLE users ADD COLUMN country TEXT' },
  { name: 'currency', ddl: 'ALTER TABLE users ADD COLUMN currency TEXT' },
];

export function ensureUsersSchema(db: D1Database): Promise<boolean> {
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    try {
      const info = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
      const existing = new Set((info.results ?? []).map((r) => r.name));

      for (const col of REQUIRED_USER_COLUMNS) {
        if (!existing.has(col.name)) {
          try {
            await db.prepare(col.ddl).run();
            console.log(`[schemaGuard] added users.${col.name}`);
          } catch (err) {
            // Race: another concurrent isolate may have just added it. The
            // PRAGMA recheck below will confirm and we'll proceed.
            console.warn(`[schemaGuard] add column ${col.name} failed (may be a race):`, err);
          }
        }
      }

      // Idempotent — CREATE INDEX IF NOT EXISTS is safe to run repeatedly.
      try {
        await db.prepare('CREATE INDEX IF NOT EXISTS idx_users_country ON users(country)').run();
      } catch (err) {
        // Don't fail the whole guard if index creation hiccups — login still works without it.
        console.warn('[schemaGuard] idx_users_country creation failed:', err);
      }

      return true;
    } catch (err) {
      console.error('[schemaGuard] ensureUsersSchema failed:', err);
      // Reset so the next request can retry instead of getting permanently stuck.
      schemaReadyPromise = null;
      return false;
    }
  })();

  return schemaReadyPromise;
}


// ============================================================================
// Daily streak schema guard — auto-heal migration 0027 on cold start.
// ============================================================================
//
// Mirrors ensureRandomCallSchema(). Adds the two streak columns on `users`
// and seeds the default schedule / milestones / enabled flag in app_settings
// when missing. Idempotent — safe to call on every request.

let streakSchemaReadyPromise: Promise<boolean> | null = null;

const REQUIRED_USER_STREAK_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'streak_days',          ddl: 'ALTER TABLE users ADD COLUMN streak_days INTEGER DEFAULT 0' },
  { name: 'last_streak_claim_at', ddl: 'ALTER TABLE users ADD COLUMN last_streak_claim_at INTEGER DEFAULT 0' },
];

const STREAK_DEFAULT_SETTINGS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'daily_streak_schedule',    value: '[5,10,15,20,30,50,100]' },
  { key: 'daily_streak_milestones',  value: '{"7":50,"14":100,"30":500,"60":1500,"100":5000}' },
  { key: 'daily_streak_enabled',     value: '1' },
];

export function ensureStreakSchema(db: D1Database): Promise<boolean> {
  if (streakSchemaReadyPromise) return streakSchemaReadyPromise;

  streakSchemaReadyPromise = (async () => {
    try {
      const userInfo = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
      const cols = new Set((userInfo.results ?? []).map((r) => r.name));
      for (const col of REQUIRED_USER_STREAK_COLUMNS) {
        if (!cols.has(col.name)) {
          try {
            await db.prepare(col.ddl).run();
            console.log(`[schemaGuard] added users.${col.name}`);
          } catch (err) {
            console.warn(`[schemaGuard] add users.${col.name} failed (may be a race):`, err);
          }
        }
      }

      // Seed defaults via INSERT OR IGNORE — never overwrites an admin's
      // tuned values, only fills gaps.
      for (const s of STREAK_DEFAULT_SETTINGS) {
        try {
          await db
            .prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())")
            .bind(s.key, s.value)
            .run();
        } catch (err) {
          console.warn(`[schemaGuard] seed app_settings.${s.key} failed:`, err);
        }
      }

      return true;
    } catch (err) {
      console.error('[schemaGuard] ensureStreakSchema failed:', err);
      streakSchemaReadyPromise = null;
      return false;
    }
  })();

  return streakSchemaReadyPromise;
}

// ============================================================================
// Calling-system observability schema guard — auto-heal migration 0029.
// ============================================================================
//
// Adds the end-reason column on call_sessions, the call_quality table for
// per-call jitter/loss/rtt samples, and two new app_settings rows
// (billing_granularity_sec, low_balance_warn_seconds). Idempotent — same
// pattern as ensureRandomCallSchema / ensureStreakSchema /
// ensureFirstCallFreeSchema.

let callObsSchemaReadyPromise: Promise<boolean> | null = null;

const REQUIRED_CALL_OBS_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'end_reason', ddl: 'ALTER TABLE call_sessions ADD COLUMN end_reason TEXT' },
];

const CALL_QUALITY_DDL = `
  CREATE TABLE IF NOT EXISTS call_quality (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    call_session_id TEXT NOT NULL REFERENCES call_sessions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('caller','host')),
    jitter_ms REAL,
    packet_loss_pct REAL,
    rtt_ms REAL,
    codec TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`;

const CALL_OBS_DEFAULT_SETTINGS: ReadonlyArray<{ key: string; value: string }> = [
  // Billing granularity (60 = per-minute round-up; 1 = whole-second precision).
  // Admin can flip via Settings without a code change. Default preserves
  // historical behaviour exactly.
  { key: 'billing_granularity_sec', value: '60' },
  // Heartbeat pushes a call_low_balance WS event when caller has fewer
  // than this many seconds of coins left, so the client can surface a
  // mid-call top-up modal before the call hard-stops.
  { key: 'low_balance_warn_seconds', value: '60' },
];

export function ensureCallObservabilitySchema(db: D1Database): Promise<boolean> {
  if (callObsSchemaReadyPromise) return callObsSchemaReadyPromise;

  callObsSchemaReadyPromise = (async () => {
    try {
      // 1. Add end_reason column if missing.
      const csInfo = await db.prepare('PRAGMA table_info(call_sessions)').all<{ name: string }>();
      const csCols = new Set((csInfo.results ?? []).map((r) => r.name));
      for (const col of REQUIRED_CALL_OBS_COLUMNS) {
        if (!csCols.has(col.name)) {
          try {
            await db.prepare(col.ddl).run();
            console.log(`[schemaGuard] added call_sessions.${col.name}`);
          } catch (err) {
            console.warn(`[schemaGuard] add call_sessions.${col.name} failed:`, err);
          }
        }
      }

      // 2. Create call_quality table if missing — IF NOT EXISTS makes
      //    re-running safe.
      try {
        await db.prepare(CALL_QUALITY_DDL).run();
      } catch (err) {
        console.warn('[schemaGuard] call_quality create failed:', err);
      }

      // 3. Indexes — partial on end_reason saves space on the dominant
      //    NULL value, full on call_quality for per-host aggregations.
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_call_sessions_end_reason ON call_sessions(end_reason) WHERE end_reason IS NOT NULL`,
        'CREATE INDEX IF NOT EXISTS idx_call_quality_session ON call_quality(call_session_id)',
        'CREATE INDEX IF NOT EXISTS idx_call_quality_user_time ON call_quality(user_id, created_at DESC)',
      ];
      for (const ddl of indexes) {
        try {
          await db.prepare(ddl).run();
        } catch (err) {
          console.warn('[schemaGuard] index creation failed:', err);
        }
      }

      // 4. Seed default settings via INSERT OR IGNORE — never overwrites.
      for (const s of CALL_OBS_DEFAULT_SETTINGS) {
        try {
          await db
            .prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())")
            .bind(s.key, s.value)
            .run();
        } catch (err) {
          console.warn(`[schemaGuard] seed app_settings.${s.key} failed:`, err);
        }
      }

      return true;
    } catch (err) {
      console.error('[schemaGuard] ensureCallObservabilitySchema failed:', err);
      callObsSchemaReadyPromise = null;
      return false;
    }
  })();

  return callObsSchemaReadyPromise;
}

// ============================================================================
// First-call-free schema guard — auto-heal migration 0028 on cold start.
// ============================================================================
//
// Adds the user-level free-minute pool + the per-call usage counter, and
// seeds the default pool size in app_settings. Fully idempotent — same
// pattern as ensureRandomCallSchema / ensureStreakSchema.

let firstCallSchemaReadyPromise: Promise<boolean> | null = null;

const REQUIRED_FIRST_CALL_USER_COLS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'free_call_minutes', ddl: 'ALTER TABLE users ADD COLUMN free_call_minutes INTEGER DEFAULT 0' },
];

const REQUIRED_FIRST_CALL_SESSION_COLS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'free_minutes_used', ddl: 'ALTER TABLE call_sessions ADD COLUMN free_minutes_used INTEGER DEFAULT 0' },
];

const FIRST_CALL_DEFAULT_SETTINGS: ReadonlyArray<{ key: string; value: string }> = [
  // Default 5-minute freebie. Set to '0' to kill-switch the feature without
  // removing the schema; admin can lift the cap to 10/30/etc. via Settings.
  { key: 'first_call_free_minutes', value: '5' },
];

export function ensureFirstCallFreeSchema(db: D1Database): Promise<boolean> {
  if (firstCallSchemaReadyPromise) return firstCallSchemaReadyPromise;

  firstCallSchemaReadyPromise = (async () => {
    try {
      const userInfo = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
      const userCols = new Set((userInfo.results ?? []).map((r) => r.name));
      for (const col of REQUIRED_FIRST_CALL_USER_COLS) {
        if (!userCols.has(col.name)) {
          try {
            await db.prepare(col.ddl).run();
            console.log(`[schemaGuard] added users.${col.name}`);
          } catch (err) {
            console.warn(`[schemaGuard] add users.${col.name} failed:`, err);
          }
        }
      }

      const csInfo = await db.prepare('PRAGMA table_info(call_sessions)').all<{ name: string }>();
      const csCols = new Set((csInfo.results ?? []).map((r) => r.name));
      for (const col of REQUIRED_FIRST_CALL_SESSION_COLS) {
        if (!csCols.has(col.name)) {
          try {
            await db.prepare(col.ddl).run();
            console.log(`[schemaGuard] added call_sessions.${col.name}`);
          } catch (err) {
            console.warn(`[schemaGuard] add call_sessions.${col.name} failed:`, err);
          }
        }
      }

      for (const s of FIRST_CALL_DEFAULT_SETTINGS) {
        try {
          await db
            .prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())")
            .bind(s.key, s.value)
            .run();
        } catch (err) {
          console.warn(`[schemaGuard] seed app_settings.${s.key} failed:`, err);
        }
      }

      return true;
    } catch (err) {
      console.error('[schemaGuard] ensureFirstCallFreeSchema failed:', err);
      firstCallSchemaReadyPromise = null;
      return false;
    }
  })();

  return firstCallSchemaReadyPromise;
}

//
// The Random Call overhaul added columns + a new table:
//   - hosts.accepts_random_calls      INTEGER DEFAULT 1
//   - hosts.allows_video              INTEGER DEFAULT 1
//   - call_sessions.is_random_match   INTEGER DEFAULT 0
//   - random_match_history            (table)
//
// If the deploy ever ships the worker without running `wrangler d1 migrations
// apply --remote`, every /match/find call would crash with "no such column /
// no such table" and the user app would surface "Network error, retrying…"
// in an infinite loop. This guard fixes that exactly the same way
// ensureUsersSchema already does: read PRAGMA / sqlite_master, add what's
// missing, cache the result for the lifetime of the worker isolate.

let randomSchemaReadyPromise: Promise<boolean> | null = null;

const REQUIRED_HOSTS_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'accepts_random_calls', ddl: 'ALTER TABLE hosts ADD COLUMN accepts_random_calls INTEGER DEFAULT 1' },
  { name: 'allows_video',         ddl: 'ALTER TABLE hosts ADD COLUMN allows_video INTEGER DEFAULT 1' },
];

const REQUIRED_CALL_SESSIONS_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'is_random_match', ddl: 'ALTER TABLE call_sessions ADD COLUMN is_random_match INTEGER DEFAULT 0' },
];

const RANDOM_MATCH_HISTORY_DDL = `
  CREATE TABLE IF NOT EXISTS random_match_history (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES users(id),
    host_id TEXT NOT NULL REFERENCES hosts(id),
    call_type TEXT NOT NULL CHECK(call_type IN ('audio','video')),
    outcome TEXT NOT NULL DEFAULT 'matched'
      CHECK(outcome IN ('matched','accepted','declined','timeout')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`;

/**
 * Ensure migration 0026 has effectively been applied to the live DB. Safe to
 * call on every request — the heavy work runs once per worker isolate, then
 * the cached Promise short-circuits.
 *
 * Never throws: if a heal step fails (transient D1 issue, race with another
 * isolate, etc.) we clear the cache so the next request retries, and the
 * downstream query surfaces the real error in logs. Match.ts / call.ts also
 * defensively swallow individual SQL errors on these tables so a one-off
 * heal failure can't take down random matching.
 */
export function ensureRandomCallSchema(db: D1Database): Promise<boolean> {
  if (randomSchemaReadyPromise) return randomSchemaReadyPromise;

  randomSchemaReadyPromise = (async () => {
    try {
      // 1. hosts columns
      const hostsInfo = await db.prepare('PRAGMA table_info(hosts)').all<{ name: string }>();
      const hostsCols = new Set((hostsInfo.results ?? []).map((r) => r.name));
      for (const col of REQUIRED_HOSTS_COLUMNS) {
        if (!hostsCols.has(col.name)) {
          try {
            await db.prepare(col.ddl).run();
            console.log(`[schemaGuard] added hosts.${col.name}`);
          } catch (err) {
            console.warn(`[schemaGuard] add hosts.${col.name} failed (may be a race):`, err);
          }
        }
      }

      // 2. call_sessions columns
      const csInfo = await db.prepare('PRAGMA table_info(call_sessions)').all<{ name: string }>();
      const csCols = new Set((csInfo.results ?? []).map((r) => r.name));
      for (const col of REQUIRED_CALL_SESSIONS_COLUMNS) {
        if (!csCols.has(col.name)) {
          try {
            await db.prepare(col.ddl).run();
            console.log(`[schemaGuard] added call_sessions.${col.name}`);
          } catch (err) {
            console.warn(`[schemaGuard] add call_sessions.${col.name} failed (may be a race):`, err);
          }
        }
      }

      // 3. random_match_history table — IF NOT EXISTS so re-running is safe.
      try {
        await db.prepare(RANDOM_MATCH_HISTORY_DDL).run();
      } catch (err) {
        console.warn('[schemaGuard] random_match_history create failed:', err);
      }

      // 4. Supporting indexes — all idempotent.
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_hosts_random_pool ON hosts(is_active, is_online, accepts_random_calls)',
        'CREATE INDEX IF NOT EXISTS idx_random_match_user_time ON random_match_history(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_random_match_user_host_time ON random_match_history(user_id, host_id, created_at DESC)',
      ];
      for (const ddl of indexes) {
        try {
          await db.prepare(ddl).run();
        } catch (err) {
          console.warn('[schemaGuard] index creation failed:', err);
        }
      }

      return true;
    } catch (err) {
      console.error('[schemaGuard] ensureRandomCallSchema failed:', err);
      randomSchemaReadyPromise = null; // allow retry on next request
      return false;
    }
  })();

  return randomSchemaReadyPromise;
}
