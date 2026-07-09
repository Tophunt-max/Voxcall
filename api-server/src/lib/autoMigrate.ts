// Runtime auto-migrator — converges the live D1 schema to match the code on
// every worker cold start, idempotently and without a redeploy.
//
// ─── Why this exists ──────────────────────────────────────────────────────
// Migrations are normally applied by the deploy workflow via:
//
//     wrangler d1 migrations apply voxlink-db --remote
//
// That step can silently miss migrations in three real scenarios:
//   1. The push only touches non-api-server paths, so deploy-backend.yml
//      doesn't run at all (yet a new migration was committed alongside).
//   2. The Cloudflare API is flaky and the apply step fails — the deploy
//      job moves on to `wrangler deploy`, shipping code that references
//      columns that don't exist in production.
//   3. Someone runs `db:migrate` locally (`--local`) thinking it's `--remote`.
//
// The legacy `lib/schemaGuard.ts` papered over this for a hand-picked subset
// of migrations (0023, 0026–0029, engagement). It does not cover 0024, 0025,
// 0030, 0031, or 0032, so when the deploy step missed those, the production
// schema drifted and money-path queries silently failed (e.g. INR coin plans
// pricing showing as USD, default call rates falling back to hardcoded values).
//
// ─── How it works ─────────────────────────────────────────────────────────
// 1. Every *.sql file in /migrations is imported as a text string via the
//    `rules = [{ type = "Text", globs = ["**/*.sql"] }]` entry in
//    wrangler.toml. Adding a new migration is a one-line addition to
//    `MIGRATIONS` below.
//
// 2. Migration state is tracked in the same `d1_migrations` table that
//    Wrangler maintains, with the same column shape. Hand-applied migrations
//    via `wrangler d1 migrations apply --remote` and runtime auto-applied
//    migrations stay in lockstep — neither will re-run a migration the
//    other has already recorded.
//
// 3. On the first /api/* request after a cold start, any migration whose
//    filename is NOT in `d1_migrations` is parsed into individual statements
//    and executed. Each statement is wrapped in a try/catch that tolerates
//    "duplicate column name" / "table already exists" errors — this lets
//    the runner safely converge a DB whose schema was applied by hand
//    without a corresponding `d1_migrations` row (e.g. very old prod DBs
//    predating Wrangler's migration tracking).
//
// 4. Result is cached per worker isolate — subsequent requests in the same
//    isolate pay only a microtask cost.

// ─── Migration text imports ───────────────────────────────────────────────
// Order matters — keep this list sorted by filename. Add new migrations at
// the bottom in numeric order.
import m_0001 from '../../migrations/0001_initial.sql';
import m_0002 from '../../migrations/0002_user_favorites.sql';
import m_0003 from '../../migrations/0003_google_auth.sql';
import m_0004 from '../../migrations/0004_device_id.sql';
import m_0005 from '../../migrations/0005_admin_features.sql';
import m_0006 from '../../migrations/0006_cf_host_session.sql';
import m_0007 from '../../migrations/0007_rate_limits.sql';
import m_0008 from '../../migrations/0008_app_errors.sql';
import m_0009 from '../../migrations/0009_call_rate_per_minute.sql';
import m_0010 from '../../migrations/0010_user_status.sql';
import m_0011 from '../../migrations/0011_missing_tables.sql';
import m_0012 from '../../migrations/0012_performance_indexes.sql';
import m_0013 from '../../migrations/0013_token_rotation.sql';
import m_0014 from '../../migrations/0014_specialties_relational.sql';
import m_0015 from '../../migrations/0015_covering_indexes.sql';
import m_0016 from '../../migrations/0016_kyc_and_name_indexes.sql';
import m_0017 from '../../migrations/0017_call_track_names.sql';
import m_0018 from '../../migrations/0018_call_status_indexes_and_fixes.sql';
import m_0019 from '../../migrations/0019_clean_stuck_calls.sql';
import m_0020 from '../../migrations/0020_schema_fixes.sql';
import m_0021 from '../../migrations/0021_users_updated_at_index.sql';
import m_0022 from '../../migrations/0022_host_payout_method.sql';
import m_0023 from '../../migrations/0023_user_country_currency.sql';
import m_0024 from '../../migrations/0024_unique_manual_utr.sql';
import m_0025 from '../../migrations/0025_host_level_system.sql';
import m_0026 from '../../migrations/0026_random_call_features.sql';
import m_0027 from '../../migrations/0027_daily_streak.sql';
import m_0028 from '../../migrations/0028_first_call_free.sql';
import m_0029 from '../../migrations/0029_call_observability.sql';
import m_0030 from '../../migrations/0030_production_inr_coin_economy.sql';
import m_0031 from '../../migrations/0031_admin_default_call_rates.sql';
import m_0032 from '../../migrations/0032_coin_plans_inr_native.sql';
import m_0033 from '../../migrations/0033_perf_indexes_followup.sql';
import m_0034 from '../../migrations/0034_daily_streak_v2.sql';
import m_0035 from '../../migrations/0035_engagement_events.sql';
import m_0036 from '../../migrations/0036_user_blocks.sql';
import m_0037 from '../../migrations/0037_notification_preferences.sql';
import m_0038 from '../../migrations/0038_tips_and_gifts.sql';
import m_0039 from '../../migrations/0039_host_gallery.sql';
import m_0040 from '../../migrations/0040_call_heartbeat_freshness.sql';
import m_0041 from '../../migrations/0041_withdrawal_currency.sql';
import m_0042 from '../../migrations/0042_coin_economy_consistency.sql';
import m_0043 from '../../migrations/0043_reward_tasks.sql';
import m_0044 from '../../migrations/0044_reward_dopamine.sql';
import m_0045 from '../../migrations/0045_reward_trigger_counters.sql';
import m_0046 from '../../migrations/0046_achievement_windows.sql';

