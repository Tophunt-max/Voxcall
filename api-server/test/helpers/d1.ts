// ============================================================================
// Minimal D1Database test double backed by Node's built-in SQLite
// ============================================================================
//
// We deliberately avoid the official `@cloudflare/vitest-pool-workers` here:
// `workerd` cannot start in CPU-restricted CI/sandbox containers, which would
// make the money-path tests un-runnable in exactly the environment that needs
// to gate deploys. Instead we run the *real* SQL of the production code paths
// (atomic coin transfer, webhook deposit CAS) against Node 22's `node:sqlite`
// — the same SQLite engine D1 is built on — so the tests are hermetic, fast,
// dependency-free, and behave identically locally and in CI.
//
// This implements only the slice of the D1 API the tested code uses:
//   prepare().bind().first() / .run() / .all(), and db.batch([...]).
// ============================================================================

import type { DatabaseSync } from 'node:sqlite';

// Load `node:sqlite` via the runtime builtin accessor rather than a static
// value import. Vite (used by Vitest to transform test files) does not yet
// recognize the newer `node:sqlite` builtin and would try to bundle it as
// `sqlite`; `process.getBuiltinModule` is a plain runtime call Vite leaves
// untouched. The `import type` above is erased at compile time (no runtime
// import) and only provides the `DatabaseSync` type for annotations below.
const { DatabaseSync: SqliteDatabase } =
  process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

// node:sqlite throws on `undefined` params; D1 treats a missing value as NULL.
function normParams(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

class FakeStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, normParams(params));
  }

  async first<T = any>(colName?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as
      | Record<string, unknown>
      | undefined;
    if (row === undefined || row === null) return null;
    if (colName) return (row[colName] ?? null) as T;
    return row as T;
  }

  async run(): Promise<{
    success: true;
    meta: {
      changes: number;
      last_row_id: number;
      duration: number;
      rows_read: number;
      rows_written: number;
    };
  }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    const changes = Number(info.changes);
    return {
      success: true,
      meta: {
        changes,
        last_row_id: Number(info.lastInsertRowid),
        duration: 0,
        rows_read: 0,
        rows_written: changes,
      },
    };
  }

  async all<T = any>(): Promise<{ success: true; results: T[] }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { success: true, results: rows };
  }
}

export class FakeD1 {
  readonly sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new SqliteDatabase(':memory:');
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this.sqlite, sql);
  }

  // D1 batch is an implicit transaction — mirror that with BEGIN/COMMIT so a
  // failure mid-batch rolls back, matching production atomicity guarantees.
  async batch(statements: FakeStatement[]): Promise<unknown[]> {
    this.sqlite.exec('BEGIN');
    try {
      const results: unknown[] = [];
      for (const st of statements) results.push(await st.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (err) {
      try {
        this.sqlite.exec('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql);
    return { count: 0, duration: 0 };
  }

  /** Test-only convenience: run raw schema/seed DDL+DML. */
  applySchema(sql: string): void {
    this.sqlite.exec(sql);
  }
}

/** Create a fresh in-memory D1-compatible database for a test. */
export function createTestDb(): FakeD1 {
  return new FakeD1();
}
