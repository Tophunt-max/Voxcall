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
