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
      status TEXT NOT NULL DEFAULT 'pending',
      payment_method TEXT,
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
