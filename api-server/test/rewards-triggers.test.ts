import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type FakeD1 } from './helpers/d1';
import { bumpRewardProgress } from '../src/routes/rewards';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the new trigger types + counter-backed achievement progress
// (migration 0045).
//
// Covers:
//   • coin_topup counter accumulates the total coins purchased.
//   • coin_topup_count counter tracks # of purchases.
//   • talk_minutes counter accumulates in minutes (durationSec / 60 floored).
//   • Achievement progress is computed from user_trigger_counters — not
//     from summing reward_task progress rows — so an achievement whose
//     trigger_type has no matching task still unlocks correctly.
//   • Achievements are idempotent under repeated bumps (no double-unlock).

function setupDb(): FakeD1 {
  const db = createTestDb();
  db.applySchema(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO app_settings VALUES
      ('reward_daily_budget_cap','0'),
      ('reward_achievements_enabled','true');
    CREATE TABLE users (id TEXT PRIMARY KEY, coins INTEGER NOT NULL DEFAULT 0, updated_at INTEGER);
    CREATE TABLE coin_transactions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      amount INTEGER NOT NULL, description TEXT, ref_id TEXT
    );
    CREATE TABLE reward_tasks (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      task_type TEXT NOT NULL, target_count INTEGER NOT NULL DEFAULT 1,
      coins_reward INTEGER NOT NULL, cooldown_hours INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE user_reward_progress (
      user_id TEXT NOT NULL, task_id TEXT NOT NULL,
      current_count INTEGER NOT NULL DEFAULT 0, claim_count INTEGER NOT NULL DEFAULT 0,
      last_claimed_at INTEGER, total_earned INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, task_id)
    );
    CREATE TABLE reward_achievements (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT 'trophy',
      tier TEXT NOT NULL DEFAULT 'bronze', trigger_type TEXT NOT NULL,
      trigger_threshold INTEGER NOT NULL, coins_reward INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE user_achievements (
      user_id TEXT NOT NULL, achievement_id TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL, coins_awarded INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, achievement_id)
    );
    CREATE TABLE reward_budget_daily (
      day_key TEXT PRIMARY KEY, coins_paid INTEGER NOT NULL DEFAULT 0, updated_at INTEGER
    );
    CREATE TABLE user_trigger_counters (
      user_id TEXT NOT NULL, trigger_type TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, trigger_type)
    );
    INSERT INTO users (id, coins) VALUES ('u1', 0);
  `);
  return db;
}

let db: FakeD1;
beforeEach(() => {
  db = setupDb();
});

describe('coin_topup trigger', () => {
  it('accumulates the total coins purchased across multiple deposits', async () => {
    // Three separate top-ups of 100, 250, 500 = 850 total.
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 100);
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 250);
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 500);
    const row = await db
      .prepare("SELECT count FROM user_trigger_counters WHERE user_id = ? AND trigger_type = ?")
      .bind('u1', 'coin_topup')
      .first<{ count: number }>();
    expect(Number(row?.count)).toBe(850);
  });

  it('unlocks a threshold-based achievement when the counter crosses it', async () => {
    await db.prepare(
      "INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward) VALUES ('ach1','first_topup','First Top-Up','coin_topup',100,20)",
    ).run();
    // First deposit under threshold — no unlock.
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 50);
    let ua = await db.prepare('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ?').bind('u1', 'ach1').first<any>();
    expect(ua).toBeNull();
    // Second deposit pushes total to 150 — should unlock.
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 100);
    ua = await db.prepare('SELECT coins_awarded FROM user_achievements WHERE user_id = ? AND achievement_id = ?').bind('u1', 'ach1').first<any>();
    expect(ua).toBeTruthy();
    expect(Number(ua?.coins_awarded)).toBe(20);
    // Coins credited on the user row.
    const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind('u1').first<{ coins: number }>();
    expect(u?.coins).toBe(20);
  });
});

describe('coin_topup_count trigger', () => {
  it('increments once per deposit regardless of coin amount', async () => {
    await bumpRewardProgress(db as any, 'u1', 'coin_topup_count', 1);
    await bumpRewardProgress(db as any, 'u1', 'coin_topup_count', 1);
    await bumpRewardProgress(db as any, 'u1', 'coin_topup_count', 1);
    const row = await db.prepare("SELECT count FROM user_trigger_counters WHERE user_id = ? AND trigger_type = ?").bind('u1', 'coin_topup_count').first<{ count: number }>();
    expect(Number(row?.count)).toBe(3);
  });
});

describe('talk_minutes trigger', () => {
  it('accumulates minutes across multiple calls', async () => {
    // Simulate three calls: 5 min, 12 min, 3 min = 20 minutes.
    await bumpRewardProgress(db as any, 'u1', 'talk_minutes', 5);
    await bumpRewardProgress(db as any, 'u1', 'talk_minutes', 12);
    await bumpRewardProgress(db as any, 'u1', 'talk_minutes', 3);
    const row = await db.prepare("SELECT count FROM user_trigger_counters WHERE user_id = ? AND trigger_type = ?").bind('u1', 'talk_minutes').first<{ count: number }>();
    expect(Number(row?.count)).toBe(20);
  });
});

describe('achievement progress read from counter (not from tasks)', () => {
  it('unlocks a task-less achievement (no reward_task with matching trigger)', async () => {
    // Intentionally no reward_task with trigger 'coin_topup' — the achievement
    // must still unlock purely from the counter.
    await db.prepare(
      "INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward) VALUES ('achX','no_task','No task','coin_topup',10,15)",
    ).run();
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 10);
    const ua = await db.prepare('SELECT coins_awarded FROM user_achievements WHERE achievement_id = ?').bind('achX').first<any>();
    expect(ua).toBeTruthy();
    expect(Number(ua?.coins_awarded)).toBe(15);
  });

  it('never double-unlocks the same achievement even with repeated bumps', async () => {
    await db.prepare(
      "INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward) VALUES ('achY','first_topup','First Top-Up','coin_topup',10,15)",
    ).run();
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 100); // crosses threshold immediately
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 200);
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 50);
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM user_achievements WHERE user_id = ? AND achievement_id = ?').bind('u1', 'achY').first<{ n: number }>();
    expect(Number(rows?.n ?? 0)).toBe(1);
    const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind('u1').first<{ coins: number }>();
    expect(u?.coins).toBe(15); // credited exactly once
  });

  it('spans multiple threshold tiers when a single bump crosses several', async () => {
    // Three tiers at 10, 50, 100 — a single 200 bump should unlock all three.
    await db.batch([
      db.prepare("INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward) VALUES ('t1','tier1','Bronze','coin_topup',10,10)"),
      db.prepare("INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward) VALUES ('t2','tier2','Silver','coin_topup',50,50)"),
      db.prepare("INSERT INTO reward_achievements (id, code, title, trigger_type, trigger_threshold, coins_reward) VALUES ('t3','tier3','Gold','coin_topup',100,100)"),
    ]);
    await bumpRewardProgress(db as any, 'u1', 'coin_topup', 200);
    const unlocked = await db.prepare('SELECT COUNT(*) AS n FROM user_achievements WHERE user_id = ?').bind('u1').first<{ n: number }>();
    expect(Number(unlocked?.n ?? 0)).toBe(3);
    const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind('u1').first<{ coins: number }>();
    expect(u?.coins).toBe(160); // 10 + 50 + 100
  });
});
