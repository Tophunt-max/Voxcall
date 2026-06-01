import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type FakeD1 } from './helpers/d1';
import { claimDailyStreak, getStreakStatus } from '../src/lib/streak';

// Build a fresh in-memory D1 with the bare minimum schema the streak module
// touches: users (with the migration-0027 columns), app_settings (so loadConfig
// can fall through to defaults), and coin_transactions (audit trail target).
//
// We seed app_settings with the defaults the schema guard would have written,
// so the production hot path is faithfully reproduced in tests.
function setupDb(): FakeD1 {
  const db = createTestDb();
  // The fake D1 in test/helpers/d1 supports raw `exec` of arbitrary SQL —
  // we use it to build the minimum schema this suite needs without
  // hauling in every migration.
  const stmts = [
    `CREATE TABLE users (
       id TEXT PRIMARY KEY,
       coins INTEGER DEFAULT 0,
       streak_days INTEGER DEFAULT 0,
       last_streak_claim_at INTEGER DEFAULT 0,
       updated_at INTEGER DEFAULT 0
     )`,
    `CREATE TABLE app_settings (
       key TEXT PRIMARY KEY,
       value TEXT,
       updated_at INTEGER DEFAULT 0
     )`,
    `CREATE TABLE coin_transactions (
       id TEXT PRIMARY KEY,
       user_id TEXT,
       type TEXT,
       amount INTEGER,
       description TEXT,
       ref_id TEXT,
       created_at INTEGER DEFAULT (unixepoch())
     )`,
  ];
  for (const sql of stmts) {
    (db as any).exec(sql);
  }
  return db;
}

async function seedUser(
  db: FakeD1,
  id: string,
  coins = 0,
  streak = 0,
  lastClaim = 0,
): Promise<void> {
  await (db as any)
    .prepare('INSERT INTO users (id, coins, streak_days, last_streak_claim_at) VALUES (?, ?, ?, ?)')
    .bind(id, coins, streak, lastClaim)
    .run();
}

const SECONDS_PER_DAY = 86400;
const IST_OFFSET = 5 * 3600 + 30 * 60;
function istMidnight(unixSec: number): number {
  const day = Math.floor((unixSec + IST_OFFSET) / SECONDS_PER_DAY);
  return day * SECONDS_PER_DAY - IST_OFFSET;
}

