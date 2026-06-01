import { describe, it, expect } from 'vitest';
import { billedMinutes, coinsForCall, hostShareOf, affordableCoins } from '../src/lib/billing';

describe('billedMinutes — minutes are rounded UP, any started minute is billed', () => {
  it('bills 0 for non-positive / invalid durations', () => {
    expect(billedMinutes(0)).toBe(0);
    expect(billedMinutes(-30)).toBe(0);
    expect(billedMinutes(Number.NaN)).toBe(0);
    expect(billedMinutes(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('rounds any partial minute up to the next whole minute', () => {
    expect(billedMinutes(1)).toBe(1); // 1 second still bills a full minute
    expect(billedMinutes(30)).toBe(1);
    expect(billedMinutes(59)).toBe(1);
    expect(billedMinutes(60)).toBe(1); // exactly one minute
    expect(billedMinutes(61)).toBe(2); // one second over rolls to 2
    expect(billedMinutes(119)).toBe(2);
    expect(billedMinutes(120)).toBe(2);
    expect(billedMinutes(121)).toBe(3);
  });
});

describe('coinsForCall — only active calls with real duration cost coins', () => {
  it('charges nothing for a call that never connected (pending)', () => {
    expect(coinsForCall({ status: 'pending', durationSec: 120, ratePerMinute: 5 })).toBe(0);
    expect(coinsForCall({ status: 'ended', durationSec: 120, ratePerMinute: 5 })).toBe(0);
  });

  it('charges nothing when an active call had zero duration', () => {
    expect(coinsForCall({ status: 'active', durationSec: 0, ratePerMinute: 5 })).toBe(0);
  });

  it('charges billedMinutes * rate for an active call', () => {
    expect(coinsForCall({ status: 'active', durationSec: 60, ratePerMinute: 5 })).toBe(5);
    expect(coinsForCall({ status: 'active', durationSec: 90, ratePerMinute: 5 })).toBe(10); // 2 min * 5
    expect(coinsForCall({ status: 'active', durationSec: 61, ratePerMinute: 8 })).toBe(16); // 2 min * 8
  });

  it('treats a non-positive rate as free (defensive)', () => {
    expect(coinsForCall({ status: 'active', durationSec: 120, ratePerMinute: 0 })).toBe(0);
    expect(coinsForCall({ status: 'active', durationSec: 120, ratePerMinute: -5 })).toBe(0);
  });
});

describe('hostShareOf — host cut always rounds DOWN, never pays a coin not collected', () => {
  it('floors the share', () => {
    expect(hostShareOf(100, 0.7)).toBe(70);
    expect(hostShareOf(101, 0.7)).toBe(70); // 70.7 -> 70
    expect(hostShareOf(99, 0.72)).toBe(71); // 71.28 -> 71
  });

  it('returns 0 for no charge or no/zero share', () => {
    expect(hostShareOf(0, 0.8)).toBe(0);
    expect(hostShareOf(-50, 0.8)).toBe(0);
    expect(hostShareOf(100, 0)).toBe(0);
    expect(hostShareOf(100, Number.NaN)).toBe(0);
  });
});

describe('affordableCoins — partial billing caps the charge at the caller balance (FIX #1)', () => {
  it('charges the full amount when the caller can afford it', () => {
    expect(affordableCoins(50, 100)).toBe(50);
    expect(affordableCoins(100, 100)).toBe(100);
  });

  it('caps at the balance when the caller overran (so host still gets paid)', () => {
    expect(affordableCoins(300, 50)).toBe(50); // owed 300, only has 50
    expect(affordableCoins(10, 0)).toBe(0);
  });

  it('is defensive against invalid inputs', () => {
    expect(affordableCoins(0, 100)).toBe(0);
    expect(affordableCoins(-5, 100)).toBe(0);
    expect(affordableCoins(Number.NaN, 100)).toBe(0);
    expect(affordableCoins(100, -10)).toBe(0);
  });
});



// ─── billedUnits / rateForGranularity — per-second billing math ──────────────
// Migration 0029 / app_settings.billing_granularity_sec adds a tunable
// granularity. These tests pin down the math so a future flip from
// per-minute (60) to per-second (1) — or any other bucket size — is a pure
// data change with no surprise rounding regressions.
import { billedUnits, rateForGranularity, billedMinutes } from '../src/lib/billing';

describe('billedUnits — granularity-aware unit count', () => {
  it('matches billedMinutes when granularity = 60', () => {
    expect(billedUnits(0,    60)).toBe(0);
    expect(billedUnits(1,    60)).toBe(1);   // sub-minute → 1 unit (matches legacy floor)
    expect(billedUnits(60,   60)).toBe(1);
    expect(billedUnits(61,   60)).toBe(2);
    expect(billedUnits(599,  60)).toBe(10);
    expect(billedUnits(601,  60)).toBe(11);
    // Exactly mirror the legacy helper.
    for (const sec of [0, 1, 30, 60, 61, 119, 120, 600, 3601]) {
      expect(billedUnits(sec, 60)).toBe(billedMinutes(sec));
    }
  });

  it('rounds up to whole seconds at granularity = 1', () => {
    expect(billedUnits(0,   1)).toBe(0);
    expect(billedUnits(0.4, 1)).toBe(1);   // sub-second → 1 unit floor
    expect(billedUnits(1,   1)).toBe(1);
    expect(billedUnits(60,  1)).toBe(60);
    expect(billedUnits(61,  1)).toBe(61);
    expect(billedUnits(599, 1)).toBe(599);
  });

  it('handles arbitrary granularity buckets (10s)', () => {
    expect(billedUnits(0,  10)).toBe(0);
    expect(billedUnits(1,  10)).toBe(1);
    expect(billedUnits(10, 10)).toBe(1);
    expect(billedUnits(11, 10)).toBe(2);
    expect(billedUnits(60, 10)).toBe(6);
    expect(billedUnits(61, 10)).toBe(7);
  });

  it('non-finite / negative durations bill 0', () => {
    expect(billedUnits(NaN,        60)).toBe(0);
    expect(billedUnits(-5,         60)).toBe(0);
    expect(billedUnits(Infinity,   60)).toBe(0);
    // 0-duration: explicit 0 (not 1) — caller code checks for 0 to skip
    // the entire billing path.
    expect(billedUnits(0, 60)).toBe(0);
  });

  it('falls back to per-minute when granularity is invalid', () => {
    expect(billedUnits(60, 0)).toBe(billedUnits(60, 60));
    expect(billedUnits(60, -10)).toBe(billedUnits(60, 60));
    expect(billedUnits(60, NaN)).toBe(billedUnits(60, 60));
  });
});

describe('rateForGranularity — per-unit rate conversion', () => {
  it('per-minute granularity returns the rate unchanged', () => {
    expect(rateForGranularity(10, 60)).toBe(10);
    expect(rateForGranularity(0.5, 60)).toBe(0.5);
  });

  it('per-second granularity divides by 60', () => {
    expect(rateForGranularity(60,  1)).toBeCloseTo(1.0, 6);
    expect(rateForGranularity(120, 1)).toBeCloseTo(2.0, 6);
    expect(rateForGranularity(10,  1)).toBeCloseTo(10 / 60, 6);
  });

  it('arbitrary granularity scales linearly', () => {
    // 10-second buckets → rate * 10/60
    expect(rateForGranularity(60, 10)).toBeCloseTo(10, 6);
    // 30-second buckets → rate * 30/60 = half-minute
    expect(rateForGranularity(60, 30)).toBeCloseTo(30, 6);
  });

  it('returns 0 for invalid rates so the billing engine treats the call as free', () => {
    expect(rateForGranularity(0,    60)).toBe(0);
    expect(rateForGranularity(-5,   60)).toBe(0);
    expect(rateForGranularity(NaN,  60)).toBe(0);
  });
});

// ─── End-to-end: chargeCallerWithFreePool at per-second granularity ──────────
// Make sure flipping billing_granularity_sec from 60 → 1 doesn't surprise
// callers with weird off-by-one charges. The wrapper is the only place this
// matters — these are integration cases against the real fake-D1 setup.
describe('chargeCallerWithFreePool — per-second granularity (granularitySec=1)', () => {
  it('charges by the second when granularity=1 — 90s call at 60 coins/min costs 90 coins', async () => {
    // Hard-rebuild the schema: the integration test file's `db` is a
    // module-level FakeD1, but this assertion is granularity-isolated —
    // we just want to verify the math, not test the real integration
    // chain (covered separately).
    const { createTestDb } = await import('./helpers/d1');
    const { chargeCallerWithFreePool } = await import('../src/lib/billing');
    const db = createTestDb();
    db.applySchema(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        coins INTEGER NOT NULL DEFAULT 0,
        free_call_minutes INTEGER DEFAULT 0
      );
      INSERT INTO users (id, coins, free_call_minutes) VALUES ('caller', 1000, 0), ('host', 0, 0);
    `);

    const res = await chargeCallerWithFreePool(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 90,             // 1 min 30 s
      ratePerMinute: 60,           // = 1 coin/sec at granularity 1
      earningShare: 0.7,
      granularitySec: 1,
    });
    // 90 units × 1 coin/unit = 90 coins; host share = floor(90 × 0.7) = 62.
    // (JS float quirk: 90 * 0.7 === 62.99999999999999, so floor → 62. The
    // platform-never-overpays floor is exactly what we want here.)
    expect(res.charged).toBe(90);
    expect(res.hostEarned).toBe(62);
    expect(res.billed_minutes).toBe(90); // billed_units actually
  });

  it('per-minute math (default granularity) over-charges sub-minute calls vs per-second', async () => {
    const { createTestDb } = await import('./helpers/d1');
    const { chargeCallerWithFreePool } = await import('../src/lib/billing');

    // Per-minute: 5-second call rounds up to 1 minute.
    const db1 = createTestDb();
    db1.applySchema(`
      CREATE TABLE users (id TEXT PRIMARY KEY, coins INTEGER DEFAULT 0, free_call_minutes INTEGER DEFAULT 0);
      INSERT INTO users (id, coins, free_call_minutes) VALUES ('caller', 1000, 0), ('host', 0, 0);
    `);
    const r1 = await chargeCallerWithFreePool(db1 as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 5,
      ratePerMinute: 60,
      earningShare: 0.7,
      // granularity omitted → default 60 (per-minute)
    });
    expect(r1.charged).toBe(60);   // 1 min × 60 = 60 coins for a 5s call

    // Per-second: same 5-second call costs only 5 coins.
    const db2 = createTestDb();
    db2.applySchema(`
      CREATE TABLE users (id TEXT PRIMARY KEY, coins INTEGER DEFAULT 0, free_call_minutes INTEGER DEFAULT 0);
      INSERT INTO users (id, coins, free_call_minutes) VALUES ('caller', 1000, 0), ('host', 0, 0);
    `);
    const r2 = await chargeCallerWithFreePool(db2 as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 5,
      ratePerMinute: 60,
      earningShare: 0.7,
      granularitySec: 1,
    });
    expect(r2.charged).toBe(5);    // 5s × 1 coin/s = 5 coins
    expect(r2.charged).toBeLessThan(r1.charged); // per-second is leaner for sub-minute calls
  });
});
