// ============================================================================
// Daily login streak — Layer 4 (engagement) of the coin economy.
// ============================================================================
//
// One claim per IST calendar day. Two-day grace window:
//   - Same calendar day (in IST) as last claim → "already claimed", no-op.
//   - Yesterday (IST) was last claim          → streak_days += 1.
//   - 2+ calendar days since last claim       → streak_days reset to 1.
//
// Reward = baseSchedule[(streak_days - 1) mod scheduleLen]
//        + milestones[streak_days]   (one-time, only the day the milestone hits)
//
// Both the schedule and the milestones live in app_settings so admins can
// retune the curve without a redeploy. Defaults are seeded by the schema
// guard (lib/schemaGuard.ts ensureStreakSchema) on first request.
//
// All time math is done in IST (Asia/Kolkata, UTC+5:30) since the user
// base is Indian. The "is this a new IST day?" test is integer division
// of `unixSeconds + IST_OFFSET_SEC` by 86400 — no Date object construction
// in the hot path.

const IST_OFFSET_SEC = 5 * 3600 + 30 * 60; // +05:30
const SECONDS_PER_DAY = 86400;

const DEFAULT_SCHEDULE: ReadonlyArray<number> = [5, 10, 15, 20, 30, 50, 100];
const DEFAULT_MILESTONES: Readonly<Record<string, number>> = {
  '7': 50,
  '14': 100,
  '30': 500,
  '60': 1500,
  '100': 5000,
};

export interface StreakStatus {
  streak_days: number;
  last_claim_at: number;
  /** Will the next /claim succeed right now? */
  can_claim_now: boolean;
  /** Unix-epoch seconds — earliest moment can_claim_now flips to true. */
  next_claim_at: number;
  /** Coins the user will earn if they claim right now. */
  next_reward: number;
  /** Pure schedule value (no milestone) for the upcoming day. */
  next_reward_base: number;
  /** Milestone bonus on the upcoming claim, 0 if no milestone hits. */
  next_reward_milestone: number;
  /** Schedule + milestones surfaced to the client for transparent display. */
  schedule: number[];
  milestones: Record<string, number>;
  /** Whether the daily streak feature is currently enabled by admin. */
  enabled: boolean;
}

export interface StreakClaimResult {
  success: boolean;
  /** False when the user already claimed today, or the feature is disabled. */
  claimed: boolean;
  code: 'OK' | 'ALREADY_CLAIMED' | 'FEATURE_DISABLED' | 'USER_NOT_FOUND';
  streak_days: number;
  reward: number;
  base_reward: number;
  milestone_bonus: number;
  next_claim_at: number;
  /** New coin balance after the credit (caller can update local state). */
  new_balance?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function startOfIstDay(unixSec: number): number {
  // Number of IST-days since the IST epoch ×  86400  → IST midnight in UTC.
  const dayIndex = Math.floor((unixSec + IST_OFFSET_SEC) / SECONDS_PER_DAY);
  return dayIndex * SECONDS_PER_DAY - IST_OFFSET_SEC;
}

function nextIstMidnight(unixSec: number): number {
  return startOfIstDay(unixSec) + SECONDS_PER_DAY;
}

async function readSetting(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function loadConfig(db: D1Database): Promise<{
  schedule: number[];
  milestones: Record<string, number>;
  enabled: boolean;
}> {
  // Each piece falls back to its DEFAULT_* if the row is missing or the JSON
  // is malformed. The streak system must keep working even when admin
  // settings are mid-edit / missing / corrupted.
  const [schStr, msStr, enStr] = await Promise.all([
    readSetting(db, 'daily_streak_schedule'),
    readSetting(db, 'daily_streak_milestones'),
    readSetting(db, 'daily_streak_enabled'),
  ]);

  let schedule: number[] = [...DEFAULT_SCHEDULE];
  if (schStr) {
    try {
      const parsed = JSON.parse(schStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        schedule = parsed
          .map((n) => Math.max(0, Math.floor(Number(n))))
          .filter((n) => Number.isFinite(n));
        if (schedule.length === 0) schedule = [...DEFAULT_SCHEDULE];
      }
    } catch {
      /* fall back to default */
    }
  }

  let milestones: Record<string, number> = { ...DEFAULT_MILESTONES };
  if (msStr) {
    try {
      const parsed = JSON.parse(msStr);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const dayNum = parseInt(k, 10);
          const reward = Math.max(0, Math.floor(Number(v)));
          if (Number.isFinite(dayNum) && Number.isFinite(reward)) {
            cleaned[String(dayNum)] = reward;
          }
        }
        if (Object.keys(cleaned).length > 0) milestones = cleaned;
      }
    } catch {
      /* fall back to default */
    }
  }

  // Admin can flip 'daily_streak_enabled' to '0' to kill the feature without
  // removing the schema or settings rows. Treat any value other than the
  // string '0' as enabled (default behaviour).
  const enabled = enStr === null ? true : enStr !== '0';

  return { schedule, milestones, enabled };
}

