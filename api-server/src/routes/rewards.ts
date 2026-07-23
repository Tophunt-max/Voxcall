import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { checkRateLimit } from '../lib/rateLimit';
import { notifyUser } from '../lib/realtime';
import type { Env, JWTPayload } from '../types';

// ============================================================================
// Rewards Hub — user-facing coin-earning surface.
// ============================================================================
//
// This file wires all the reward mechanics together. See
// .kiro/steering/rewards-spec.md for the full architecture & dopamine loop
// rationale.
//
// Endpoints (all authed, all rate-limited):
//   GET  /api/user/rewards              — everything for the Rewards page
//   POST /api/user/rewards/claim        — claim a completed reward task
//   POST /api/user/rewards/track        — client-emitted events (watch_ad, share_app)
//   POST /api/user/rewards/spin         — spin the Lucky Wheel
//   POST /api/user/rewards/redeem-coupon — redeem a coupon code
//
// Coin credit path (used by every payout — claim, spin, coupon, achievement):
//   1. Load app_settings.reward_daily_budget_cap (0 = unlimited).
//   2. Load today's coins_paid from reward_budget_daily.
//   3. If cap > 0 and (coins_paid + payout) > cap → return 429.
//   4. Batch: UPDATE users.coins  +  UPSERT source-table state
//                 +  INSERT coin_transactions
//                 +  UPSERT reward_budget_daily (+= payout)
//   Any failure rolls the whole batch back.
//
// The batch guarantees that the coin ledger, the reward-side state, and the
// budget counter are always in sync — even under concurrent requests.

const rewards = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
rewards.use('*', authMiddleware);

const RL_CLAIM_PER_MIN = 20;
const RL_TRACK_PER_MIN = 60;
const RL_SPIN_PER_MIN = 30;
const RL_COUPON_PER_MIN = 10;

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
  current_count: number | null;
  claim_count: number | null;
  last_claimed_at: number | null;
  total_earned: number | null;
}

interface CampaignRow {
  id: string;
  code: string;
  title: string;
  description: string;
  banner_image_url: string;
  starts_at: number;
  ends_at: number;
  multiplier: number;
  applies_to_task_types: string;
  applies_to_spin: number;
  active: number;
}

interface CouponRow {
  id: string;
  code: string;
  coins_reward: number;
  max_uses: number | null;
  used_count: number;
  per_user_limit: number;
  expires_at: number | null;
  active: number;
}

interface AchievementRow {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  tier: string;
  trigger_type: string;
  trigger_threshold: number;
  coins_reward: number;
  active: number;
  // 0 = evergreen; N > 0 = rolling N-day quest window from first progress.
  duration_days: number;
  // Admin-driven display order. Ties are broken by this value inside every
  // urgency bucket produced by the /rewards response sort.
  sort_order: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function utcDayKey(ts: number = Math.floor(Date.now() / 1000)): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Read a single app_settings entry with a typed default.
 * Never throws — a missing key or DB error returns `fallback`.
 */
async function readSetting<T>(
  db: D1Database,
  key: string,
  fallback: T,
  parse: (raw: string) => T,
): Promise<T> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (!row?.value) return fallback;
    return parse(row.value);
  } catch {
    return fallback;
  }
}

const parseInt10 = (s: string) => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
};
const parseBool = (s: string) => s === '1' || s.toLowerCase() === 'true';

/**
 * Fetch the currently-active campaign that gives the biggest multiplier for a
 * given task type (or spin, when `forSpin` is true). Returns null if no
 * campaign is currently active.
 */
async function activeCampaignFor(
  db: D1Database,
  now: number,
  taskType: string | null,
  forSpin: boolean,
): Promise<CampaignRow | null> {
  if (!(await readSetting(db, 'reward_campaigns_enabled', true, parseBool))) return null;
  const res = await db
    .prepare(
      `SELECT * FROM reward_campaigns
        WHERE active = 1 AND starts_at <= ? AND ends_at >= ?
        ORDER BY multiplier DESC, created_at DESC`,
    )
    .bind(now, now)
    .all<CampaignRow>();
  const rows = res.results ?? [];
  for (const r of rows) {
    if (forSpin) {
      if (r.applies_to_spin === 1) return r;
      continue;
    }
    if (!taskType) continue;
    const csv = (r.applies_to_task_types ?? '').trim();
    if (csv === '') return r; // applies to all task types
    const set = new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
    if (set.has(taskType)) return r;
  }
  return null;
}

/**
 * Apply the budget-cap check: return true if adding `amount` coins today
 * would push the daily total OVER the configured cap. Cap of 0 = unlimited.
 * Read-only — actual UPSERT of the counter happens inside the payout batch.
 */
async function wouldExceedBudget(
  db: D1Database,
  amount: number,
): Promise<{ exceeded: boolean; cap: number; today: number }> {
  const cap = await readSetting(db, 'reward_daily_budget_cap', 0, parseInt10);
  if (!Number.isFinite(cap) || cap <= 0) return { exceeded: false, cap: 0, today: 0 };
  const today = utcDayKey();
  const row = await db
    .prepare('SELECT coins_paid FROM reward_budget_daily WHERE day_key = ?')
    .bind(today)
    .first<{ coins_paid: number }>();
  const paid = Number(row?.coins_paid ?? 0);
  return { exceeded: paid + amount > cap, cap, today: paid };
}

/**
 * Statement that inserts-or-increments today's budget counter. Included in
 * every payout batch so cap accounting is atomic with the coin credit.
 */
function budgetIncrementStmt(db: D1Database, coins: number) {
  const day = utcDayKey();
  const now = Math.floor(Date.now() / 1000);
  return db
    .prepare(
      `INSERT INTO reward_budget_daily (day_key, coins_paid, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(day_key) DO UPDATE SET coins_paid = coins_paid + ?, updated_at = ?`,
    )
    .bind(day, coins, now, coins, now);
}

/**
 * Read a user's lifetime cumulative counter for a trigger_type.
 * Returns 0 if no counter row exists yet.
 */
