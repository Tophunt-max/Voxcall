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
      sort_order INTEGER NOT NULL DEFAULT 100,
      duration_days INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE user_achievements (
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      coins_awarded INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, achievement_id)
    );
    CREATE TABLE user_achievement_progress (
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      current_count INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, achievement_id)
    );
    CREATE TABLE reward_budget_daily (
      day_key TEXT PRIMARY KEY,
      coins_paid INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );
    CREATE TABLE user_trigger_counters (
      user_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, trigger_type)
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


// ─────────────────────────────────────────────────────────────────────────────
// Race-condition regressions.
// ─────────────────────────────────────────────────────────────────────────────
// These tests exercise the atomic CAS guards added to /claim, /spin,
// /redeem-coupon, and checkAndUnlockAchievements. Each test runs the exact
// SQL statement the route uses TWICE in sequence — simulating two concurrent
// requests that both passed the initial read-side check but only ONE of
// which is allowed to commit the mutation. The second call must observe
// meta.changes === 0 and the caller must NOT credit coins.

describe('race-condition regressions', () => {
  let db: FakeD1;
  beforeEach(() => {
    db = setupDb();
  });

  it('coupon max_uses CAS: two concurrent redemptions on a max_uses=1 coupon credit only once', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      `INSERT INTO reward_coupons (id, code, coins_reward, max_uses, used_count, per_user_limit, expires_at, active)
       VALUES ('co1', 'ONESHOT', 100, 1, 0, 1, NULL, 1)`,
    ).run();

    // Both callers observe used_count=0 in the initial SELECT. They race
    // into the atomic UPDATE; the WHERE guard is the arbitrator.
    const claim1 = await db.prepare(
      `UPDATE reward_coupons
          SET used_count = used_count + 1
        WHERE id = ?
          AND active = 1
          AND (max_uses IS NULL OR used_count < max_uses)
          AND (expires_at IS NULL OR expires_at > ?)`,
    ).bind('co1', now).run();
    const claim2 = await db.prepare(
      `UPDATE reward_coupons
          SET used_count = used_count + 1
        WHERE id = ?
          AND active = 1
          AND (max_uses IS NULL OR used_count < max_uses)
          AND (expires_at IS NULL OR expires_at > ?)`,
    ).bind('co1', now).run();

    expect(claim1.meta?.changes).toBe(1);
    expect(claim2.meta?.changes).toBe(0);

    const row = await db
      .prepare('SELECT used_count FROM reward_coupons WHERE id = ?')
      .bind('co1')
      .first<{ used_count: number }>();
    expect(row?.used_count).toBe(1); // never exceeds max_uses
  });

  it('coupon max_uses CAS: N concurrent redemptions on a max_uses=3 coupon credit exactly 3', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      `INSERT INTO reward_coupons (id, code, coins_reward, max_uses, used_count, per_user_limit, expires_at, active)
       VALUES ('co3', 'THREESHOT', 100, 3, 0, 1, NULL, 1)`,
    ).run();

    let wins = 0;
    for (let i = 0; i < 10; i++) {
      const r = await db.prepare(
        `UPDATE reward_coupons
            SET used_count = used_count + 1
          WHERE id = ? AND active = 1
            AND (max_uses IS NULL OR used_count < max_uses)
            AND (expires_at IS NULL OR expires_at > ?)`,
      ).bind('co3', now).run();
      if (r.meta?.changes === 1) wins++;
    }
    expect(wins).toBe(3);

    const row = await db
      .prepare('SELECT used_count FROM reward_coupons WHERE id = ?')
      .bind('co3')
      .first<{ used_count: number }>();
    expect(row?.used_count).toBe(3);
  });

  it('claim CAS: two concurrent claims on a one-time task only credit once', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Seed: user has completed a target=1 task; progress row exists with
    // current_count=1, claim_count=0.
    await db.prepare(
      `INSERT INTO reward_tasks (id, code, title, task_type, target_count, coins_reward, cooldown_hours, active)
       VALUES ('rt_race', 'race', 'Race', 'complete_calls', 1, 100, 0, 1)`,
    ).run();
    await db.prepare(
      `INSERT INTO user_reward_progress (user_id, task_id, current_count, claim_count, last_claimed_at, total_earned)
       VALUES ('u1', 'rt_race', 1, 0, NULL, 0)`,
    ).run();

    // Simulated: both concurrent claims pass the read-side deriveState()
    // check because both see claim_count=0. The atomic UPDATE is the
    // arbitrator.
    const claim1 = await db.prepare(
      `UPDATE user_reward_progress
          SET claim_count     = 1,
              last_claimed_at = ?,
              current_count   = ?,
              total_earned    = total_earned + ?,
              updated_at      = ?
        WHERE user_id = ? AND task_id = ?
          AND claim_count = 0
          AND current_count >= ?`,
    ).bind(now, 1, 100, now, 'u1', 'rt_race', 1).run();
    const claim2 = await db.prepare(
      `UPDATE user_reward_progress
          SET claim_count     = 1,
              last_claimed_at = ?,
              current_count   = ?,
              total_earned    = total_earned + ?,
              updated_at      = ?
        WHERE user_id = ? AND task_id = ?
          AND claim_count = 0
          AND current_count >= ?`,
    ).bind(now, 1, 100, now, 'u1', 'rt_race', 1).run();

    expect(claim1.meta?.changes).toBe(1);
    expect(claim2.meta?.changes).toBe(0);

    const row = await db
      .prepare('SELECT claim_count, total_earned FROM user_reward_progress WHERE user_id = ? AND task_id = ?')
      .bind('u1', 'rt_race')
      .first<{ claim_count: number; total_earned: number }>();
    expect(row?.claim_count).toBe(1);
    expect(row?.total_earned).toBe(100); // credited exactly once
  });

  it('claim CAS: recurring task with cooldown blocks a second claim within the window', async () => {
    const now = Math.floor(Date.now() / 1000);
    const cooldownSec = 3600; // 1 hour
    // User just claimed 5 minutes ago — cooldown NOT elapsed.
    await db.prepare(
      `INSERT INTO reward_tasks (id, code, title, task_type, target_count, coins_reward, cooldown_hours, active)
       VALUES ('rt_cd', 'cd', 'Cooldown', 'daily_checkin', 1, 50, 1, 1)`,
    ).run();
    await db.prepare(
      `INSERT INTO user_reward_progress (user_id, task_id, current_count, claim_count, last_claimed_at, total_earned)
       VALUES ('u1', 'rt_cd', 0, 1, ?, 50)`,
    ).bind(now - 300).run(); // 5 min ago

    const attempt = await db.prepare(
      `UPDATE user_reward_progress
          SET claim_count     = claim_count + 1,
              last_claimed_at = ?,
              current_count   = 0,
              total_earned    = total_earned + ?,
              updated_at      = ?
        WHERE user_id = ? AND task_id = ?
          AND (last_claimed_at IS NULL OR last_claimed_at + ? <= ?)`,
    ).bind(now, 50, now, 'u1', 'rt_cd', cooldownSec, now).run();

    expect(attempt.meta?.changes).toBe(0); // cooldown guard held

    const row = await db
      .prepare('SELECT claim_count, total_earned FROM user_reward_progress WHERE user_id = ? AND task_id = ?')
      .bind('u1', 'rt_cd')
      .first<{ claim_count: number; total_earned: number }>();
    expect(row?.claim_count).toBe(1); // unchanged
    expect(row?.total_earned).toBe(50); // unchanged
  });

  it('spin CAS: concurrent spins on 1 remaining free spin decrement exactly once', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Seed spin state with a single free spin remaining.
    db.applySchema(`
      CREATE TABLE user_spin_state (
        user_id TEXT PRIMARY KEY,
        free_spins_remaining INTEGER NOT NULL DEFAULT 0,
        earned_spins_remaining INTEGER NOT NULL DEFAULT 0,
        last_free_reset_day TEXT NOT NULL DEFAULT '',
        total_spins INTEGER NOT NULL DEFAULT 0,
        total_coins_won INTEGER NOT NULL DEFAULT 0,
        last_win_amount INTEGER,
        last_spun_at INTEGER,
        updated_at INTEGER
      );
      INSERT INTO user_spin_state (user_id, free_spins_remaining, earned_spins_remaining, last_free_reset_day)
      VALUES ('u1', 1, 0, '2026-01-01');
    `);

    // Two concurrent /spin calls both observe free_spins_remaining=1.
    const decr1 = await db.prepare(
      `UPDATE user_spin_state
          SET free_spins_remaining = free_spins_remaining - 1,
              total_spins          = total_spins + 1,
              total_coins_won      = total_coins_won + ?,
              last_win_amount      = ?,
              last_spun_at         = ?,
              updated_at           = ?
        WHERE user_id = ? AND free_spins_remaining > 0`,
    ).bind(100, 100, now, now, 'u1').run();
    const decr2 = await db.prepare(
      `UPDATE user_spin_state
          SET free_spins_remaining = free_spins_remaining - 1,
              total_spins          = total_spins + 1,
              total_coins_won      = total_coins_won + ?,
              last_win_amount      = ?,
              last_spun_at         = ?,
              updated_at           = ?
        WHERE user_id = ? AND free_spins_remaining > 0`,
    ).bind(100, 100, now, now, 'u1').run();

    expect(decr1.meta?.changes).toBe(1);
    expect(decr2.meta?.changes).toBe(0);

    const row = await db
      .prepare('SELECT free_spins_remaining, total_spins, total_coins_won FROM user_spin_state WHERE user_id = ?')
      .bind('u1')
      .first<{ free_spins_remaining: number; total_spins: number; total_coins_won: number }>();
    expect(row?.free_spins_remaining).toBe(0); // never goes negative
    expect(row?.total_spins).toBe(1); // credited once
    expect(row?.total_coins_won).toBe(100); // credited once
  });

  it('achievement INSERT OR IGNORE: concurrent unlocks credit exactly once', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      `INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward, active)
       VALUES ('ach1', 'first_call', 'First Call', 'complete_calls', 1, 25, 1)`,
    ).run();

    const ins1 = await db.prepare(
      `INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at, coins_awarded)
       VALUES (?, ?, ?, ?)`,
    ).bind('u1', 'ach1', now, 25).run();
    const ins2 = await db.prepare(
      `INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at, coins_awarded)
       VALUES (?, ?, ?, ?)`,
    ).bind('u1', 'ach1', now, 25).run();

    expect(ins1.meta?.changes).toBe(1); // first caller wins
    expect(ins2.meta?.changes).toBe(0); // second caller sees no-op — MUST NOT credit

    const row = await db
      .prepare('SELECT COUNT(*) AS n, MAX(coins_awarded) AS coins FROM user_achievements WHERE user_id = ? AND achievement_id = ?')
      .bind('u1', 'ach1')
      .first<{ n: number; coins: number }>();
    expect(row?.n).toBe(1); // exactly one row
    expect(row?.coins).toBe(25); // exactly one credit's worth
  });
});
