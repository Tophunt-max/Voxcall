import { describe, it, expect, beforeEach } from 'vitest';
import { approveDeposit } from '../src/routes/payment';
import { createTestDb, type FakeD1 } from './helpers/d1';

// Webhook idempotency is the second critical money path: payment gateways
// retry webhooks, and a user may also confirm a purchase manually. Crediting
// the same purchase twice = free coins. approveDeposit guards this with an
// atomic compare-and-set on the purchase status; these tests prove it against
// a real SQLite engine.

let db: FakeD1;

beforeEach(() => {
  db = createTestDb();
  db.applySchema(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );
    CREATE TABLE coin_purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      bonus_coins INTEGER NOT NULL DEFAULT 0,
      amount REAL,
      currency TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_method TEXT,
      promo_code TEXT,
      updated_at INTEGER
    );
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    );
    CREATE TABLE app_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      message TEXT,
      stack TEXT,
      context TEXT,
      platform TEXT,
      app_version TEXT,
      extra TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'bonus',
      discount_pct INTEGER DEFAULT 0,
      bonus_coins INTEGER DEFAULT 0,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER
    );
    CREATE TABLE coin_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT,
      ref_id TEXT
    );
    INSERT INTO users (id, coins) VALUES ('u1', 0);
    INSERT INTO coin_purchases (id, user_id, coins, bonus_coins, status)
      VALUES ('p1', 'u1', 100, 20, 'pending');
  `);
});

async function userCoins(id: string): Promise<number> {
  const row = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(id).first<{ coins: number }>();
  return row?.coins ?? -1;
}

async function txCount(): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as n FROM coin_transactions').first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe('approveDeposit', () => {
  it('credits coins + bonus exactly once on first approval', async () => {
    const res = await approveDeposit(db as any, 'p1', 'razorpay');
    expect(res.ok).toBe(true);
    expect(res.already).toBeUndefined();
    expect(res.coins).toBe(120); // 100 + 20 bonus
    expect(await userCoins('u1')).toBe(120);
    expect(await txCount()).toBe(1);

    const purchase = await db
      .prepare('SELECT status FROM coin_purchases WHERE id = ?')
      .bind('p1')
      .first<{ status: string }>();
    expect(purchase?.status).toBe('success');
  });

  it('is idempotent — a retried webhook does NOT double-credit', async () => {
    await approveDeposit(db as any, 'p1', 'razorpay');
    const retry = await approveDeposit(db as any, 'p1', 'razorpay');

    expect(retry.ok).toBe(true);
    expect(retry.already).toBe(true);
    // Balance and ledger are unchanged by the duplicate delivery.
    expect(await userCoins('u1')).toBe(120);
    expect(await txCount()).toBe(1);
  });

  it('reports notFound for an unknown purchase id', async () => {
    const res = await approveDeposit(db as any, 'does-not-exist', 'razorpay');
    expect(res.ok).toBe(false);
    expect(res.notFound).toBe(true);
    expect(await txCount()).toBe(0);
  });
});

describe('approveDeposit promo max_uses enforcement (FIX #2)', () => {
  async function promoUsed(code: string): Promise<number> {
    const row = await db.prepare('SELECT used_count FROM promo_codes WHERE code = ?').bind(code).first<{ used_count: number }>();
    return Number(row?.used_count ?? -1);
  }

  it('consumes one promo use at credit time and grants the bonus while quota remains', async () => {
    db.applySchema(`
      INSERT INTO promo_codes (id, code, type, bonus_coins, max_uses, used_count) VALUES ('pr1', 'WELCOME', 'bonus', 20, 5, 0);
      INSERT INTO coin_purchases (id, user_id, coins, bonus_coins, status, promo_code) VALUES ('p2', 'u1', 100, 20, 'pending', 'WELCOME');
    `);
    const res = await approveDeposit(db as any, 'p2', 'razorpay');
    expect(res.ok).toBe(true);
    expect(res.coins).toBe(120); // base 100 + promo bonus 20 granted
    expect(await promoUsed('WELCOME')).toBe(1); // usage advanced
  });

  it('strips the promo bonus when the quota is already exhausted', async () => {
    db.applySchema(`
      INSERT INTO promo_codes (id, code, type, bonus_coins, max_uses, used_count) VALUES ('pr2', 'MAXED', 'bonus', 20, 1, 1);
      INSERT INTO coin_purchases (id, user_id, coins, bonus_coins, status, promo_code) VALUES ('p3', 'u1', 100, 20, 'pending', 'MAXED');
    `);
    const res = await approveDeposit(db as any, 'p3', 'razorpay');
    expect(res.ok).toBe(true);
    expect(res.coins).toBe(100); // promo bonus (20) stripped — quota was full
    expect(await promoUsed('MAXED')).toBe(1); // not incremented beyond max
  });
});

// ─── Amount / currency defense-in-depth (Task #6 hardening) ──────────────────
// The gateway-reported captured amount is checked against the expected purchase
// price. A mismatch ALWAYS raises an admin alert (app_errors); it only BLOCKS
// the credit when the operator opts in via payment_enforce_amount = '1'.
describe('approveDeposit amount/currency verification', () => {
  async function alerts(): Promise<number> {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM app_errors WHERE context = 'payment_amount_mismatch'").first<{ n: number }>();
    return Number(row?.n ?? 0);
  }

  beforeEach(() => {
    db.applySchema(`
      INSERT INTO coin_purchases (id, user_id, coins, bonus_coins, amount, currency, status)
        VALUES ('pa', 'u1', 500, 0, 100, 'INR', 'pending');
    `);
  });

  it('credits normally when the paid amount + currency match (within tolerance)', async () => {
    const res = await approveDeposit(db as any, 'pa', 'razorpay', undefined, undefined, { amount: 100, currency: 'INR' });
    expect(res.ok).toBe(true);
    expect(res.coins).toBe(500);
    expect(await userCoins('u1')).toBe(500);
    expect(await alerts()).toBe(0);
  });

  it('log-only by default: underpayment raises an alert but STILL credits (never bounce a real payment pre-validation)', async () => {
    const res = await approveDeposit(db as any, 'pa', 'razorpay', undefined, undefined, { amount: 1, currency: 'INR' });
    expect(res.ok).toBe(true); // not blocked
    expect(res.mismatch).toBeUndefined();
    expect(await userCoins('u1')).toBe(500);
    expect(await alerts()).toBe(1); // but flagged for the operator
  });

  it('blocks the credit on a mismatch once the operator enables enforcement', async () => {
    db.applySchema("INSERT INTO app_settings (key, value) VALUES ('payment_enforce_amount', '1');");
    const res = await approveDeposit(db as any, 'pa', 'razorpay', undefined, undefined, { amount: 1, currency: 'INR' });
    expect(res.ok).toBe(false);
    expect(res.mismatch).toBe(true);
    expect(await userCoins('u1')).toBe(0); // NOT credited
    // Purchase left pending so a corrected/real settlement can still complete.
    const p = await db.prepare("SELECT status FROM coin_purchases WHERE id = 'pa'").first<{ status: string }>();
    expect(p?.status).toBe('pending');
    expect(await alerts()).toBe(1);
  });

  it('flags a currency swap', async () => {
    const res = await approveDeposit(db as any, 'pa', 'stripe', undefined, undefined, { amount: 100, currency: 'USD' });
    expect(res.ok).toBe(true); // log-only
    expect(await alerts()).toBe(1);
  });

  it('tolerates a 1-unit rounding difference without alerting', async () => {
    const res = await approveDeposit(db as any, 'pa', 'razorpay', undefined, undefined, { amount: 100.5, currency: 'INR' });
    expect(res.ok).toBe(true);
    expect(await alerts()).toBe(0);
  });
});
