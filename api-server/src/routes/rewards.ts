import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { checkRateLimit } from '../lib/rateLimit';
import type { Env, JWTPayload } from '../types';

// ============================================================================
// Rewards Hub — user-facing coin-earning tasks.
// ============================================================================
//
// GET  /api/user/rewards          → list all active tasks + user's progress
// POST /api/user/rewards/claim    → claim coins for a completed task
// POST /api/user/rewards/track    → client-emitted event (watch_ad / share_app)
//
// Task types drive how progress is incremented:
//   • daily_checkin   — auto-completes on claim (target 1, cooldown 24h).
//   • complete_calls  — incremented server-side when a call is settled.
//   • spend_coins     — incremented server-side by the coins spent on a call.
//   • refer_friend    — incremented server-side when a referral is verified.
//   • watch_ad        — incremented via /track (client emits after ad played).
//   • share_app       — incremented via /track (client emits after share).
//
// Coin credit path uses the same UPDATE + coin_transactions batch pattern used
// by purchases / refunds / tips, and records type='bonus' on the ledger so
// admin analytics count these earnings correctly.

const rewards = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
rewards.use('*', authMiddleware);

// Rate limits per user (bursty but forgiving).
const RL_CLAIM_PER_MIN = 20;
const RL_TRACK_PER_MIN = 60;

interface TaskRow {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  task_type: string;
  target_count: number;
  coins_reward: number;
  cooldown_hours: number;
  cta_link: string;
  active: number;
  sort_order: number;
  // joined from user_reward_progress (LEFT JOIN → nullable)
  current_count: number | null;
  claim_count: number | null;
  last_claimed_at: number | null;
  total_earned: number | null;
}

/** Derive per-user claimable / cooldown state for a task row. */
function deriveState(row: TaskRow, now: number) {
  const currentCount = Number(row.current_count) || 0;
  const claimCount = Number(row.claim_count) || 0;
  const lastClaimedAt = row.last_claimed_at != null ? Number(row.last_claimed_at) : null;
  const cooldownSec = Number(row.cooldown_hours) * 3600;
  const isOneTime = cooldownSec === 0;

  const cooldownRemaining =
    !isOneTime && lastClaimedAt
      ? Math.max(0, lastClaimedAt + cooldownSec - now)
      : 0;

  // A daily_checkin task auto-completes on claim, so it is "claimable" as long
  // as no cooldown is active. All other task types require count >= target.
  const meetsTarget =
    row.task_type === 'daily_checkin'
      ? true
      : currentCount >= Number(row.target_count);

  const alreadyClaimed = isOneTime ? claimCount > 0 : cooldownRemaining > 0;
  const claimable = !alreadyClaimed && meetsTarget;

  return {
    current_count: currentCount,
    claim_count: claimCount,
    last_claimed_at: lastClaimedAt,
    total_earned: Number(row.total_earned) || 0,
    cooldown_remaining_sec: cooldownRemaining,
    claimable,
    already_claimed: alreadyClaimed,
  };
}

// ─── GET /api/user/rewards ───────────────────────────────────────────────────
rewards.get('/', async (c) => {
  const { sub } = c.get('user');
  const now = Math.floor(Date.now() / 1000);

  const res = await c.env.DB.prepare(
    `SELECT t.id, t.code, t.title, t.description, t.icon, t.category, t.task_type,
            t.target_count, t.coins_reward, t.cooldown_hours, t.cta_link,
            t.active, t.sort_order,
            p.current_count, p.claim_count, p.last_claimed_at, p.total_earned
       FROM reward_tasks t
       LEFT JOIN user_reward_progress p
         ON p.task_id = t.id AND p.user_id = ?
      WHERE t.active = 1
      ORDER BY t.sort_order ASC, t.created_at ASC`,
  )
    .bind(sub)
    .all<TaskRow>();

  const rows = res.results ?? [];
  const tasks = rows.map((r) => {
    const state = deriveState(r, now);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      description: r.description,
      icon: r.icon,
      category: r.category,
      task_type: r.task_type,
      target_count: Number(r.target_count),
      coins_reward: Number(r.coins_reward),
      cooldown_hours: Number(r.cooldown_hours),
      cta_link: r.cta_link,
      ...state,
    };
  });

  const totalEarned = tasks.reduce((s, t) => s + t.total_earned, 0);
  const claimableCount = tasks.filter((t) => t.claimable).length;

  return c.json({
    tasks,
    total_earned: totalEarned,
    claimable_count: claimableCount,
    server_time: now,
  });
});