function computeReward(
  newStreak: number,
  schedule: number[],
  milestones: Record<string, number>,
): { base: number; milestone: number } {
  // Day in cycle is 1-indexed externally; convert to 0-indexed for array.
  const idx = ((newStreak - 1) % schedule.length + schedule.length) % schedule.length;
  const base = schedule[idx] ?? 0;
  const milestone = milestones[String(newStreak)] ?? 0;
  return { base, milestone };
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Read-only snapshot. Used by the user app to render the "Daily Reward"
 * card — knows whether the Claim button should be enabled, what the next
 * reward will be, and how long until the next claim window opens.
 */
export async function getStreakStatus(
  db: D1Database,
  userId: string,
): Promise<StreakStatus | null> {
  const cfg = await loadConfig(db);
  const user = await db
    .prepare('SELECT streak_days, last_streak_claim_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ streak_days: number | null; last_streak_claim_at: number | null }>();
  if (!user) return null;

  const now = Math.floor(Date.now() / 1000);
  const todayStart = startOfIstDay(now);
  const lastClaim = Number(user.last_streak_claim_at) || 0;
  const lastClaimDay = lastClaim > 0 ? startOfIstDay(lastClaim) : 0;
  const claimedToday = lastClaimDay === todayStart && lastClaim > 0;

  // Predict what the streak will be IF the user claims right now:
  //   - already claimed today → no change, "next" reward isn't relevant yet
  //   - claimed yesterday    → streak + 1
  //   - else                 → reset to 1
  const currentStreak = Number(user.streak_days) || 0;
  let projectedStreak: number;
  if (claimedToday) {
    projectedStreak = currentStreak; // unchanged; UI shows cooldown
  } else if (lastClaim > 0 && lastClaimDay === todayStart - SECONDS_PER_DAY) {
    projectedStreak = currentStreak + 1;
  } else {
    projectedStreak = 1;
  }
  const reward = computeReward(projectedStreak, cfg.schedule, cfg.milestones);

  return {
    streak_days: currentStreak,
    last_claim_at: lastClaim,
    can_claim_now: cfg.enabled && !claimedToday,
    next_claim_at: claimedToday ? nextIstMidnight(now) : now,
    next_reward: reward.base + reward.milestone,
    next_reward_base: reward.base,
    next_reward_milestone: reward.milestone,
    schedule: cfg.schedule,
    milestones: cfg.milestones,
    enabled: cfg.enabled,
  };
}

/**
 * Atomic claim. Same-day re-claim is rejected with `ALREADY_CLAIMED`. On
 * success the user's coin balance is incremented and a `coin_transactions`
 * row of type 'bonus' is written for the audit trail.
 *
 * The atomic guard is a SQLite UPDATE … WHERE last_streak_claim_at < ?
 * (today's IST midnight). Two concurrent claims from the same user can
 * race here — exactly one will land its UPDATE (changes === 1), the other
 * gets changes === 0 and is treated as ALREADY_CLAIMED. No double-credit.
 */
export async function claimDailyStreak(
  db: D1Database,
  userId: string,
): Promise<StreakClaimResult> {
  const cfg = await loadConfig(db);
  if (!cfg.enabled) {
    return {
      success: false,
      claimed: false,
      code: 'FEATURE_DISABLED',
      streak_days: 0,
      reward: 0,
      base_reward: 0,
      milestone_bonus: 0,
      next_claim_at: 0,
    };
  }

  const user = await db
    .prepare('SELECT streak_days, last_streak_claim_at, coins FROM users WHERE id = ?')
    .bind(userId)
    .first<{ streak_days: number | null; last_streak_claim_at: number | null; coins: number | null }>();
  if (!user) {
    return {
      success: false,
      claimed: false,
      code: 'USER_NOT_FOUND',
      streak_days: 0,
      reward: 0,
      base_reward: 0,
      milestone_bonus: 0,
      next_claim_at: 0,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const todayStart = startOfIstDay(now);
  const lastClaim = Number(user.last_streak_claim_at) || 0;
  const lastClaimDay = lastClaim > 0 ? startOfIstDay(lastClaim) : 0;

  if (lastClaimDay === todayStart && lastClaim > 0) {
    return {
      success: true, // request handled OK; just nothing to credit
      claimed: false,
      code: 'ALREADY_CLAIMED',
      streak_days: Number(user.streak_days) || 0,
      reward: 0,
      base_reward: 0,
      milestone_bonus: 0,
      next_claim_at: nextIstMidnight(now),
    };
  }

  const continued = lastClaim > 0 && lastClaimDay === todayStart - SECONDS_PER_DAY;
  const newStreak = continued ? (Number(user.streak_days) || 0) + 1 : 1;
  const { base, milestone } = computeReward(newStreak, cfg.schedule, cfg.milestones);
  const totalReward = base + milestone;

  // CAS — only update if last_streak_claim_at is still strictly before the
  // start of today's IST day. Concurrent claim attempts collapse onto
  // exactly one winner.
  const update = await db
    .prepare(
      'UPDATE users SET coins = coins + ?1, streak_days = ?2, last_streak_claim_at = ?3, updated_at = unixepoch() WHERE id = ?4 AND COALESCE(last_streak_claim_at, 0) < ?5',
    )
    .bind(totalReward, newStreak, now, userId, todayStart)
    .run();

  if (!update.meta?.changes) {
    // Lost the race — another concurrent request claimed it.
    return {
      success: true,
      claimed: false,
      code: 'ALREADY_CLAIMED',
      streak_days: Number(user.streak_days) || 0,
      reward: 0,
      base_reward: 0,
      milestone_bonus: 0,
      next_claim_at: nextIstMidnight(now),
    };
  }

  // Audit trail. Best-effort — never fail the claim if the trail insert
  // throws (e.g., schema mismatch on coin_transactions).
  try {
    await db
      .prepare(
        'INSERT INTO coin_transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        userId,
        'bonus',
        totalReward,
        milestone > 0
          ? `Daily streak Day ${newStreak} (+${base} base, +${milestone} milestone)`
          : `Daily streak Day ${newStreak}`,
      )
      .run();
  } catch (err) {
    console.warn('[streak] audit trail insert failed (non-fatal):', err);
  }

  return {
    success: true,
    claimed: true,
    code: 'OK',
    streak_days: newStreak,
    reward: totalReward,
    base_reward: base,
    milestone_bonus: milestone,
    next_claim_at: nextIstMidnight(now),
    new_balance: (Number(user.coins) || 0) + totalReward,
  };
}