interface Migration {
  /**
   * Filename matching the entry Wrangler writes into `d1_migrations.name`
   * when `wrangler d1 migrations apply` runs. Must include the `.sql`
   * extension so manual + auto-apply paths agree on the key.
   */
  name: string;
  sql: string;
}

const MIGRATIONS: ReadonlyArray<Migration> = [
  { name: '0001_initial.sql',                       sql: m_0001 },
  { name: '0002_user_favorites.sql',                sql: m_0002 },
  { name: '0003_google_auth.sql',                   sql: m_0003 },
  { name: '0004_device_id.sql',                     sql: m_0004 },
  { name: '0005_admin_features.sql',                sql: m_0005 },
  { name: '0006_cf_host_session.sql',               sql: m_0006 },
  { name: '0007_rate_limits.sql',                   sql: m_0007 },
  { name: '0008_app_errors.sql',                    sql: m_0008 },
  { name: '0009_call_rate_per_minute.sql',          sql: m_0009 },
  { name: '0010_user_status.sql',                   sql: m_0010 },
  { name: '0011_missing_tables.sql',                sql: m_0011 },
  { name: '0012_performance_indexes.sql',           sql: m_0012 },
  { name: '0013_token_rotation.sql',                sql: m_0013 },
  { name: '0014_specialties_relational.sql',        sql: m_0014 },
  { name: '0015_covering_indexes.sql',              sql: m_0015 },
  { name: '0016_kyc_and_name_indexes.sql',          sql: m_0016 },
  { name: '0017_call_track_names.sql',              sql: m_0017 },
  { name: '0018_call_status_indexes_and_fixes.sql', sql: m_0018 },
  { name: '0019_clean_stuck_calls.sql',             sql: m_0019 },
  { name: '0020_schema_fixes.sql',                  sql: m_0020 },
  { name: '0021_users_updated_at_index.sql',        sql: m_0021 },
  { name: '0022_host_payout_method.sql',            sql: m_0022 },
  { name: '0023_user_country_currency.sql',         sql: m_0023 },
  { name: '0024_unique_manual_utr.sql',             sql: m_0024 },
  { name: '0025_host_level_system.sql',             sql: m_0025 },
  { name: '0026_random_call_features.sql',          sql: m_0026 },
  { name: '0027_daily_streak.sql',                  sql: m_0027 },
  { name: '0028_first_call_free.sql',               sql: m_0028 },
  { name: '0029_call_observability.sql',            sql: m_0029 },
  { name: '0030_production_inr_coin_economy.sql',   sql: m_0030 },
  { name: '0031_admin_default_call_rates.sql',      sql: m_0031 },
  { name: '0032_coin_plans_inr_native.sql',         sql: m_0032 },
  { name: '0033_perf_indexes_followup.sql',         sql: m_0033 },
  { name: '0034_daily_streak_v2.sql',               sql: m_0034 },
  { name: '0035_engagement_events.sql',             sql: m_0035 },
  { name: '0036_user_blocks.sql',                   sql: m_0036 },
  { name: '0037_notification_preferences.sql',      sql: m_0037 },
  { name: '0038_tips_and_gifts.sql',                sql: m_0038 },
  { name: '0039_host_gallery.sql',                  sql: m_0039 },
  { name: '0040_call_heartbeat_freshness.sql',      sql: m_0040 },
  { name: '0041_withdrawal_currency.sql',           sql: m_0041 },
  { name: '0042_coin_economy_consistency.sql',      sql: m_0042 },
  { name: '0043_reward_tasks.sql',                  sql: m_0043 },
  { name: '0044_reward_dopamine.sql',               sql: m_0044 },
  { name: '0045_reward_trigger_counters.sql',       sql: m_0045 },
  { name: '0046_achievement_windows.sql',           sql: m_0046 },
];