describe('claimDailyStreak — IST-day boundary + atomic guard', () => {
  let db: FakeD1;

  beforeEach(() => {
    db = setupDb();
  });

  it('first claim ever — streak goes to 1, base reward credited', async () => {
    await seedUser(db, 'u1');
    const r = await claimDailyStreak(db as any, 'u1');
    expect(r.claimed).toBe(true);
    expect(r.code).toBe('OK');
    expect(r.streak_days).toBe(1);
    // Default schedule[0] = 5
    expect(r.base_reward).toBe(5);
    expect(r.milestone_bonus).toBe(0);
    expect(r.reward).toBe(5);
    expect(r.new_balance).toBe(5);
  });

  it('claiming twice in the same IST day returns ALREADY_CLAIMED', async () => {
    await seedUser(db, 'u1');
    await claimDailyStreak(db as any, 'u1');
    const r2 = await claimDailyStreak(db as any, 'u1');
    expect(r2.claimed).toBe(false);
    expect(r2.code).toBe('ALREADY_CLAIMED');
    expect(r2.reward).toBe(0);
    // Streak unchanged, balance unchanged.
    expect(r2.streak_days).toBe(1);
  });

  it('claim with last claim "yesterday" (in IST) — streak increments', async () => {
    // Pre-seed the user with a claim that's strictly before today's IST
    // midnight but after yesterday's IST midnight — i.e. anywhere yesterday.
    const now = Math.floor(Date.now() / 1000);
    const yesterdayMid = istMidnight(now) - SECONDS_PER_DAY;
    await seedUser(db, 'u1', /*coins*/ 100, /*streak*/ 3, /*lastClaim*/ yesterdayMid + 60);
    const r = await claimDailyStreak(db as any, 'u1');
    expect(r.claimed).toBe(true);
    expect(r.streak_days).toBe(4);
    // Day 4 → schedule[3] = 20, no milestone
    expect(r.base_reward).toBe(20);
    expect(r.milestone_bonus).toBe(0);
    expect(r.reward).toBe(20);
    expect(r.new_balance).toBe(120);
  });

  it('claim with last claim 2+ days ago — streak resets to 1', async () => {
    const now = Math.floor(Date.now() / 1000);
    const twoDaysAgo = istMidnight(now) - 2 * SECONDS_PER_DAY + 1;
    await seedUser(db, 'u1', /*coins*/ 50, /*streak*/ 9, /*lastClaim*/ twoDaysAgo);
    const r = await claimDailyStreak(db as any, 'u1');
    expect(r.claimed).toBe(true);
    expect(r.streak_days).toBe(1);
    expect(r.reward).toBe(5);
  });

  it('milestone bonus stacks on top of base reward at day 7', async () => {
    const now = Math.floor(Date.now() / 1000);
    const yesterday = istMidnight(now) - SECONDS_PER_DAY + 60;
    // streak 6, last claim yesterday → today goes to 7 (milestone day).
    await seedUser(db, 'u1', /*coins*/ 0, /*streak*/ 6, /*lastClaim*/ yesterday);
    const r = await claimDailyStreak(db as any, 'u1');
    expect(r.streak_days).toBe(7);
    // Day 7 → schedule[6] = 100 base
    expect(r.base_reward).toBe(100);
    // Default milestones["7"] = 50
    expect(r.milestone_bonus).toBe(50);
    expect(r.reward).toBe(150);
    expect(r.new_balance).toBe(150);
  });

  it('schedule wraps after its length (Day 8 → schedule[0])', async () => {
    const now = Math.floor(Date.now() / 1000);
    const yesterday = istMidnight(now) - SECONDS_PER_DAY + 60;
    await seedUser(db, 'u1', 0, 7, yesterday);
    const r = await claimDailyStreak(db as any, 'u1');
    expect(r.streak_days).toBe(8);
    // Day 8 — (8-1) % 7 = 0 → schedule[0] = 5. No milestone at 8.
    expect(r.base_reward).toBe(5);
    expect(r.milestone_bonus).toBe(0);
  });

  it('respects the daily_streak_enabled = "0" admin kill switch', async () => {
    await seedUser(db, 'u1');
    await (db as any)
      .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('daily_streak_enabled', '0', 0)")
      .run();
    const r = await claimDailyStreak(db as any, 'u1');
    expect(r.claimed).toBe(false);
    expect(r.code).toBe('FEATURE_DISABLED');
    expect(r.reward).toBe(0);
  });

  it('respects a custom admin-tuned schedule', async () => {
    await seedUser(db, 'u1');
    await (db as any)
      .prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('daily_streak_schedule', '[7,14,21]', 0)",
      )
      .run();
    const r = await claimDailyStreak(db as any, 'u1');
    expect(r.streak_days).toBe(1);
    // Day 1 → schedule[0] = 7
    expect(r.base_reward).toBe(7);
  });

  it('falls back to defaults when admin schedule JSON is malformed', async () => {
    await seedUser(db, 'u1');
    await (db as any)
      .prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('daily_streak_schedule', 'not-json', 0)",
      )
      .run();
    const r = await claimDailyStreak(db as any, 'u1');
    // Default schedule[0] = 5 should still be used despite the corrupt row.
    expect(r.base_reward).toBe(5);
  });

  it('returns USER_NOT_FOUND when user id is unknown', async () => {
    const r = await claimDailyStreak(db as any, 'no-such-user');
    expect(r.claimed).toBe(false);
    expect(r.code).toBe('USER_NOT_FOUND');
  });
});

describe('getStreakStatus', () => {
  let db: FakeD1;

  beforeEach(() => {
    db = setupDb();
  });

  it('predicts the next reward for a fresh user (next claim → Day 1)', async () => {
    await seedUser(db, 'u1');
    const s = await getStreakStatus(db as any, 'u1');
    expect(s).not.toBeNull();
    expect(s!.can_claim_now).toBe(true);
    expect(s!.streak_days).toBe(0);
    expect(s!.next_reward).toBe(5); // schedule[0]
    expect(s!.next_reward_milestone).toBe(0);
  });

  it('predicts Day 7 milestone reward (50 + 100) for a user on Day 6 streak claimed yesterday', async () => {
    const now = Math.floor(Date.now() / 1000);
    const yesterday = istMidnight(now) - SECONDS_PER_DAY + 60;
    await seedUser(db, 'u1', 0, 6, yesterday);
    const s = await getStreakStatus(db as any, 'u1');
    expect(s!.can_claim_now).toBe(true);
    expect(s!.next_reward_base).toBe(100);
    expect(s!.next_reward_milestone).toBe(50);
    expect(s!.next_reward).toBe(150);
  });

  it('reports cooldown correctly when user already claimed today', async () => {
    const now = Math.floor(Date.now() / 1000);
    const todayMid = istMidnight(now);
    await seedUser(db, 'u1', 5, 1, todayMid + 60);
    const s = await getStreakStatus(db as any, 'u1');
    expect(s!.can_claim_now).toBe(false);
    expect(s!.next_claim_at).toBe(todayMid + SECONDS_PER_DAY);
  });
});
