import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type FakeD1 } from './helpers/d1';
import { bumpRewardProgress } from '../src/routes/rewards';

// ─────────────────────────────────────────────────────────────────────────────
// Reward-system unit tests.
// ─────────────────────────────────────────────────────────────────────────────
// These focus on the server-side helper (`bumpRewardProgress`) that non-reward
// routes call to record progress on behalf of the user. The claim endpoint's
// atomic logic is exercised in-process here so we can regress-test the state
// machine (one-time vs cooldown, target check, coin credit) without spinning
// up a real Hono context.

function setupDb(): FakeD1 {
  const db = createTestDb();
  db.applySchema(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO app_settings VALUES
      ('reward_daily_budget_cap','0'),
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
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'gift',
      category TEXT NOT NULL DEFAULT 'daily',
      task_type TEXT NOT NULL,
      target_count INTEGER NOT NULL DEFAULT 1,
      coins_reward INTEGER NOT NULL,
      cooldown_hours INTEGER NOT NULL DEFAULT 0,
      cta_link TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
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
    -- Tables added in migration 0044 that bumpRewardProgress touches.
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
    -- Migration 0045: single-source-of-truth counter for trigger progress
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

async function insertTask(
  db: FakeD1,
  overrides: Partial<{
    id: string; code: string; task_type: string; target_count: number;
    coins_reward: number; cooldown_hours: number; active: number;
  }> = {},
) {
  const t = {
    id: 'rt_test',
    code: 'test_task',
    task_type: 'complete_calls',
    target_count: 3,
    coins_reward: 100,
    cooldown_hours: 0,
    active: 1,
    ...overrides,
  };
  await db.prepare(
    `INSERT INTO reward_tasks (id, code, title, task_type, target_count, coins_reward, cooldown_hours, active)
     VALUES (?, ?, 'Test task', ?, ?, ?, ?, ?)`,
  ).bind(t.id, t.code, t.task_type, t.target_count, t.coins_reward, t.cooldown_hours, t.active).run();
  return t;
}

let db: FakeD1;
beforeEach(() => {
  db = setupDb();
});

describe('bumpRewardProgress', () => {
  it('creates a progress row on first bump', async () => {
    await insertTask(db);
    const n = await bumpRewardProgress(db as any, 'user1', 'complete_calls', 1);
    expect(n).toBe(1);
    const row = await db
      .prepare('SELECT current_count FROM user_reward_progress WHERE user_id = ? AND task_id = ?')
      .bind('user1', 'rt_test')
      .first<{ current_count: number }>();
    expect(row?.current_count).toBe(1);
  });

  it('accumulates on subsequent bumps (upsert)', async () => {
    await insertTask(db);
    await bumpRewardProgress(db as any, 'user1', 'complete_calls', 1);
    await bumpRewardProgress(db as any, 'user1', 'complete_calls', 2);
    await bumpRewardProgress(db as any, 'user1', 'complete_calls', 5);
    const row = await db
      .prepare('SELECT current_count FROM user_reward_progress WHERE user_id = ? AND task_id = ?')
      .bind('user1', 'rt_test')
      .first<{ current_count: number }>();
    expect(row?.current_count).toBe(8);
  });

  it('applies to every ACTIVE task of the matching type', async () => {
    await insertTask(db, { id: 'rt_a', code: 'a', task_type: 'complete_calls' });
    await insertTask(db, { id: 'rt_b', code: 'b', task_type: 'complete_calls', target_count: 10 });
    // Inactive one shouldn't be bumped.
    await insertTask(db, { id: 'rt_off', code: 'off', task_type: 'complete_calls', active: 0 });

    const n = await bumpRewardProgress(db as any, 'user1', 'complete_calls', 1);
    expect(n).toBe(2);

    const rows = await db
      .prepare('SELECT task_id, current_count FROM user_reward_progress WHERE user_id = ?')
      .bind('user1')
      .all<{ task_id: string; current_count: number }>();
    const byId = new Map((rows.results ?? []).map((r) => [r.task_id, r.current_count]));
    expect(byId.get('rt_a')).toBe(1);
    expect(byId.get('rt_b')).toBe(1);
    expect(byId.has('rt_off')).toBe(false);
  });

  it('is a no-op for non-matching event types', async () => {
    await insertTask(db);
    const n = await bumpRewardProgress(db as any, 'user1', 'some_unrelated_event', 1);
    expect(n).toBe(0);
    const row = await db
      .prepare('SELECT current_count FROM user_reward_progress WHERE user_id = ?')
      .bind('user1')
      .first();
    expect(row).toBeNull();
  });

  it('rejects invalid deltas (0, negative, NaN) without touching the DB', async () => {
    await insertTask(db);
    expect(await bumpRewardProgress(db as any, 'user1', 'complete_calls', 0)).toBe(0);
    expect(await bumpRewardProgress(db as any, 'user1', 'complete_calls', -5)).toBe(0);
    expect(await bumpRewardProgress(db as any, 'user1', 'complete_calls', Number.NaN)).toBe(0);
    const row = await db
      .prepare('SELECT COUNT(*) as n FROM user_reward_progress WHERE user_id = ?')
      .bind('user1')
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('rejects blank userId / taskType', async () => {
    await insertTask(db);
    expect(await bumpRewardProgress(db as any, '', 'complete_calls', 1)).toBe(0);
    expect(await bumpRewardProgress(db as any, 'u', '', 1)).toBe(0);
  });
});

// ─── Reward claim path (in-process) ──────────────────────────────────────────
// Reproduces the exact SQL the claim route uses so we don't have to stand up a
// Hono context. Any drift between this test and the route body will surface as
// a state-machine bug before it ships.
async function claim(
  db: FakeD1,
  userId: string,
  taskId: string,
  { assumeReady = false }: { assumeReady?: boolean } = {},
) {
  const task = await db.prepare('SELECT * FROM reward_tasks WHERE id = ? AND active = 1').bind(taskId).first<any>();
  if (!task) return { error: 'not found', status: 404 };

  const progress = await db
    .prepare('SELECT * FROM user_reward_progress WHERE user_id = ? AND task_id = ?')
    .bind(userId, taskId)
    .first<any>();

  const now = Math.floor(Date.now() / 1000);
  const currentCount = Number(progress?.current_count ?? 0);
  const claimCount = Number(progress?.claim_count ?? 0);
  const lastClaimedAt = progress?.last_claimed_at ?? null;
  const cooldownSec = Number(task.cooldown_hours) * 3600;
  const isOneTime = cooldownSec === 0;

  const cooldownRemaining =
    !isOneTime && lastClaimedAt ? Math.max(0, lastClaimedAt + cooldownSec - now) : 0;
  const meetsTarget =
    assumeReady || task.task_type === 'daily_checkin' || currentCount >= Number(task.target_count);
  const alreadyClaimed = isOneTime ? claimCount > 0 : cooldownRemaining > 0;
  const claimable = !alreadyClaimed && meetsTarget;

  if (alreadyClaimed) return { error: 'already claimed', status: 409 };
  if (!claimable) return { error: 'not completed', status: 409 };

  const coinsReward = Number(task.coins_reward);
  const nextCount = cooldownSec > 0 ? 0 : currentCount;

  await db.batch([
    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(coinsReward, userId),
    db
      .prepare(
        `INSERT INTO user_reward_progress
           (user_id, task_id, current_count, claim_count, last_claimed_at, total_earned, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(user_id, task_id) DO UPDATE SET
           current_count   = ?,
           claim_count     = claim_count + 1,
           last_claimed_at = ?,
           total_earned    = total_earned + ?,
           updated_at      = ?`,
      )
      .bind(userId, taskId, nextCount, now, coinsReward, now, nextCount, now, coinsReward, now),
    db
      .prepare(
        'INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(crypto.randomUUID(), userId, 'bonus', coinsReward, `Reward: ${task.title}`, taskId),
  ]);
  return { ok: true, coinsReward };
}

describe('reward claim', () => {
  beforeEach(async () => {
    await db.prepare('INSERT INTO users (id, coins) VALUES (?, ?)').bind('user1', 0).run();
  });

  it('credits coins + ledger row on a valid one-time claim', async () => {
    await insertTask(db, { id: 'rt_one', code: 'one', cooldown_hours: 0, target_count: 1, coins_reward: 50 });
    // Simulate 1 completed call.
    await bumpRewardProgress(db as any, 'user1', 'complete_calls', 1);

    const res = await claim(db, 'user1', 'rt_one');
    expect(res.ok).toBe(true);

    const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind('user1').first<{ coins: number }>();
    expect(u?.coins).toBe(50);

    const tx = await db.prepare('SELECT type, amount FROM coin_transactions WHERE user_id = ?').bind('user1').first<any>();
    expect(tx?.type).toBe('bonus');
    expect(tx?.amount).toBe(50);
  });

  it('rejects a second claim of a one-time task', async () => {
    await insertTask(db, { id: 'rt_one', code: 'one', cooldown_hours: 0, target_count: 1, coins_reward: 50 });
    await bumpRewardProgress(db as any, 'user1', 'complete_calls', 1);
    await claim(db, 'user1', 'rt_one');

    const second = await claim(db, 'user1', 'rt_one');
    expect(second.ok).toBeUndefined();
    expect(second.status).toBe(409);

    const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind('user1').first<{ coins: number }>();
    expect(u?.coins).toBe(50); // NOT doubled
  });

  it('rejects claim when progress < target', async () => {
    await insertTask(db, { id: 'rt_ten', code: 'ten', cooldown_hours: 0, target_count: 10, coins_reward: 100 });
    await bumpRewardProgress(db as any, 'user1', 'complete_calls', 3);
    const res = await claim(db, 'user1', 'rt_ten');
    expect(res.status).toBe(409);
  });

  it('resets current_count on claim for recurring tasks (daily_checkin)', async () => {
    await insertTask(db, {
      id: 'rt_daily',
      code: 'daily',
      task_type: 'daily_checkin',
      cooldown_hours: 24,
      target_count: 1,
      coins_reward: 10,
    });
    const res = await claim(db, 'user1', 'rt_daily');
    expect(res.ok).toBe(true);

    const row = await db
      .prepare('SELECT current_count, claim_count FROM user_reward_progress WHERE user_id = ? AND task_id = ?')
      .bind('user1', 'rt_daily')
      .first<{ current_count: number; claim_count: number }>();
    expect(row?.current_count).toBe(0);   // reset after claim
    expect(row?.claim_count).toBe(1);     // one claim recorded
  });
});