/**
 * Result of a single auto-migrate run. Returned by `runMigrations()` and the
 * admin diagnostic endpoint so an operator can verify what just happened.
 */
export interface AutoMigrateReport {
  /** Total migrations bundled into the worker. */
  total: number;
  /** Migrations whose row already existed in `d1_migrations` — skipped. */
  alreadyApplied: number;
  /** Migrations newly applied by THIS run. */
  applied: string[];
  /** Migrations attempted but failed mid-statement. */
  failed: string[];
  /** Per-statement warnings tolerated as already-applied (e.g. duplicate column). */
  warnings: number;
}

let cached: Promise<AutoMigrateReport> | null = null;

/**
 * Apply any pending migrations against the live D1 instance, idempotently.
 *
 * Cached per worker isolate — the heavy work runs at most once per cold
 * start. On hard failure the cache is cleared so the next request retries
 * instead of permanently locking the worker into a half-migrated state.
 *
 * Never throws to the caller. Downstream queries surface the original schema
 * error if a migration genuinely couldn't be applied; that error tells the
 * operator exactly what's broken.
 */
export function ensureAllMigrations(db: D1Database): Promise<AutoMigrateReport> {
  if (cached) return cached;
  cached = (async () => {
    const report: AutoMigrateReport = {
      total: MIGRATIONS.length,
      alreadyApplied: 0,
      applied: [],
      failed: [],
      warnings: 0,
    };
    try {
      // 1. Make sure the tracking table exists. Schema mirrors what Wrangler
      //    creates so `wrangler d1 migrations list` keeps working alongside
      //    runtime auto-apply.
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS d1_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ).run();

      // 2. Read the set of migrations already applied — single round-trip.
      const applied = await db
        .prepare('SELECT name FROM d1_migrations')
        .all<{ name: string }>();
      const appliedSet = new Set((applied.results ?? []).map((r) => r.name));
      report.alreadyApplied = appliedSet.size;

      // 3. Apply each pending migration in numeric order.
      for (const m of MIGRATIONS) {
        if (appliedSet.has(m.name)) continue;
        const stmts = splitSqlStatements(m.sql);
        try {
          for (const stmt of stmts) {
            try {
              await db.prepare(stmt).run();
            } catch (err) {
              // SQLite signals "this thing already exists" with very specific
              // error messages. Tolerating them lets the runner converge a
              // schema that was hand-applied without a `d1_migrations` row,
              // which is exactly the situation that prompted this fix.
              const msg = String((err as Error)?.message ?? err).toLowerCase();
              // SQLite signals "this thing already exists" with very specific
              // error fragments. Only those count as already-applied — anything
              // else (e.g. "no such column", "syntax error", "constraint
              // failed") is a real schema error and must propagate so the
              // migration is NOT marked applied.
              const isAlreadyApplied =
                msg.includes('duplicate column name') ||
                msg.includes('already exists');
              if (isAlreadyApplied) {
                report.warnings++;
                console.warn(
                  `[autoMigrate] ${m.name}: tolerated already-applied warning -- ${msg}`,
                );
                continue;
              }
              // Real schema/data error — bail out of this migration so we
              // DON'T mark it applied. Operator will see the failure in logs
              // and can fix the underlying issue.
              throw err;
            }
          }
          // Record the migration as applied. INSERT OR IGNORE handles the
          // race where two concurrent isolates raced on the same migration.
          await db
            .prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)')
            .bind(m.name)
            .run();
          report.applied.push(m.name);
          console.log(`[autoMigrate] applied ${m.name}`);
        } catch (err) {
          report.failed.push(m.name);
          console.error(`[autoMigrate] FAILED ${m.name}:`, err);
          // Stop here — applying later migrations on top of a failed earlier
          // one risks compounding schema corruption. Operator must intervene.
          break;
        }
      }

      if (report.applied.length > 0) {
        console.log(
          `[autoMigrate] complete: applied ${report.applied.length}, already-applied ${report.alreadyApplied}, failed ${report.failed.length}, tolerated ${report.warnings}`,
        );
      }
      return report;
    } catch (err) {
      // Catastrophic failure (e.g. d1_migrations CREATE failed). Clear the
      // cache so the next request retries — a transient D1 hiccup must not
      // permanently lock the isolate out of the auto-migrate path.
      console.error('[autoMigrate] catastrophic failure:', err);
      cached = null;
      report.failed.push('<bootstrap>');
      return report;
    }
  })();
  return cached;
}