// ─── POST /api/user/rewards/claim ────────────────────────────────────────────
rewards.post('/claim', async (c) => {
  const { sub } = c.get('user');

  const rlKey = `rl:reward_claim:${sub}:${Math.floor(Date.now() / 60000)}`;
  const { limited } = await checkRateLimit(c.env.DB, rlKey, RL_CLAIM_PER_MIN, 60);
  if (limited) return c.json({ error: 'rate_limited' }, 429);

  const body = await c.req.json().catch(() => ({}));
  const taskId = typeof (body as { task_id?: unknown })?.task_id === 'string'
    ? (body as { task_id: string }).task_id.slice(0, 64)
    : '';
  if (!taskId) return c.json({ error: 'task_id required' }, 400);

  const now = Math.floor(Date.now() / 1000);

  const task = await c.env.DB
    .prepare('SELECT * FROM reward_tasks WHERE id = ? AND active = 1')
    .bind(taskId)
    .first<TaskRow>();
  if (!task) return c.json({ error: 'Task not found or inactive' }, 404);

  const progress = await c.env.DB
    .prepare('SELECT * FROM user_reward_progress WHERE user_id = ? AND task_id = ?')
    .bind(sub, taskId)
    .first<TaskRow>();

  const merged: TaskRow = {
    ...task,
    current_count: progress?.current_count ?? null,
    claim_count: progress?.claim_count ?? null,
    last_claimed_at: progress?.last_claimed_at ?? null,
    total_earned: progress?.total_earned ?? null,
  };
  const state = deriveState(merged, now);

  if (state.already_claimed) {
    return c.json(
      {
        error: state.cooldown_remaining_sec > 0 ? 'Cooldown active' : 'Already claimed',
        cooldown_remaining_sec: state.cooldown_remaining_sec,
      },
      state.cooldown_remaining_sec > 0 ? 429 : 409,
    );
  }
  if (!state.claimable) {
    return c.json(
      {
        error: 'Task not yet completed',
        current: state.current_count,
        target: Number(task.target_count),
      },
      409,
    );
  }

  const coinsReward = Number(task.coins_reward);
  const cooldownSec = Number(task.cooldown_hours) * 3600;

  // Recurring tasks reset current_count on claim so the user has to earn it
  // again before the next payout. One-time tasks preserve the count for audit.
  const nextCount = cooldownSec > 0 ? 0 : state.current_count;

  const txId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?')
      .bind(coinsReward, sub),
    c.env.DB
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
      .bind(
        sub, taskId,
        nextCount, now, coinsReward, now,      // INSERT values
        nextCount, now, coinsReward, now,      // UPDATE values
      ),
    c.env.DB
      .prepare(
        'INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(txId, sub, 'bonus', coinsReward, `Reward: ${task.title}`, taskId),
  ]);

  const updated = await c.env.DB
    .prepare('SELECT coins FROM users WHERE id = ?')
    .bind(sub)
    .first<{ coins: number }>();

  return c.json({
    ok: true,
    task_id: taskId,
    task_code: task.code,
    coins_awarded: coinsReward,
    new_balance: Number(updated?.coins ?? 0),
    next_cooldown_sec: cooldownSec,
  });
});

// ─── POST /api/user/rewards/track ────────────────────────────────────────────
// Client-emitted events (allow-listed) that increment matching tasks' progress.
// Server-side triggers (call end, referral verify) call bumpRewardProgress()
// directly and never go through this endpoint.
const CLIENT_TRACKABLE_EVENTS = new Set<string>(['watch_ad', 'share_app']);

rewards.post('/track', async (c) => {
  const { sub } = c.get('user');

  const rlKey = `rl:reward_track:${sub}:${Math.floor(Date.now() / 60000)}`;
  const { limited } = await checkRateLimit(c.env.DB, rlKey, RL_TRACK_PER_MIN, 60);
  if (limited) return c.json({ error: 'rate_limited' }, 429);

  const body = await c.req.json().catch(() => ({}));
  const event = typeof (body as { event?: unknown })?.event === 'string'
    ? (body as { event: string }).event.slice(0, 40)
    : '';
  if (!CLIENT_TRACKABLE_EVENTS.has(event)) {
    return c.json({ error: 'event not allowed' }, 400);
  }

  const updated = await bumpRewardProgress(c.env.DB, sub, event, 1);
  return c.json({ ok: true, tasks_updated: updated });
});

export default rewards;

// ─── Server-side helper (used by call.ts, auth.ts, etc.) ─────────────────────
/**
 * Increment `current_count` on every active task whose `task_type` matches.
 * Best-effort: never throws — failures are logged and the caller continues.
 *
 * Returns the number of tasks updated.
 */
export async function bumpRewardProgress(
  db: D1Database,
  userId: string,
  taskType: string,
  delta = 1,
): Promise<number> {
  if (!userId || !taskType || !Number.isFinite(delta) || delta <= 0) return 0;

  let tasks: { id: string }[] = [];
  try {
    const res = await db
      .prepare('SELECT id FROM reward_tasks WHERE task_type = ? AND active = 1')
      .bind(taskType)
      .all<{ id: string }>();
    tasks = res.results ?? [];
  } catch (err) {
    console.warn('[rewards] bumpRewardProgress: task lookup failed', err);
    return 0;
  }
  if (tasks.length === 0) return 0;

  const now = Math.floor(Date.now() / 1000);
  const deltaInt = Math.floor(delta);
  const ops = tasks.map((t) =>
    db
      .prepare(
        `INSERT INTO user_reward_progress
           (user_id, task_id, current_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, task_id) DO UPDATE SET
           current_count = current_count + ?,
           updated_at = ?`,
      )
      .bind(userId, t.id, deltaInt, now, deltaInt, now),
  );

  try {
    await db.batch(ops);
    return ops.length;
  } catch (err) {
    console.warn('[rewards] bumpRewardProgress: batch failed', err);
    return 0;
  }
}
