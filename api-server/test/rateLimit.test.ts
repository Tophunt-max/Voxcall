import { describe, it, expect, beforeEach } from 'vitest';
import { registerHit, checkRateLimit } from '../src/lib/rateLimit';
import { createTestDb, type FakeD1 } from './helpers/d1';

// Proves the atomic INSERT…ON CONFLICT…RETURNING limiter (FIX #7) against a real
// SQLite engine: counts increment correctly, the cap triggers at the right hit,
// and an expired window resets — none of which the old read-then-write code
// could guarantee under concurrency.

let db: FakeD1;

beforeEach(() => {
  db = createTestDb();
  db.applySchema(`
    CREATE TABLE rate_limits (
      id           TEXT PRIMARY KEY,
      attempts     INTEGER NOT NULL DEFAULT 1,
      window_reset INTEGER NOT NULL
    );
  `);
});

describe('registerHit', () => {
  it('increments on each hit and flags limited only after the cap is exceeded', async () => {
    const max = 3;
    const r1 = await registerHit(db as any, 'k', max, 60);
    const r2 = await registerHit(db as any, 'k', max, 60);
    const r3 = await registerHit(db as any, 'k', max, 60);
    const r4 = await registerHit(db as any, 'k', max, 60);

    expect([r1.attempts, r2.attempts, r3.attempts, r4.attempts]).toEqual([1, 2, 3, 4]);
    expect(r1.limited).toBe(false);
    expect(r2.limited).toBe(false);
    expect(r3.limited).toBe(false); // exactly at cap — allowed
    expect(r4.limited).toBe(true); // over the cap — blocked
  });

  it('tracks distinct keys independently', async () => {
    await registerHit(db as any, 'a', 5, 60);
    const b = await registerHit(db as any, 'b', 5, 60);
    expect(b.attempts).toBe(1);
  });

  it('resets the counter once the window has expired', async () => {
    // Seed an already-expired window (window_reset in the past).
    db.applySchema("INSERT INTO rate_limits (id, attempts, window_reset) VALUES ('k', 9, 1);");
    const r = await registerHit(db as any, 'k', 3, 60);
    expect(r.attempts).toBe(1); // reset, not 10
    expect(r.limited).toBe(false);
  });

  it('reports a positive retryAfter within the window', async () => {
    const r = await registerHit(db as any, 'k', 1, 60);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });
});

describe('checkRateLimit (fail-open wrapper)', () => {
  it('returns not-limited when the table is missing instead of throwing', async () => {
    const freshDb = createTestDb(); // no rate_limits table
    const r = await checkRateLimit(freshDb as any, 'k', 3, 60);
    expect(r.limited).toBe(false);
  });
});
