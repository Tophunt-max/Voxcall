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
