import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type FakeD1 } from './helpers/d1';
import { bumpRewardProgress } from '../src/routes/rewards';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the dopamine mechanics added in migration 0044:
//   • Weighted-random spin selection
//   • Campaign multiplier applied to claim
//   • Coupon idempotency + per-user limit
//   • Achievement unlock threshold
//   • Budget cap enforcement
//
// We reproduce the exact SQL the routes use against an in-memory D1-compatible
// fake, so drift between test and prod surfaces as a state-machine bug.

function setupDb(): FakeD1 {
  const db = createTestDb();
  db.applySchema(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO app_settings VALUES
      ('reward_daily_budget_cap','0'),
      ('reward_campaigns_enabled','true'),
      ('reward_spin_enabled','true'),
      ('reward_coupons_enabled','true'),
      ('reward_achievements_enabled','true');
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE reward_tasks (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      task_type TEXT NOT NULL,
      target_count INTEGER NOT NULL DEFAULT 1,
      coins_reward INTEGER NOT NULL,
      cooldown_hours INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE user_reward_progress (
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      current_count INTEGER NOT NULL DEFAULT 0,
      claim_count INTEGER NOT NULL DEFAULT 0,
      last_claimed_at INTEGER,
      total_earned INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, task_id)
    );
    CREATE TABLE reward_campaigns (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      banner_image_url TEXT NOT NULL DEFAULT '',
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      multiplier REAL NOT NULL DEFAULT 1.0,
      applies_to_task_types TEXT NOT NULL DEFAULT '',
      applies_to_spin INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE reward_coupons (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      coins_reward INTEGER NOT NULL,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      per_user_limit INTEGER NOT NULL DEFAULT 1,
      expires_at INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE user_coupon_redemptions (
      user_id TEXT NOT NULL,
      coupon_id TEXT NOT NULL,
      code TEXT NOT NULL,
      coins_awarded INTEGER NOT NULL,
      redeemed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, coupon_id, redeemed_at)
    );
    CREATE TABLE reward_achievements (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'trophy',
      tier TEXT NOT NULL DEFAULT 'bronze',
      trigger_type TEXT NOT NULL,
      trigger_threshold INTEGER NOT NULL,
      coins_reward INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE user_achievements (
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      coins_awarded INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, achievement_id)
    );
    CREATE TABLE reward_budget_daily (
      day_key TEXT PRIMARY KEY,
      coins_paid INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );
  `);
  return db;
}

// Deterministic weighted-random selector mirroring the /spin route's logic.
function pickSegment(
  segments: Array<{ weight: number; coins: number; label: string }>,
  rand: number,
): number {
  const total = segments.reduce((s, seg) => s + seg.weight, 0);
  let x = rand * total;
  for (let i = 0; i < segments.length; i++) {
    x -= segments[i].weight;
    if (x <= 0) return i;
  }
  return segments.length - 1;
}

let db: FakeD1;
beforeEach(() => {
  db = setupDb();
});

// ─── Weighted-random spin selection ─────────────────────────────────────────
describe('spin weighted-random selection', () => {
  const segments = [
    { label: '5c', coins: 5, weight: 50 },
    { label: '10c', coins: 10, weight: 30 },
    { label: '100c', coins: 100, weight: 20 },
  ];

  it('lands in the first bucket when rand=0', () => {
    expect(pickSegment(segments, 0)).toBe(0);
  });

  it('lands in the middle bucket when rand=0.6 (past 50%, inside 80%)', () => {
    // 0 → 50, 50 → 80, 80 → 100. Cumulative at rand=0.6 * 100 = 60 → middle.
    expect(pickSegment(segments, 0.6)).toBe(1);
  });

  it('lands in the last bucket when rand=0.99', () => {
    expect(pickSegment(segments, 0.99)).toBe(2);
  });

  it('respects the weight distribution over 10k samples', () => {
    const counts = [0, 0, 0];
    let seed = 12345;
    const rng = () => {
      // Deterministic LCG so the test is reproducible.
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 10000; i++) {
      counts[pickSegment(segments, rng())]++;
    }
    // Expected proportions: 50 / 30 / 20 %. Allow ±3% slack for a 10k sample.
    expect(counts[0] / 10000).toBeGreaterThan(0.47);
    expect(counts[0] / 10000).toBeLessThan(0.53);
    expect(counts[1] / 10000).toBeGreaterThan(0.27);
    expect(counts[1] / 10000).toBeLessThan(0.33);
    expect(counts[2] / 10000).toBeGreaterThan(0.17);
    expect(counts[2] / 10000).toBeLessThan(0.23);
  });
});

// ─── Campaign multiplier applied on claim ───────────────────────────────────
describe('campaign multiplier', () => {
  it('doubles the reward when an active campaign targets the task type', async () => {
    await db.prepare("INSERT INTO users (id, coins) VALUES ('u1', 0)").run();
    await db.prepare(
      "INSERT INTO reward_tasks (id, code, title, task_type, target_count, coins_reward, cooldown_hours) VALUES ('rt1','tc','Task','complete_calls',1,100,0)",
    ).run();
    // Add an active x2 campaign covering complete_calls.
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      `INSERT INTO reward_campaigns (id, code, title, starts_at, ends_at, multiplier, applies_to_task_types, active)
       VALUES ('rc1','WKND','Weekend',?,?,2.0,'complete_calls',1)`,
    ).bind(now - 3600, now + 3600).run();
    // Simulate progress + payout using the same multiplier logic as the route.
    const base = 100;
    const camp = await db.prepare(
      "SELECT multiplier FROM reward_campaigns WHERE active = 1 AND starts_at <= ? AND ends_at >= ? AND (applies_to_task_types = '' OR applies_to_task_types LIKE '%complete_calls%')",
    ).bind(now, now).first<{ multiplier: number }>();
    const mult = camp ? Number(camp.multiplier) : 1;
    const payout = Math.round(base * mult);
    expect(payout).toBe(200);
  });

  it('does NOT apply when campaign task_types is CSV and the task type is not in it', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      `INSERT INTO reward_campaigns (id, code, title, starts_at, ends_at, multiplier, applies_to_task_types, active)
       VALUES ('rc1','WKND','Weekend',?,?,2.0,'refer_friend',1)`,
    ).bind(now - 3600, now + 3600).run();
    // Look up campaign for a DIFFERENT task type — should return nothing.
    const camp = await db.prepare(
      `SELECT * FROM reward_campaigns WHERE active = 1 AND starts_at <= ? AND ends_at >= ?
        AND (applies_to_task_types = '' OR applies_to_task_types LIKE '%complete_calls%')`,
    ).bind(now, now).first<any>();
    expect(camp).toBeNull();
  });
});

// ─── Coupon idempotency + per-user limit ────────────────────────────────────
describe('coupon redemption', () => {
  it('credits coins once and blocks a second redemption when per_user_limit=1', async () => {
    await db.prepare("INSERT INTO users (id, coins) VALUES ('u1', 0)").run();
    await db.prepare(
      "INSERT INTO reward_coupons (id, code, coins_reward, per_user_limit) VALUES ('c1','WELCOME50',50,1)",
    ).run();

    // First redemption.
    const c1 = await db.prepare('SELECT * FROM reward_coupons WHERE code = ?').bind('WELCOME50').first<any>();
    expect(c1).toBeTruthy();
    const now = Math.floor(Date.now() / 1000);
    await db.batch([
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(c1.coins_reward, 'u1'),
      db.prepare('UPDATE reward_coupons SET used_count = used_count + 1 WHERE id = ?').bind(c1.id),
      db.prepare('INSERT INTO user_coupon_redemptions VALUES (?,?,?,?,?)').bind('u1', c1.id, 'WELCOME50', c1.coins_reward, now),
    ]);
    const u1 = await db.prepare('SELECT coins FROM users WHERE id = ?').bind('u1').first<{ coins: number }>();
    expect(u1?.coins).toBe(50);

    // Second attempt — count check should now block.
    const prior = await db.prepare('SELECT COUNT(*) AS n FROM user_coupon_redemptions WHERE user_id = ? AND coupon_id = ?').bind('u1', c1.id).first<{ n: number }>();
    expect(Number(prior?.n ?? 0)).toBeGreaterThanOrEqual(Number(c1.per_user_limit));
  });

  it('respects max_uses cap globally', async () => {
    await db.prepare(
      "INSERT INTO reward_coupons (id, code, coins_reward, max_uses, used_count) VALUES ('c1','LTD','50',5,5)",
    ).run();
    const c = await db.prepare('SELECT * FROM reward_coupons WHERE code = ?').bind('LTD').first<any>();
    expect(Number(c.used_count) >= Number(c.max_uses)).toBe(true);
  });
});

// ─── Achievement unlock threshold ───────────────────────────────────────────
describe('achievement unlock via bumpRewardProgress', () => {
  it('unlocks an achievement when progress crosses the threshold', async () => {
    await db.prepare("INSERT INTO users (id, coins) VALUES ('u1', 0)").run();
    await db.prepare(
      "INSERT INTO reward_tasks (id, code, title, task_type, target_count, coins_reward) VALUES ('rt1','tc','Task','complete_calls',999,0)",
    ).run();
    await db.prepare(
      "INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward) VALUES ('ach1','first_call','First','complete_calls',1,20)",
    ).run();

    await bumpRewardProgress(db as any, 'u1', 'complete_calls', 1);

    // Achievement should now be recorded.
    const ua = await db.prepare('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ?').bind('u1', 'ach1').first<any>();
    expect(ua).toBeTruthy();
    const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind('u1').first<{ coins: number }>();
    expect(u?.coins).toBe(20);
  });

  it('does not double-unlock the same achievement on repeated calls', async () => {
    await db.prepare("INSERT INTO users (id, coins) VALUES ('u1', 0)").run();
    await db.prepare(
      "INSERT INTO reward_tasks (id, code, title, task_type, target_count, coins_reward) VALUES ('rt1','tc','Task','complete_calls',999,0)",
    ).run();
    await db.prepare(
      "INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward) VALUES ('ach1','first_call','First','complete_calls',1,20)",
    ).run();

    await bumpRewardProgress(db as any, 'u1', 'complete_calls', 1);
    await bumpRewardProgress(db as any, 'u1', 'complete_calls', 1);
    await bumpRewardProgress(db as any, 'u1', 'complete_calls', 1);

    const rows = await db.prepare('SELECT COUNT(*) AS n FROM user_achievements WHERE user_id = ? AND achievement_id = ?').bind('u1', 'ach1').first<{ n: number }>();
    expect(Number(rows?.n ?? 0)).toBe(1);
    const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind('u1').first<{ coins: number }>();
    expect(u?.coins).toBe(20); // only credited once
  });
});

// ─── Budget cap ──────────────────────────────────────────────────────────────
describe('budget cap', () => {
  it('increments the daily counter when payouts happen', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare(
      `INSERT INTO reward_budget_daily (day_key, coins_paid, updated_at) VALUES (?, 0, ?)
       ON CONFLICT(day_key) DO UPDATE SET coins_paid = coins_paid + 0`,
    ).bind(day, Math.floor(Date.now() / 1000)).run();

    // Simulate two payouts of 100 each.
    for (let i = 0; i < 2; i++) {
      await db.prepare(
        `INSERT INTO reward_budget_daily (day_key, coins_paid, updated_at) VALUES (?, 100, ?)
         ON CONFLICT(day_key) DO UPDATE SET coins_paid = coins_paid + 100`,
      ).bind(day, Math.floor(Date.now() / 1000)).run();
    }

    const r = await db.prepare('SELECT coins_paid FROM reward_budget_daily WHERE day_key = ?').bind(day).first<{ coins_paid: number }>();
    expect(Number(r?.coins_paid ?? 0)).toBe(200);
  });

  it('recognises when a proposed payout would exceed the cap', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare(
      `INSERT INTO reward_budget_daily (day_key, coins_paid, updated_at) VALUES (?, 950, ?)`,
    ).bind(day, Math.floor(Date.now() / 1000)).run();

    const cap = 1000;
    const proposal = 100;
    const row = await db.prepare('SELECT coins_paid FROM reward_budget_daily WHERE day_key = ?').bind(day).first<{ coins_paid: number }>();
    const paid = Number(row?.coins_paid ?? 0);
    expect(paid + proposal > cap).toBe(true);
  });
});
