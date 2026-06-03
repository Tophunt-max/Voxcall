import { describe, it, expect, beforeEach } from 'vitest';
import { atomicCallTransfer } from '../src/lib/billing';
import { createTestDb, type FakeD1 } from './helpers/d1';

// Exercises the REAL SQL of the caller -> host coin transfer against an actual
// SQLite engine. This is the single most safety-critical money path: it must
// be impossible to credit the host without debiting the caller, even when the
// caller is short on coins.

let db: FakeD1;

beforeEach(() => {
  db = createTestDb();
  db.applySchema(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO users (id, coins) VALUES ('caller', 100), ('host', 0);
  `);
});

async function coins(id: string): Promise<number> {
  const row = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(id).first<{ coins: number }>();
  return row?.coins ?? -1;
}

describe('atomicCallTransfer', () => {
  it('moves coins from caller to host when the caller has enough', async () => {
    const ok = await atomicCallTransfer(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      coinsCharged: 50,
      hostShare: 35,
    });
    expect(ok).toBe(true);
    expect(await coins('caller')).toBe(50); // 100 - 50
    expect(await coins('host')).toBe(35); // 0 + 35 (platform keeps 15)
  });

  it('moves NOTHING when the caller is short on coins (no free credit for host)', async () => {
    db.applySchema("UPDATE users SET coins = 10 WHERE id = 'caller';");
    const ok = await atomicCallTransfer(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      coinsCharged: 50,
      hostShare: 35,
    });
    expect(ok).toBe(false);
    // Critical invariant: neither balance changed.
    expect(await coins('caller')).toBe(10);
    expect(await coins('host')).toBe(0);
  });

  it('is a no-op when there is nothing to charge', async () => {
    expect(
      await atomicCallTransfer(db as any, {
        callerId: 'caller',
        hostUserId: 'host',
        coinsCharged: 0,
        hostShare: 0,
      }),
    ).toBe(false);
    expect(await coins('caller')).toBe(100);
    expect(await coins('host')).toBe(0);
  });

  it('is a no-op when the host user id is missing', async () => {
    expect(
      await atomicCallTransfer(db as any, {
        callerId: 'caller',
        hostUserId: '',
        coinsCharged: 50,
        hostShare: 35,
      }),
    ).toBe(false);
    expect(await coins('caller')).toBe(100);
  });
});


// ─── chargeCallerAffordable — partial/best-effort billing (FIX #1) ───────────
// This is the core fairness fix: when a caller overruns their balance, the host
// must still be paid for the talk-time (their share of what was actually
// collected), instead of the old all-or-nothing behaviour that paid the host 0.
import { chargeCallerAffordable } from '../src/lib/billing';

describe('chargeCallerAffordable', () => {
  it('charges the full amount + pays host share when the caller can afford it', async () => {
    const res = await chargeCallerAffordable(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      coinsCharged: 50,
      earningShare: 0.7,
    });
    expect(res).toEqual({ charged: 50, hostEarned: 35 });
    expect(await coins('caller')).toBe(50);
    expect(await coins('host')).toBe(35);
  });

  it('caps the charge at the caller balance and STILL pays the host (overrun)', async () => {
    db.applySchema("UPDATE users SET coins = 30 WHERE id = 'caller';");
    const res = await chargeCallerAffordable(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      coinsCharged: 50, // owed more than they have
      earningShare: 0.7,
    });
    // Charged what they had (30); host earns floor(30 * 0.7) = 21 — NOT 0.
    expect(res).toEqual({ charged: 30, hostEarned: 21 });
    expect(await coins('caller')).toBe(0);
    expect(await coins('host')).toBe(21);
  });

  it('charges nothing when the caller has zero coins', async () => {
    db.applySchema("UPDATE users SET coins = 0 WHERE id = 'caller';");
    const res = await chargeCallerAffordable(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      coinsCharged: 50,
      earningShare: 0.7,
    });
    expect(res).toEqual({ charged: 0, hostEarned: 0 });
    expect(await coins('host')).toBe(0);
  });
});



// ─── chargeCallerWithFreePool — first-call-free trial billing ────────────────
// Layer 4 engagement: the user's free_call_minutes pool is consumed BEFORE
// the coin balance, but the host is paid in full for the entire call (the
// platform absorbs the free portion as a customer-acquisition expense).
// These tests pin down all four corner cases so a future billing refactor
// can't silently regress the trial UX.
import { chargeCallerWithFreePool } from '../src/lib/billing';

describe('chargeCallerWithFreePool', () => {
  beforeEach(() => {
    // Re-seed with a free_call_minutes column so the wrapper can read it.
    db = createTestDb();
    db.applySchema(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        coins INTEGER NOT NULL DEFAULT 0,
        free_call_minutes INTEGER DEFAULT 0
      );
      INSERT INTO users (id, coins, free_call_minutes) VALUES ('caller', 1000, 0), ('host', 0, 0);
    `);
  });

  async function pool(id: string): Promise<number> {
    const row = await db
      .prepare('SELECT free_call_minutes FROM users WHERE id = ?')
      .bind(id)
      .first<{ free_call_minutes: number }>();
    return row?.free_call_minutes ?? -1;
  }

  it('legacy path: 0 free minutes → behaves like chargeCallerAffordable', async () => {
    // 5-minute call at 10 coins/min, 70% earning share. Caller has 1000
    // coins, no free pool. Should charge 50, pay host 35.
    const res = await chargeCallerWithFreePool(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 5 * 60,
      ratePerMinute: 10,
      earningShare: 0.7,
    });
    expect(res.charged).toBe(50);
    expect(res.hostEarned).toBe(35);
    expect(res.free_minutes_used).toBe(0);
    expect(res.billed_minutes).toBe(5);
    expect(await coins('caller')).toBe(950);
    expect(await coins('host')).toBe(35);
  });

  it('all-free path: free pool covers the whole call → caller pays nothing, host paid in full', async () => {
    db.applySchema("UPDATE users SET free_call_minutes = 5 WHERE id = 'caller';");
    const res = await chargeCallerWithFreePool(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 5 * 60,
      ratePerMinute: 10,
      earningShare: 0.7,
    });
    expect(res.charged).toBe(0);
    // Host still paid for ALL 5 minutes — platform absorbs the free cost.
    // 5 × 10 × 0.7 = 35.
    expect(res.hostEarned).toBe(35);
    expect(res.free_minutes_used).toBe(5);
    expect(await coins('caller')).toBe(1000); // unchanged
    expect(await coins('host')).toBe(35);
    expect(await pool('caller')).toBe(0); // pool drained
  });

  it('partial-free path: free pool covers only the first N minutes', async () => {
    db.applySchema("UPDATE users SET free_call_minutes = 3 WHERE id = 'caller';");
    // 5-minute call: 3 free + 2 paid → caller charged 2 × 10 = 20.
    // Host paid for ALL 5 minutes → 5 × 10 × 0.7 = 35 (floor).
    const res = await chargeCallerWithFreePool(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 5 * 60,
      ratePerMinute: 10,
      earningShare: 0.7,
    });
    expect(res.charged).toBe(20);
    expect(res.hostEarned).toBe(35);
    expect(res.free_minutes_used).toBe(3);
    expect(res.billed_minutes).toBe(5);
    expect(await coins('caller')).toBe(980);
    expect(await coins('host')).toBe(35);
    expect(await pool('caller')).toBe(0);
  });

  it('drains the pool exactly — pool larger than call duration is preserved beyond the call', async () => {
    db.applySchema("UPDATE users SET free_call_minutes = 10 WHERE id = 'caller';");
    // 5-minute call uses 5 of 10 free minutes. Caller pays 0, host paid full.
    // Pool should be 5 after.
    const res = await chargeCallerWithFreePool(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 5 * 60,
      ratePerMinute: 10,
      earningShare: 0.7,
    });
    expect(res.free_minutes_used).toBe(5);
    expect(res.charged).toBe(0);
    expect(res.hostEarned).toBe(35);
    expect(await pool('caller')).toBe(5); // 10 - 5
  });

  it('respects best-effort billing on partial-free path when caller cannot afford the paid portion', async () => {
    // Pool = 2 min, call = 5 min, rate = 10/min → 3 paid minutes = 30 coins.
    // Caller has 15 → only 15 charged; host paid for free minutes + collected share.
    db.applySchema("UPDATE users SET free_call_minutes = 2, coins = 15 WHERE id = 'caller';");
    const res = await chargeCallerWithFreePool(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 5 * 60,
      ratePerMinute: 10,
      earningShare: 0.7,
    });
    expect(res.free_minutes_used).toBe(2);
    expect(res.charged).toBe(15); // capped at caller's 15-coin balance
    // Host is paid for the free portion by the platform (2 × 10 × 0.7 = 14)
    // plus the share of what the caller could actually pay (15 × 0.7 = 10).
    // The non-free overrun is not credited without a matching caller debit.
    expect(res.hostEarned).toBe(24);
    expect(await coins('caller')).toBe(0);
    expect(await coins('host')).toBe(24);
    expect(await pool('caller')).toBe(0);
  });

  it('returns zeros for a 0-second / pending-style call', async () => {
    db.applySchema("UPDATE users SET free_call_minutes = 5 WHERE id = 'caller';");
    const res = await chargeCallerWithFreePool(db as any, {
      callerId: 'caller',
      hostUserId: 'host',
      durationSec: 0,
      ratePerMinute: 10,
      earningShare: 0.7,
    });
    expect(res.charged).toBe(0);
    expect(res.hostEarned).toBe(0);
    expect(res.free_minutes_used).toBe(0);
    expect(res.billed_minutes).toBe(0);
    // Pool untouched on a 0-min call.
    expect(await pool('caller')).toBe(5);
    expect(await coins('caller')).toBe(1000);
  });
});