async function readTriggerCounter(
  db: D1Database,
  userId: string,
  triggerType: string,
): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT count FROM user_trigger_counters WHERE user_id = ? AND trigger_type = ?')
      .bind(userId, triggerType)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  } catch (err) {
    console.warn('[rewards] readTriggerCounter failed:', err);
    return 0;
  }
}

/**
 * Evaluate every achievement whose `trigger_type` matches the event that just
 * bumped `user_trigger_counters`. Each achievement carries an independent
 * rolling window (`duration_days`) — this function:
 *
 *   1. Loads the user's per-achievement progress row (creates it lazily).
 *   2. If the window has expired without an unlock, RESETS the counter and
 *      starts a fresh window (the user gets to try the quest again).
 *   3. Increments the counter by `delta` and stamps `started_at` on the
 *      first hit.
 *   4. If the counter has just crossed the threshold, unlocks the
 *      achievement (records `user_achievements` + credits coins).
 *
 * Best-effort — any failure is swallowed and logged; the caller has already
 * committed the coin credit for the underlying task/spin/coupon.
 */
async function checkAndUnlockAchievements(
  db: D1Database,
  userId: string,
  triggerType: string,
  delta: number,
): Promise<number> {
  const enabled = await readSetting(db, 'reward_achievements_enabled', true, parseBool);
  if (!enabled) return 0;

  // All still-locked, active achievements matching this trigger. The LEFT
  // JOIN filters out any the user has already unlocked so we don't waste a
  // window row on completed quests.
  const list = await db
    .prepare(
      `SELECT a.*, up.current_count AS up_count, up.started_at AS up_started_at
         FROM reward_achievements a
         LEFT JOIN user_achievements ua
                ON ua.achievement_id = a.id AND ua.user_id = ?
         LEFT JOIN user_achievement_progress up
                ON up.achievement_id = a.id AND up.user_id = ?
        WHERE a.active = 1 AND a.trigger_type = ? AND ua.user_id IS NULL`,
    )
    .bind(userId, userId, triggerType)
    .all<AchievementRow & { up_count: number | null; up_started_at: number | null }>();

  let awarded = 0;
  const now = Math.floor(Date.now() / 1000);
  const deltaInt = Math.floor(delta);

  for (const ach of list.results ?? []) {
    const durationDays = Number(ach.duration_days) || 0;
    const threshold = Number(ach.trigger_threshold) || 0;
    const priorCount = Number(ach.up_count ?? 0);
    const startedAt = ach.up_started_at != null ? Number(ach.up_started_at) : null;

    // Decide whether the current window is still valid. Evergreen quests
    // (duration_days = 0) never expire; time-bound ones expire once
    // `started_at + duration_days*86400` is in the past.
    const windowExpired =
      durationDays > 0 &&
      startedAt != null &&
      now >= startedAt + durationDays * 86400;

    let nextCount: number;
    let nextStartedAt: number;
    if (startedAt == null) {
      // First time this achievement is seeing per-user progress. For evergreen
      // quests (duration_days = 0) we honour the LIFETIME trigger counter so a
      // newly-added milestone unlocks retroactively for users who already
      // performed the underlying action (e.g. admin adds "First Call" long
      // after the user has completed 100 calls). Time-bound quests always
      // start fresh from this bump so their window is meaningful.
      if (durationDays === 0) {
        // bumpRewardProgress has already incremented user_trigger_counters
        // by deltaInt BEFORE calling us, so the lifetime count already
        // includes this bump.
        nextCount = await readTriggerCounter(db, userId, triggerType);
        if (nextCount <= 0) nextCount = deltaInt; // safety net
      } else {
        nextCount = deltaInt;
      }
      nextStartedAt = now;
    } else if (windowExpired) {
      // Fresh restart after an expired window (only reachable when
      // duration_days > 0 and the user missed the deadline).
      nextCount = deltaInt;
      nextStartedAt = now;
    } else {
      nextCount = priorCount + deltaInt;
      nextStartedAt = startedAt;
    }

    // Persist the updated window state.
    try {
      await db
        .prepare(
          `INSERT INTO user_achievement_progress
             (user_id, achievement_id, current_count, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, achievement_id) DO UPDATE SET
             current_count = ?,
             started_at    = ?,
             updated_at    = ?`,
        )
        .bind(userId, ach.id, nextCount, nextStartedAt, now, nextCount, nextStartedAt, now)
        .run();
    } catch (err) {
      console.warn('[rewards] user_achievement_progress upsert failed:', err);
      continue;
    }

    // Threshold check — only unlock if the fresh count meets or exceeds it.
    if (threshold > 0 && nextCount < threshold) continue;

    const coins = Number(ach.coins_reward) || 0;
    // Budget cap short-circuit — record the badge without the coin credit
    // if the daily cap would be breached. Keeps the visual reward even
    // under budget pressure.
    const { exceeded } = await wouldExceedBudget(db, coins);
    const willCredit = coins > 0 && !exceeded;

    try {
      // ── Phase 1 ──────────────────────────────────────────────────────
      // Race-safe unlock: INSERT OR IGNORE is atomic on the composite
      // PRIMARY KEY (user_id, achievement_id). At most ONE concurrent
      // caller sees meta.changes === 1; every other caller sees 0 and
      // MUST NOT credit coins (otherwise the achievement pays out twice).
      const claim = await db
        .prepare(
          `INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at, coins_awarded)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(userId, ach.id, now, willCredit ? coins : 0)
        .run();
      if (!claim.meta?.changes) continue; // lost the race — another request already unlocked

      // ── Phase 2 ──────────────────────────────────────────────────────
      // We own the unlock slot. Credit coins if the achievement has a
      // reward AND the daily budget has room. Failure here is logged but
      // NOT retried — the badge stays, and the user can be reconciled
      // manually via the admin panel if the coin credit truly fails.
      if (willCredit) {
        const txId = crypto.randomUUID();
        try {
          await db.batch([
            db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(coins, userId),
            db
              .prepare(
                'INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
              )
              .bind(txId, userId, 'bonus', coins, `Achievement: ${ach.title}`, ach.id),
            budgetIncrementStmt(db, coins),
          ]);
          awarded += coins;
        } catch (err) {
          console.warn('[rewards] achievement coin credit failed (badge already recorded):', err);
        }
      }
    } catch (err) {
      console.warn('[rewards] achievement unlock failed:', err);
    }
  }
  return awarded;
}

// ─── Per-user daily spin state helper ───────────────────────────────────────
async function ensureSpinState(
  db: D1Database,
  userId: string,
): Promise<{
  free_spins_remaining: number;
  earned_spins_remaining: number;
  total_spins: number;
  total_coins_won: number;
}> {
  const cfg = await db.prepare('SELECT enabled, daily_free_spins FROM reward_spin_config WHERE id = ?').bind('default').first<{ enabled: number; daily_free_spins: number }>();
  if (!cfg || !cfg.enabled) {
    return { free_spins_remaining: 0, earned_spins_remaining: 0, total_spins: 0, total_coins_won: 0 };
  }
  const today = utcDayKey();
  const now = Math.floor(Date.now() / 1000);
  const daily = Number(cfg.daily_free_spins) || 0;

  const existing = await db
    .prepare('SELECT * FROM user_spin_state WHERE user_id = ?')
    .bind(userId)
    .first<{ free_spins_remaining: number; earned_spins_remaining: number; last_free_reset_day: string; total_spins: number; total_coins_won: number }>();

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO user_spin_state (user_id, free_spins_remaining, last_free_reset_day, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(userId, daily, today, now)
      .run();
    return { free_spins_remaining: daily, earned_spins_remaining: 0, total_spins: 0, total_coins_won: 0 };
  }

  // Reset the daily counter if we've rolled into a new UTC day.
  if (existing.last_free_reset_day !== today) {
    await db
      .prepare(
        `UPDATE user_spin_state
            SET free_spins_remaining = ?, last_free_reset_day = ?, updated_at = ?
          WHERE user_id = ?`,
      )
      .bind(daily, today, now, userId)
      .run();
    return {
      free_spins_remaining: daily,
      earned_spins_remaining: Number(existing.earned_spins_remaining) || 0,
      total_spins: Number(existing.total_spins) || 0,
      total_coins_won: Number(existing.total_coins_won) || 0,
    };
  }

  return {
    free_spins_remaining: Number(existing.free_spins_remaining) || 0,
    earned_spins_remaining: Number(existing.earned_spins_remaining) || 0,
    total_spins: Number(existing.total_spins) || 0,
    total_coins_won: Number(existing.total_coins_won) || 0,
  };
}

// ─── Derive claimable / cooldown state for a task row ───────────────────────
function deriveState(row: TaskRow, now: number) {
  const currentCount = Number(row.current_count) || 0;
  const claimCount = Number(row.claim_count) || 0;
  const lastClaimedAt = row.last_claimed_at != null ? Number(row.last_claimed_at) : null;
  const cooldownSec = Number(row.cooldown_hours) * 3600;
  const isOneTime = cooldownSec === 0;
  const cooldownRemaining = !isOneTime && lastClaimedAt ? Math.max(0, lastClaimedAt + cooldownSec - now) : 0;
  const meetsTarget = row.task_type === 'daily_checkin' ? true : currentCount >= Number(row.target_count);
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
  const db = c.env.DB;

  // Tasks (join with progress)
  const taskRes = await db
    .prepare(
      `SELECT t.id, t.code, t.title, t.description, t.icon, t.category, t.task_type,
              t.target_count, t.coins_reward, t.cooldown_hours, t.cta_link,
              t.active, t.sort_order,
              p.current_count, p.claim_count, p.last_claimed_at, p.total_earned
         FROM reward_tasks t
         LEFT JOIN user_reward_progress p ON p.task_id = t.id AND p.user_id = ?
        WHERE t.active = 1
        ORDER BY t.sort_order ASC, t.created_at ASC`,
    )
    .bind(sub)
    .all<TaskRow>();

  const tasks = (taskRes.results ?? []).map((r) => {
    const state = deriveState(r, now);
    return {
      id: r.id, code: r.code, title: r.title, description: r.description,
      icon: r.icon, category: r.category, task_type: r.task_type,
      target_count: Number(r.target_count),
      coins_reward: Number(r.coins_reward),
      cooldown_hours: Number(r.cooldown_hours),
      cta_link: r.cta_link,
      ...state,
    };
  });
  const totalEarned = tasks.reduce((s, t) => s + t.total_earned, 0);
  const claimableCount = tasks.filter((t) => t.claimable).length;

  // Active campaigns (multiple; client shows a banner slider)
  const campaignRes = await db
    .prepare(
      `SELECT * FROM reward_campaigns
        WHERE active = 1 AND starts_at <= ? AND ends_at >= ?
        ORDER BY multiplier DESC, created_at DESC`,
    )
    .bind(now, now)
    .all<CampaignRow>();
  const campaigns = (campaignRes.results ?? []).map((r) => ({
    id: r.id, code: r.code, title: r.title, description: r.description,
    banner_image_url: r.banner_image_url,
    starts_at: Number(r.starts_at),
    ends_at: Number(r.ends_at),
    multiplier: Number(r.multiplier),
    applies_to_task_types: (r.applies_to_task_types ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    applies_to_spin: !!r.applies_to_spin,
    ends_in_sec: Math.max(0, Number(r.ends_at) - now),
  }));

  // Spin state
  const spinEnabled = await readSetting(db, 'reward_spin_enabled', true, parseBool);
  let spin: {
    enabled: boolean;
    free_spins_remaining: number;
    earned_spins_remaining: number;
    segments: Array<{ label: string; coins: number; weight: number; color: string; emoji: string }>;
    total_spins: number;
    total_coins_won: number;
  } | null = null;
  if (spinEnabled) {
    const cfg = await db
      .prepare('SELECT segments FROM reward_spin_config WHERE id = ?')
      .bind('default')
      .first<{ segments: string }>();
    let segments: Array<{ label: string; coins: number; weight: number; color: string; emoji: string }> = [];
    try { segments = JSON.parse(cfg?.segments ?? '[]'); } catch { segments = []; }
    const s = await ensureSpinState(db, sub);
    spin = {
      enabled: true,
      free_spins_remaining: s.free_spins_remaining,
      earned_spins_remaining: s.earned_spins_remaining,
      segments,
      total_spins: s.total_spins,
      total_coins_won: s.total_coins_won,
    };
  }

  // Achievements — hydrate with per-achievement PROGRESS + WINDOW state so
  // the client can render a live '27/50' progress bar AND an accurate
  // 'X days left' quest countdown for time-bound achievements.
  const achEnabled = await readSetting(db, 'reward_achievements_enabled', true, parseBool);
  let achievements: Array<{
    id: string; code: string; title: string; description: string;
    icon: string; tier: string; trigger_type: string; sort_order: number;
    expiring_soon: boolean;
    trigger_threshold: number; coins_reward: number;
    duration_days: number;
    current_progress: number; progress_pct: number;
    started_at: number | null;
    expires_at: number | null;
    seconds_remaining: number | null;
    window_expired: boolean;
    unlocked: boolean; unlocked_at: number | null;
  }> = [];
  if (achEnabled) {
    // Joined single query: achievement config + unlock state + rolling window
    // state. Every locked achievement reports its per-user progress if it has
    // been touched at least once; untouched ones report 0/threshold.
    const achRes = await db
      .prepare(
        `SELECT a.*,
                ua.unlocked_at,
                up.current_count AS up_count,
                up.started_at    AS up_started_at
           FROM reward_achievements a
           LEFT JOIN user_achievements ua
                  ON ua.achievement_id = a.id AND ua.user_id = ?
           LEFT JOIN user_achievement_progress up
                  ON up.achievement_id = a.id AND up.user_id = ?
          WHERE a.active = 1
          ORDER BY a.sort_order ASC`,
      )
      .bind(sub, sub)
      .all<AchievementRow & {
        unlocked_at: number | null;
        up_count: number | null;
        up_started_at: number | null;
      }>();

    achievements = (achRes.results ?? []).map((r) => {
      const threshold = Number(r.trigger_threshold) || 0;
      const durationDays = Number(r.duration_days) || 0;
      const startedAt = r.up_started_at != null ? Number(r.up_started_at) : null;
      const expiresAt = durationDays > 0 && startedAt != null
        ? startedAt + durationDays * 86400
        : null;
      const secondsRemaining = expiresAt != null ? Math.max(0, expiresAt - now) : null;
      const windowExpired = expiresAt != null && secondsRemaining === 0 && r.unlocked_at == null;

      // If the window has expired without an unlock, the count effectively
      // resets to 0 (it'll be re-stamped on the next bump). Reflect that in
      // the response so the UI doesn't show a stale progress bar.
      const rawCount = windowExpired ? 0 : Number(r.up_count ?? 0);
      const progress = threshold > 0 ? Math.min(rawCount, threshold) : rawCount;
      const pct = threshold > 0 ? Math.min(100, Math.round((rawCount / threshold) * 100)) : 0;

      return {
        id: r.id, code: r.code, title: r.title, description: r.description,
        icon: r.icon, tier: r.tier, trigger_type: r.trigger_type,
        trigger_threshold: threshold,
        coins_reward: Number(r.coins_reward),
        duration_days: durationDays,
        current_progress: progress,
        progress_pct: pct,
        started_at: startedAt,
        expires_at: expiresAt,
        seconds_remaining: secondsRemaining,
        window_expired: windowExpired,
        unlocked: r.unlocked_at != null,
        unlocked_at: r.unlocked_at != null ? Number(r.unlocked_at) : null,
        // Client-facing urgency flag — "expiring within 24 hours". Lets the
        // rewards page slap a red pill on time-bound quests about to run
        // out, without every consumer duplicating the math.
        expiring_soon: secondsRemaining != null && secondsRemaining > 0 && secondsRemaining <= 86400,
        // `sort_order` from the DB — surfaced so any client that wants to
        // fall back to admin ordering can (server default is urgency).
        sort_order: Number(r.sort_order) || 100,
      };
    });

    // ── Client-facing sort: URGENCY-FIRST, not admin sort_order.
    // A user with a "5 days left" quest and a "10 minutes left" quest
    // needs to see the 10-minute one first, otherwise the whole rolling-
    // window mechanic is invisible. Priority buckets, top → bottom:
    //   1. Already unlocked (celebration UI — pin to top)
    //   2. In-progress AND expiring within 24 h (red, act now)
    //   3. In-progress, more than 24 h left (normal quest state)
    //   4. Not started yet (fresh quests, no timer)
    //   5. Window expired without unlock (reset queue, low priority)
    // Within a bucket we defer to admin sort_order so admins keep some
    // control over layout.
    const bucket = (a: typeof achievements[number]): number => {
      if (a.unlocked) return 1;
      if (a.window_expired) return 5;
      if (a.expiring_soon) return 2;
      if (a.started_at != null) return 3;
      return 4;
    };
    achievements.sort((a, b) => {
      const ba = bucket(a), bb = bucket(b);
      if (ba !== bb) return ba - bb;
      // Within "expiring soon" bucket, LEAST time-remaining first.
      if (ba === 2) {
        const sa = a.seconds_remaining ?? Number.MAX_SAFE_INTEGER;
        const sb = b.seconds_remaining ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
      }
      // Within "unlocked" bucket, most recently unlocked first (feels like
      // a fresh trophy shelf every time the user opens the page).
      if (ba === 1) {
        const ua = a.unlocked_at ?? 0, ub = b.unlocked_at ?? 0;
        if (ua !== ub) return ub - ua;
      }
      return a.sort_order - b.sort_order;
    });
  }

  return c.json({
    tasks, total_earned: totalEarned, claimable_count: claimableCount,
    campaigns, spin, achievements,
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
  const taskId = typeof (body as { task_id?: unknown })?.task_id === 'string' ? (body as { task_id: string }).task_id.slice(0, 64) : '';
  if (!taskId) return c.json({ error: 'task_id required' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const db = c.env.DB;

  const task = await db.prepare('SELECT * FROM reward_tasks WHERE id = ? AND active = 1').bind(taskId).first<TaskRow>();
  if (!task) return c.json({ error: 'Task not found or inactive' }, 404);

  const progress = await db.prepare('SELECT * FROM user_reward_progress WHERE user_id = ? AND task_id = ?').bind(sub, taskId).first<TaskRow>();

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
      { error: state.cooldown_remaining_sec > 0 ? 'Cooldown active' : 'Already claimed', cooldown_remaining_sec: state.cooldown_remaining_sec },
      state.cooldown_remaining_sec > 0 ? 429 : 409,
    );
  }
  if (!state.claimable) {
    return c.json({ error: 'Task not yet completed', current: state.current_count, target: Number(task.target_count) }, 409);
  }

  // Apply campaign multiplier (if any).
  const campaign = await activeCampaignFor(db, now, task.task_type, false);
  const baseReward = Number(task.coins_reward);
  const multiplier = campaign ? Number(campaign.multiplier) : 1;
  const coinsReward = Math.max(0, Math.round(baseReward * multiplier));

  // Budget cap.
  const { exceeded, cap } = await wouldExceedBudget(db, coinsReward);
  if (exceeded) {
    return c.json({ error: 'daily_budget_reached', message: 'The daily reward budget has been reached. Please try again tomorrow.' }, 429);
  }

  const cooldownSec = Number(task.cooldown_hours) * 3600;
  const isOneTime = cooldownSec === 0;
  const nextCount = isOneTime ? state.current_count : 0;
  const targetCount = Number(task.target_count);

  // ── Phase 1: race-safe claim CAS ──────────────────────────────────────
  // Ensure the progress row exists so the UPDATE below has something to
  // hit. INSERT OR IGNORE is idempotent — never overwrites existing rows.
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_reward_progress
         (user_id, task_id, current_count, claim_count, last_claimed_at, total_earned, updated_at)
       VALUES (?, ?, 0, 0, NULL, 0, ?)`,
    )
    .bind(sub, taskId, now)
    .run();

  // Atomic CAS: the WHERE clause is the race guard — only the FIRST
  // concurrent claim sees changes === 1. Any duplicate/replay hits 0.
  //   - One-time tasks (cooldown = 0) require claim_count = 0.
  //   - Recurring tasks require the cooldown to be fully elapsed.
  //   - daily_checkin skips the target_count check; all others require the
  //     counter to have reached the target.
  const claim = task.task_type === 'daily_checkin'
    ? await db
        .prepare(
          `UPDATE user_reward_progress
              SET claim_count     = claim_count + 1,
                  last_claimed_at = ?,
                  current_count   = ?,
                  total_earned    = total_earned + ?,
                  updated_at      = ?
            WHERE user_id = ? AND task_id = ?
              AND (last_claimed_at IS NULL OR last_claimed_at + ? <= ?)`,
        )
        .bind(now, nextCount, coinsReward, now, sub, taskId, cooldownSec, now)
        .run()
    : isOneTime
    ? await db
        .prepare(
          `UPDATE user_reward_progress
              SET claim_count     = 1,
                  last_claimed_at = ?,
                  current_count   = ?,
                  total_earned    = total_earned + ?,
                  updated_at      = ?
            WHERE user_id = ? AND task_id = ?
              AND claim_count = 0
              AND current_count >= ?`,
        )
        .bind(now, nextCount, coinsReward, now, sub, taskId, targetCount)
        .run()
    : await db
        .prepare(
          `UPDATE user_reward_progress
              SET claim_count     = claim_count + 1,
                  last_claimed_at = ?,
                  current_count   = ?,
                  total_earned    = total_earned + ?,
                  updated_at      = ?
            WHERE user_id = ? AND task_id = ?
              AND (last_claimed_at IS NULL OR last_claimed_at + ? <= ?)
              AND current_count >= ?`,
        )
        .bind(now, nextCount, coinsReward, now, sub, taskId, cooldownSec, now, targetCount)
        .run();

  if (!claim.meta?.changes) {
    // Race lost: another concurrent request already claimed, OR the
    // client's optimistic UI is out of sync with server state.
    return c.json(
      { error: 'already_claimed_or_locked', cooldown_remaining_sec: state.cooldown_remaining_sec },
      409,
    );
  }

  // ── Phase 2: credit coins + ledger ────────────────────────────────────
  // We own the claim slot. If this batch fails we need to roll back the
  // progress row we just consumed to avoid a permanent stuck state.
  const txId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(coinsReward, sub),
      db
        .prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(txId, sub, 'bonus', coinsReward, `Reward: ${task.title}${campaign ? ` (×${multiplier})` : ''}`, taskId),
      budgetIncrementStmt(db, coinsReward),
    ]);
  } catch (err) {
    // Compensating rollback: undo the claim we just recorded. Best-effort
    // — if this fails too, the row is stuck at claim_count+1 until manual
    // intervention, which is preferable to double-crediting coins.
    console.warn('[rewards] claim credit batch failed; rolling back progress row:', err);
    await db
      .prepare(
        `UPDATE user_reward_progress
            SET claim_count     = MAX(0, claim_count - 1),
                last_claimed_at = ?,
                total_earned    = MAX(0, total_earned - ?),
                updated_at      = ?
          WHERE user_id = ? AND task_id = ?`,
      )
      .bind(state.last_claimed_at, coinsReward, now, sub, taskId)
      .run()
      .catch((e) => console.warn('[rewards] claim rollback failed:', e));
    return c.json({ error: 'credit_failed' }, 500);
  }

  const updated = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  if (coinsReward > 0) {
    c.executionCtx?.waitUntil?.(notifyUser(c.env, sub, '🎁 Reward Claimed!', `Nice work! You just earned ${coinsReward} coins from "${task.title}". Keep completing tasks for more! 💪`, 'reward'));
  }
  return c.json({
    ok: true,
    task_id: taskId,
    task_code: task.code,
    coins_awarded: coinsReward,
    base_reward: baseReward,
    multiplier,
    campaign_code: campaign?.code ?? null,
    new_balance: Number(updated?.coins ?? 0),
    next_cooldown_sec: cooldownSec,
    budget_cap: cap,
  });
});