/**
 * Read-only view of migration state. Used by the admin diagnostic endpoint
 * (`GET /api/admin/db/migrations`) so an operator can confirm the live DB
 * schema matches the deployed code.
 *
 * Does NOT trigger auto-apply — call `ensureAllMigrations()` for that.
 */
export async function listMigrationStatus(db: D1Database): Promise<{
  total: number;
  applied: Array<{ name: string; applied_at: string | null }>;
  pending: string[];
}> {
  // Make sure the tracking table exists before we read from it — otherwise
  // a brand-new DB returns "no such table: d1_migrations" instead of an
  // empty list.
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ).run();
  const rows = await db
    .prepare('SELECT name, applied_at FROM d1_migrations ORDER BY name ASC')
    .all<{ name: string; applied_at: string | null }>();
  const appliedSet = new Set((rows.results ?? []).map((r) => r.name));
  const pending = MIGRATIONS.filter((m) => !appliedSet.has(m.name)).map((m) => m.name);
  return {
    total: MIGRATIONS.length,
    applied: rows.results ?? [],
    pending,
  };
}

/**
 * Split a multi-statement SQL string into individual statements.
 *
 * Handles:
 *   - `--` line comments (stripped)
 *   - `/* ... *\/` block comments (stripped)
 *   - Single-quoted strings (semicolons inside a string don't terminate)
 *   - SQL `''` escape inside single-quoted strings
 *
 * Sufficient for our migrations, which don't use double-quoted identifiers
 * with embedded semicolons, dollar quoting, or other SQL-dialect exotica.
 *
 * Exported for unit testing.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inSingle = false;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];

    // -- line comment (only outside a string)
    if (!inSingle && c === '-' && n === '-') {
      const eol = sql.indexOf('\n', i);
      i = eol === -1 ? sql.length : eol + 1;
      buf += '\n'; // preserve line breaks so error messages line up
      continue;
    }

    // /* block comment */ (only outside a string)
    if (!inSingle && c === '/' && n === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? sql.length : close + 2;
      continue;
    }

    if (c === "'") {
      // SQL '' escape — both quotes belong to the string
      if (inSingle && n === "'") {
        buf += "''";
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      buf += c;
      i++;
      continue;
    }

    if (!inSingle && c === ';') {
      const stmt = buf.trim();
      if (stmt.length > 0) out.push(stmt);
      buf = '';
      i++;
      continue;
    }

    buf += c;
    i++;
  }
  const last = buf.trim();
  if (last.length > 0) out.push(last);
  return out;
}
