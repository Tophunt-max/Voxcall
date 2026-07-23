import { describe, it, expect, beforeEach } from 'vitest';
import { atomicGiftTransfer, reverseGiftTransfer, claimWithdrawal } from '../src/lib/transfers';
import { createTestDb, type FakeD1 } from './helpers/d1';

// Exercises the REAL SQL of two money-critical peer transfers against an actual
// SQLite engine: gift sends (user→host) and host withdrawal claims. Both must
// respect SPENDABLE balance (coins - coins_held) and be immune to the classic
// concurrency bugs — free credit for the recipient, negative balances, and the
// double-payout race on withdrawals.

let db: FakeD1;

beforeEach(() => {
  db = createTestDb();
  db.applySchema(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
      coins_held INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );
    CREATE TABLE withdrawal_requests (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      coins INTEGER NOT NULL,
      amount REAL,
      currency TEXT,
      payment_method TEXT,
      account_details TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
});

async function coins(id: string): Promise<number> {
  const r = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(id).first<{ coins: number }>();
  return r?.coins ?? -1;
}
async function pendingCount(hostId: string): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM withdrawal_requests WHERE host_id = ? AND status = 'pending'").bind(hostId).first<{ n: number }>();
  return Number(r?.n ?? -1);
}

// ─── atomicGiftTransfer ──────────────────────────────────────────────────────
describe('atomicGiftTransfer', () => {
  beforeEach(() => {
    db.applySchema("INSERT INTO users (id, coins, coins_held) VALUES ('sender', 100, 0), ('host', 0, 0);");
  });

  it('moves coins sender→host when affordable', async () => {
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 40 })).toBe(true);
    expect(await coins('sender')).toBe(60);
    expect(await coins('host')).toBe(40);
  });

  it('moves NOTHING when the sender is short (no free credit for the host)', async () => {
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 150 })).toBe(false);
    expect(await coins('sender')).toBe(100);
    expect(await coins('host')).toBe(0);
  });

  it('counts only SPENDABLE balance — held coins cannot be gifted', async () => {
    db.applySchema("UPDATE users SET coins_held = 80 WHERE id = 'sender';"); // spendable = 20
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 40 })).toBe(false);
    expect(await coins('sender')).toBe(100); // untouched
    // A gift within the spendable 20 still works.
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 20 })).toBe(true);
    expect(await coins('sender')).toBe(80);
    expect(await coins('host')).toBe(20);
  });

  it('rejects a self-gift and non-positive amounts', async () => {
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'sender', amount: 10 })).toBe(false);
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 0 })).toBe(false);
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: -5 })).toBe(false);
    expect(await coins('sender')).toBe(100);
  });

  it('two sequential gifts drain exactly — the second fails once spent out', async () => {
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 100 })).toBe(true);
    expect(await coins('sender')).toBe(0);
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 1 })).toBe(false);
    expect(await coins('host')).toBe(100); // only the first gift landed
  });
});

// ─── reverseGiftTransfer (gift compensation) ─────────────────────────────────
// When gift-send's post-transfer persistence (message + ledger) fails, the
// coin move must be reversed so a sender is never charged for a gift that did
// not save. A transfer + its reversal must net to zero on both wallets.
describe('reverseGiftTransfer', () => {
  beforeEach(() => {
    db.applySchema("INSERT INTO users (id, coins, coins_held) VALUES ('sender', 100, 0), ('host', 0, 0);");
  });

  it('a transfer followed by its reversal nets to zero on both wallets', async () => {
    expect(await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 40 })).toBe(true);
    expect(await coins('sender')).toBe(60);
    expect(await coins('host')).toBe(40);

    await reverseGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 40 });
    expect(await coins('sender')).toBe(100); // fully refunded
    expect(await coins('host')).toBe(0);     // credit reversed
  });

  it('refunds the sender even if the host has already spent the credit (unconditional)', async () => {
    await atomicGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 40 }); // host: 40
    db.applySchema("UPDATE users SET coins = 0 WHERE id = 'host';"); // host spent it all
    await reverseGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 40 });
    expect(await coins('sender')).toBe(100); // sender STILL made whole
    expect(await coins('host')).toBe(-40);   // host goes negative (owes it back)
  });

  it('is a no-op for self / non-positive amounts', async () => {
    await reverseGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'sender', amount: 40 });
    await reverseGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: 0 });
    await reverseGiftTransfer(db as any, { senderId: 'sender', hostUserId: 'host', amount: -5 });
    expect(await coins('sender')).toBe(100);
    expect(await coins('host')).toBe(0);
  });
});

// ─── claimWithdrawal ─────────────────────────────────────────────────────────
describe('claimWithdrawal', () => {
  beforeEach(() => {
    db.applySchema("INSERT INTO users (id, coins, coins_held) VALUES ('hostUser', 1000, 0);");
  });

  const base = {
    hostId: 'host1',
    userId: 'hostUser',
    coins: 500,
    localAmount: 42.5,
    currency: 'INR',
    method: 'bank',
    accountInfo: 'acct-123',
  };

  it('creates a pending request and debits spendable balance', async () => {
    const res = await claimWithdrawal(db as any, { ...base, withdrawId: 'w1' });
    expect(res).toEqual({ ok: true });
    expect(await coins('hostUser')).toBe(500); // 1000 - 500
    expect(await pendingCount('host1')).toBe(1);
  });

  it('prevents the 2× payout race — a second concurrent claim is rejected as pending, no double debit', async () => {
    expect(await claimWithdrawal(db as any, { ...base, withdrawId: 'w1' })).toEqual({ ok: true });
    // Second request while the first is still pending.
    const second = await claimWithdrawal(db as any, { ...base, withdrawId: 'w2' });
    expect(second).toEqual({ ok: false, reason: 'pending' });
    expect(await coins('hostUser')).toBe(500); // debited only ONCE
    expect(await pendingCount('host1')).toBe(1); // only ONE pending row
  });

  it('rejects when spendable balance is insufficient and inserts no row', async () => {
    const res = await claimWithdrawal(db as any, { ...base, withdrawId: 'w1', coins: 5000 });
    expect(res).toEqual({ ok: false, reason: 'insufficient' });
    expect(await coins('hostUser')).toBe(1000); // untouched
    expect(await pendingCount('host1')).toBe(0); // no ghost row
  });

  it('excludes held coins from withdrawal (spendable = coins - coins_held)', async () => {
    db.applySchema("UPDATE users SET coins_held = 700 WHERE id = 'hostUser';"); // spendable = 300
    const res = await claimWithdrawal(db as any, { ...base, withdrawId: 'w1', coins: 500 });
    expect(res).toEqual({ ok: false, reason: 'insufficient' });
    expect(await coins('hostUser')).toBe(1000);
    expect(await pendingCount('host1')).toBe(0);
  });

  it('allows a fresh withdrawal once the prior request is no longer pending', async () => {
    expect(await claimWithdrawal(db as any, { ...base, withdrawId: 'w1' })).toEqual({ ok: true });
    // Admin approves (or rejects) → status leaves 'pending'.
    db.applySchema("UPDATE withdrawal_requests SET status = 'approved' WHERE id = 'w1';");
    const res = await claimWithdrawal(db as any, { ...base, withdrawId: 'w2', coins: 200 });
    expect(res).toEqual({ ok: true });
    expect(await coins('hostUser')).toBe(300); // 1000 - 500 - 200
    expect(await pendingCount('host1')).toBe(1);
  });
});