// ─── POST /api/user/rewards/track ────────────────────────────────────────────
// Whitelisted CLIENT-side events + their per-user DAILY caps. Both entries
// are trivially forgeable by any authenticated client, so we protect the
// achievement counter (which unlocks coin-earning milestones) with two
// independent limits:
//
//   1. Per-minute rate limit (RL_TRACK_PER_MIN) — burst protection.
//   2. Per-UTC-day cap (below)                 — total forge budget.
//
// The daily cap is enforced with a checkRateLimit call whose window is
// 86 400 s and whose key is scoped to (event, user, day). Any calls beyond
// the cap return 429 without bumping progress — so a malicious client
// can't spam the endpoint to power-level 'watch_ad'/'share_app'
// achievements or tasks.
const CLIENT_TRACKABLE_EVENTS = new Set<string>(['watch_ad', 'share_app']);
const EVENT_DAILY_CAPS: Record<string, number> = {
  watch_ad:  10, // most aggressive publisher setup we support
  share_app: 3,  // one share per platform (WhatsApp / Telegram / native)
};
rewards.post('/track', async (c) => {
  const { sub } = c.get('user');
  const rlKey = `rl:reward_track:${sub}:${Math.floor(Date.now() / 60000)}`;
  const { limited } = await checkRateLimit(c.env.DB, rlKey, RL_TRACK_PER_MIN, 60);
  if (limited) return c.json({ error: 'rate_limited' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const event = typeof (body as { event?: unknown })?.event === 'string' ? (body as { event: string }).event.slice(0, 40) : '';
  if (!CLIENT_TRACKABLE_EVENTS.has(event)) return c.json({ error: 'event not allowed' }, 400);

  // Daily cap — client-forgeable events can never bump progress more than
  // `EVENT_DAILY_CAPS[event]` times per UTC day per user.
  const dailyCap = EVENT_DAILY_CAPS[event] ?? 5;
  const dayKey = utcDayKey();
  const dailyKey = `event_daily_cap:${event}:${sub}:${dayKey}`;
  const { limited: dailyLimited } = await checkRateLimit(c.env.DB, dailyKey, dailyCap, 86400);
  if (dailyLimited) {
    return c.json({ error: 'daily_cap_reached', event, daily_cap: dailyCap }, 429);
  }

  const updated = await bumpRewardProgress(c.env.DB, sub, event, 1);
  return c.json({ ok: true, tasks_updated: updated });
});

// ─── POST /api/user/rewards/spin ─────────────────────────────────────────────
rewards.post('/spin', async (c) => {
  const { sub } = c.get('user');
  const rlKey = `rl:reward_spin:${sub}:${Math.floor(Date.now() / 60000)}`;
  const { limited } = await checkRateLimit(c.env.DB, rlKey, RL_SPIN_PER_MIN, 60);
  if (limited) return c.json({ error: 'rate_limited' }, 429);

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const spinEnabled = await readSetting(db, 'reward_spin_enabled', true, parseBool);
  if (!spinEnabled) return c.json({ error: 'spin_disabled' }, 403);

  const cfg = await db.prepare('SELECT enabled, daily_free_spins, segments FROM reward_spin_config WHERE id = ?').bind('default').first<{ enabled: number; daily_free_spins: number; segments: string }>();
  if (!cfg || !cfg.enabled) return c.json({ error: 'spin_disabled' }, 403);

  let segments: Array<{ label: string; coins: number; weight: number; color: string; emoji: string }> = [];
  try { segments = JSON.parse(cfg.segments ?? '[]'); } catch { /* corrupt config */ }
  // Track the ORIGINAL index alongside each valid segment so we can point
  // the wheel to the exact slot the server picked — even if two segments
  // share identical (label, coins, color). A plain findIndex() after the
  // fact returns the FIRST match and would visually mis-align the wheel.
  const filtered: Array<{ segment: (typeof segments)[number]; originalIndex: number }> = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (Number.isFinite(s.coins) && Number.isFinite(s.weight) && s.weight > 0) {
      filtered.push({ segment: s, originalIndex: i });
    }
  }
  if (filtered.length === 0) return c.json({ error: 'no_segments' }, 500);

  // Ensure spin state + roll the free-spin quota if it's a new UTC day.
  const state = await ensureSpinState(db, sub);
  if (state.free_spins_remaining <= 0 && state.earned_spins_remaining <= 0) {
    return c.json({ error: 'no_spins_left', free_spins_remaining: 0, earned_spins_remaining: 0 }, 409);
  }
  const useFree = state.free_spins_remaining > 0;

  // Weighted random selection — cumulative-weight bucket lookup.
  const totalWeight = filtered.reduce((s, seg) => s + Number(seg.segment.weight), 0);
  let pick = Math.random() * totalWeight;
  let selectedIdx = 0;
  for (let i = 0; i < filtered.length; i++) {
    pick -= Number(filtered[i].segment.weight);
    if (pick <= 0) { selectedIdx = i; break; }
  }
  const { segment, originalIndex } = filtered[selectedIdx];
  const baseCoins = Number(segment.coins);

  // Campaign multiplier — some campaigns also multiply spin wins.
  const campaign = await activeCampaignFor(db, now, null, true);
  const multiplier = campaign ? Number(campaign.multiplier) : 1;
  const coinsWon = Math.max(0, Math.round(baseCoins * multiplier));

  // Budget cap.
  const { exceeded, cap } = await wouldExceedBudget(db, coinsWon);
  if (exceeded) {
    return c.json({ error: 'daily_budget_reached' }, 429);
  }

  // ── Phase 1: race-safe spin decrement ─────────────────────────────────
  // Two concurrent /spin requests both pass the state check above; we
  // guard the actual decrement with a WHERE clause so at most ONE wins.
  // Failure to win means the user has already spent this spin — return
  // 409 without crediting coins.
  const decrement = useFree
    ? await db
        .prepare(
          `UPDATE user_spin_state
              SET free_spins_remaining = free_spins_remaining - 1,
                  total_spins          = total_spins + 1,
                  total_coins_won      = total_coins_won + ?,
                  last_win_amount      = ?,
                  last_spun_at         = ?,
                  updated_at           = ?
            WHERE user_id = ? AND free_spins_remaining > 0`,
        )
        .bind(coinsWon, coinsWon, now, now, sub)
        .run()
    : await db
        .prepare(
          `UPDATE user_spin_state
              SET earned_spins_remaining = earned_spins_remaining - 1,
                  total_spins            = total_spins + 1,
                  total_coins_won        = total_coins_won + ?,
                  last_win_amount        = ?,
                  last_spun_at           = ?,
                  updated_at             = ?
            WHERE user_id = ? AND earned_spins_remaining > 0`,
        )
        .bind(coinsWon, coinsWon, now, now, sub)
        .run();

  if (!decrement.meta?.changes) {
    return c.json(
      { error: 'no_spins_left', free_spins_remaining: 0, earned_spins_remaining: 0 },
      409,
    );
  }

  // ── Phase 2: credit coins + ledger ────────────────────────────────────
  const spinId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(coinsWon, sub),
      db.prepare('INSERT INTO reward_spin_history (id, user_id, segment_index, segment_label, coins_won, campaign_id, spun_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(spinId, sub, originalIndex, segment.label, coinsWon, campaign?.id ?? null, now),
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), sub, 'bonus', coinsWon, `Lucky Spin: ${segment.label}${campaign ? ` (×${multiplier})` : ''}`, spinId),
      budgetIncrementStmt(db, coinsWon),
    ]);
  } catch (err) {
    // Compensating rollback: restore the spin slot we just consumed.
    console.warn('[rewards] spin credit batch failed; rolling back spin slot:', err);
    const col = useFree ? 'free_spins_remaining' : 'earned_spins_remaining';
    await db
      .prepare(
        `UPDATE user_spin_state
            SET ${col} = ${col} + 1,
                total_spins = MAX(0, total_spins - 1),
                total_coins_won = MAX(0, total_coins_won - ?),
                updated_at = ?
          WHERE user_id = ?`,
      )
      .bind(coinsWon, now, sub)
      .run()
      .catch((e) => console.warn('[rewards] spin rollback failed:', e));
    return c.json({ error: 'credit_failed' }, 500);
  }

  const updated = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  if (coinsWon > 0) {
    c.executionCtx?.waitUntil?.(notifyUser(c.env, sub, '🎰 Jackpot! Lucky Spin Win!', `Congratulations! 🎉 The wheel loves you — you won ${coinsWon} coins! Spin again tomorrow for more. 🍀`, 'reward'));
  }

  return c.json({
    ok: true,
    segment_index: originalIndex,
    segment_label: segment.label,
    base_coins: baseCoins,
    coins_won: coinsWon,
    multiplier,
    campaign_code: campaign?.code ?? null,
    used_free: useFree,
    free_spins_remaining: useFree ? state.free_spins_remaining - 1 : state.free_spins_remaining,
    earned_spins_remaining: useFree ? state.earned_spins_remaining : state.earned_spins_remaining - 1,
    new_balance: Number(updated?.coins ?? 0),
    budget_cap: cap,
  });
});

// ─── POST /api/user/rewards/redeem-coupon ────────────────────────────────────
rewards.post('/redeem-coupon', async (c) => {
  const { sub } = c.get('user');
  const rlKey = `rl:reward_coupon:${sub}:${Math.floor(Date.now() / 60000)}`;
  const { limited } = await checkRateLimit(c.env.DB, rlKey, RL_COUPON_PER_MIN, 60);
  if (limited) return c.json({ error: 'rate_limited' }, 429);

  const enabled = await readSetting(c.env.DB, 'reward_coupons_enabled', true, parseBool);
  if (!enabled) return c.json({ error: 'coupons_disabled' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const raw = typeof (body as { code?: unknown })?.code === 'string' ? (body as { code: string }).code : '';
  const code = raw.trim().slice(0, 40).toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return c.json({ error: 'invalid_code' }, 400);

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);

  const coupon = await db.prepare('SELECT * FROM reward_coupons WHERE code = ? AND active = 1').bind(code).first<CouponRow>();
  if (!coupon) return c.json({ error: 'coupon_not_found' }, 404);
  if (coupon.expires_at && Number(coupon.expires_at) < now) return c.json({ error: 'coupon_expired' }, 410);
  if (coupon.max_uses != null && Number(coupon.used_count) >= Number(coupon.max_uses)) return c.json({ error: 'coupon_exhausted' }, 410);

  // Fast-path per-user-limit check (avoids doing the atomic CAS below when
  // the answer is obviously "no" — saves a write to reward_coupons.used_count
  // for the common "already redeemed" case). The AUTHORITATIVE, race-safe
  // per-user check happens later via the atomic INSERT...SELECT...WHERE
  // guard (see below) — this table has NO unique index on (user_id, coupon_id)
  // (its PK includes redeemed_at), so that atomic guard is what actually
  // prevents a concurrent double-redemption, not this fast-path COUNT.
  const priorRedemptions = await db
    .prepare('SELECT COUNT(*) AS n FROM user_coupon_redemptions WHERE user_id = ? AND coupon_id = ?')
    .bind(sub, coupon.id)
    .first<{ n: number }>();
  if (Number(priorRedemptions?.n ?? 0) >= Number(coupon.per_user_limit)) {
    return c.json({ error: 'per_user_limit_reached' }, 409);
  }

  const coinsAwarded = Number(coupon.coins_reward);
  const { exceeded, cap } = await wouldExceedBudget(db, coinsAwarded);
  if (exceeded) return c.json({ error: 'daily_budget_reached' }, 429);

  // ── Phase 1: race-safe coupon claim ───────────────────────────────────
  // Atomic CAS on the global counter. The WHERE clause is the race guard:
  //   - max_uses IS NULL          → unlimited coupon, always passes
  //   - used_count < max_uses     → still has slots left, wins the race
  //   - active = 1                → admin didn't just disable it
  //   - expires_at check          → didn't just expire between SELECT and now
  // At most (max_uses) concurrent redemptions succeed; the rest see 0
  // changes and get a clean 410 without any coin credit.
  const claim = await db
    .prepare(
      `UPDATE reward_coupons
          SET used_count = used_count + 1
        WHERE id = ?
          AND active = 1
          AND (max_uses IS NULL OR used_count < max_uses)
          AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .bind(coupon.id, now)
    .run();

  if (!claim.meta?.changes) {
    return c.json({ error: 'coupon_exhausted' }, 410);
  }

  // FIX (double-credit race): user_coupon_redemptions has NO unique index on
  // (user_id, coupon_id) — its PK is (user_id, coupon_id, redeemed_at), so two
  // concurrent redemptions from the SAME user that land even one second apart
  // (very plausible for two overlapping requests, e.g. a double-tap or retry)
  // produce two DISTINCT rows: both pass the earlier non-atomic COUNT check
  // (each sees 0 prior redemptions before either INSERT lands), a plain
  // unconditional INSERT never rejects either one, and both proceed to Phase 2
  // and credit coins — a genuine double-credit on a per_user_limit=1 coupon,
  // despite the per-user-limit check above. The old code (and its own
  // comments) incorrectly assumed a UNIQUE(user_id, coupon_id) index existed.
  //
  // Fixed by making the per-user-limit check ATOMIC: fold the COUNT check
  // into the INSERT itself via INSERT...SELECT...WHERE, which SQLite/D1
  // executes as a single serialized statement — eliminating the TOCTOU
  // window between "check count" and "insert row" entirely (same pattern as
  // lib/transfers.ts's claimWithdrawal). insertResult.meta.changes === 0
  // means the per-user limit was already reached (lost the race or the
  // fast-path check above was stale).
  const insertResult = await db
    .prepare(
      `INSERT INTO user_coupon_redemptions (user_id, coupon_id, code, coins_awarded, redeemed_at)
       SELECT ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM user_coupon_redemptions WHERE user_id = ? AND coupon_id = ?) < ?`,
    )
    .bind(sub, coupon.id, code, coinsAwarded, now, sub, coupon.id, Number(coupon.per_user_limit))
    .run();

  if (!insertResult.meta?.changes) {
    // Roll back the global counter we just consumed.
    console.warn('[rewards] coupon per-user limit reached atomically; rolling back counter');
    await db
      .prepare('UPDATE reward_coupons SET used_count = MAX(0, used_count - 1) WHERE id = ?')
      .bind(coupon.id)
      .run()
      .catch((e) => console.warn('[rewards] coupon rollback failed:', e));
    return c.json({ error: 'per_user_limit_reached' }, 409);
  }

  // ── Phase 2: credit coins + ledger ────────────────────────────────────
  try {
    await db.batch([
      db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(coinsAwarded, sub),
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), sub, 'bonus', coinsAwarded, `Coupon: ${code}`, coupon.id),
      budgetIncrementStmt(db, coinsAwarded),
    ]);
  } catch (err) {
    // Compensating rollback: undo both the redemption row AND the counter.
    console.warn('[rewards] coupon credit batch failed; rolling back redemption:', err);
    await db.batch([
      db.prepare('DELETE FROM user_coupon_redemptions WHERE user_id = ? AND coupon_id = ? AND redeemed_at = ?').bind(sub, coupon.id, now),
      db.prepare('UPDATE reward_coupons SET used_count = MAX(0, used_count - 1) WHERE id = ?').bind(coupon.id),
    ]).catch((e) => console.warn('[rewards] coupon rollback batch failed:', e));
    return c.json({ error: 'credit_failed' }, 500);
  }

  const updated = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  if (coinsAwarded > 0) {
    c.executionCtx?.waitUntil?.(notifyUser(c.env, sub, '🎟️ Coupon Redeemed!', `Score! Coupon "${code}" worked like magic — ${coinsAwarded} coins added to your wallet. 🎉`, 'reward'));
  }
  return c.json({
    ok: true,
    code,
    coins_awarded: coinsAwarded,
    new_balance: Number(updated?.coins ?? 0),
    budget_cap: cap,
  });
});

export default rewards;

// ─── Server-side helper (used by call.ts, auth.ts, etc.) ────────────────────
/**
 * Increment `current_count` on every active task whose `task_type` matches,
 * then check achievements. Best-effort — never throws; returns the number of
 * tasks that were touched (0 if none).
 */
export async function bumpRewardProgress(
  db: D1Database,
  userId: string,
  triggerType: string,
  delta = 1,
): Promise<number> {
  if (!userId || !triggerType || !Number.isFinite(delta) || delta <= 0) return 0;

  const now = Math.floor(Date.now() / 1000);
  const deltaInt = Math.floor(delta);

  // 1) Upsert the lifetime trigger counter — the single source of truth for
  //    both task progress and achievement progress. This runs unconditionally,
  //    even when no reward_task exists for this trigger_type, so achievements
  //    tied to an event that has no matching task still accumulate progress.
  try {
    await db
      .prepare(
        `INSERT INTO user_trigger_counters (user_id, trigger_type, count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, trigger_type) DO UPDATE SET
           count = count + ?, updated_at = ?`,
      )
      .bind(userId, triggerType, deltaInt, now, deltaInt, now)
      .run();
  } catch (err) {
    console.warn('[rewards] trigger counter upsert failed:', err);
  }

  // 2) Bump matching active task rows so task cards update in real-time.
  let tasks: { id: string }[] = [];
  try {
    const res = await db
      .prepare('SELECT id FROM reward_tasks WHERE task_type = ? AND active = 1')
      .bind(triggerType)
      .all<{ id: string }>();
    tasks = res.results ?? [];
  } catch (err) {
    console.warn('[rewards] bumpRewardProgress: task lookup failed', err);
  }

  if (tasks.length) {
    const taskOps = tasks.map((t) =>
      db
        .prepare(
          `INSERT INTO user_reward_progress (user_id, task_id, current_count, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, task_id) DO UPDATE SET current_count = current_count + ?, updated_at = ?`,
        )
        .bind(userId, t.id, deltaInt, now, deltaInt, now),
    );
    try { await db.batch(taskOps); }
    catch (err) { console.warn('[rewards] bumpRewardProgress: task batch failed', err); }
  }

  // 3) Achievement check — pass THIS bump's delta so the per-achievement
  //    rolling window logic can decide whether to append or reset. The old
  //    "read lifetime counter and compare to threshold" flow is gone;
  //    duration_days-aware bookkeeping lives inside checkAndUnlockAchievements.
  try {
    await checkAndUnlockAchievements(db, userId, triggerType, deltaInt);
  } catch (err) {
    console.warn('[rewards] achievement check failed:', err);
  }

  return tasks.length;
}
