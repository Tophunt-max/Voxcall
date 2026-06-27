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
  '180': 12000,
  '365': 30000,
};

// Variable-reward "lucky wheel" (Priority 4). Each entry maps a multiplier to
// a relative probability weight. The realized base reward = round(base * m /
// E[m]), so the EXPECTED payout always equals the scheduled base regardless of
// the table — the economy stays budget-neutral; only the *variance* (and the
// dopamine) changes. Rare high multipliers create the jackpot feeling.
interface VariableTier {
  m: number;
  p: number;
}
const DEFAULT_VARIABLE_TABLE: ReadonlyArray<VariableTier> = [
  { m: 0.5, p: 0.35 },
  { m: 0.8, p: 0.25 },
  { m: 1.0, p: 0.2 },
  { m: 2.0, p: 0.15 },
  { m: 5.0, p: 0.05 },
];

// ─── New engagement levers (all default to "no behavior change") ───────────
// Comeback softener: coins granted when a broken streak resets to Day 1 (only
// when the user HAD an active streak that lapsed — not on a first-ever claim).
const DEFAULT_COMEBACK_BONUS = 0;
// Anti-farming: reward multiplier applied to guest (quick-login) accounts —
// users with neither a password nor a Google identity. 1 = no change.
const DEFAULT_GUEST_MULTIPLIER = 1;
// Reward variety: streak-day → free call MINUTES credited (in addition to coins).
const DEFAULT_MINUTE_REWARDS: Readonly<Record<string, number>> = {};
// Streak freeze / repair (lets a user restore a streak after missing one day).
const DEFAULT_FREEZE_ENABLED = false;
const DEFAULT_FREEZE_MONTHLY = 2;        // free freezes granted each IST month
const DEFAULT_REPAIR_COST_COINS = 50;    // coins charged when no free freeze left
// Monthly "chest": bonus when the user claims N times within one IST month.
const DEFAULT_CHEST_ENABLED = false;
const DEFAULT_CHEST_THRESHOLD = 20;
const DEFAULT_CHEST_REWARD = 500;

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
  /** Whether the variable "lucky wheel" reward mode is active (Priority 4). */
  variable_enabled: boolean;
  /**
   * The wheel segments [{m,p}] so the client can render a spin animation.
   * Expected payout still equals `next_reward_base`; the multiplier only
   * shifts variance, not the average. Empty when variable mode is off.
   */
  variable_table: VariableTier[];
  /** Seconds until the current claim window closes (next IST midnight). */
  seconds_until_reset: number;
  /**
   * True when the user has an active streak, hasn't claimed today, and is in
   * the last few hours before reset — drives the "at risk" urgency UI.
   */
  at_risk: boolean;
  /** Longest streak the user has ever reached. */
  streak_max: number;
  /** ─ Streak freeze / repair ─ */
  freeze_enabled: boolean;
  freezes_available: number;
  /** True when the user missed exactly yesterday and can still repair today. */
  can_repair: boolean;
  /** Coins it costs to repair when no free freeze is available. */
  repair_cost_coins: number;
  /** ─ Monthly chest ─ */
  chest_enabled: boolean;
  chest_threshold: number;
  chest_reward: number;
  /** Claims the user has made in the current IST month. */
  claims_this_month: number;
  /** Whether this month's chest has already been awarded. */
  chest_claimed_this_month: boolean;
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
  /** True when the variable "lucky wheel" determined this reward (Priority 4). */
  variable?: boolean;
  /** The drawn multiplier (e.g. 2 = "2x!"). 1 when variable mode is off. */
  multiplier?: number;
  /** Free call minutes credited alongside coins (reward variety), 0 if none. */
  minutes_reward?: number;
  /** Comeback-softener coins granted because a lapsed streak reset, 0 if none. */
  comeback_bonus?: number;
  /** Monthly-chest coins awarded on this claim, 0 if not unlocked this claim. */
  chest_bonus?: number;
  /** Claims made in the current IST month after this claim. */
  claims_this_month?: number;
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

// 'YYYY-MM' in IST — used to reset the monthly claim counter and replenish
// freeze tokens at the IST month boundary.
function istMonthKey(unixSec: number): string {
  const d = new Date((unixSec + IST_OFFSET_SEC) * 1000);
  // getUTC* because we already shifted into IST by adding the offset.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// IST day index (integer) — stable per calendar day, cheap to compare.
function istDayIndex(unixSec: number): number {
  return Math.floor((unixSec + IST_OFFSET_SEC) / SECONDS_PER_DAY);
}

interface UserStreakExtras {
  isGuest: boolean;
  freezes: number;
  monthKey: string | null;
  claimsMonth: number;
  chestMonth: string | null;
  streakMax: number;
  freeMinutes: number;
  hasExtraColumns: boolean;
}

// Read the optional/newer streak columns defensively. Legacy DBs (and the unit
// test harness) only have the base columns, so a failure here degrades to safe
// defaults rather than breaking the claim. `isGuest` = a quick-login account
// with neither a password nor a Google identity.
async function readUserExtras(db: D1Database, userId: string): Promise<UserStreakExtras> {
  const safe: UserStreakExtras = {
    isGuest: false, freezes: 0, monthKey: null, claimsMonth: 0,
    chestMonth: null, streakMax: 0, freeMinutes: 0, hasExtraColumns: false,
  };
  try {
    const row = await db
      .prepare(
        `SELECT password_hash, google_id, free_call_minutes,
                streak_freezes, streak_month_key, streak_claims_month,
                streak_chest_month, streak_max
         FROM users WHERE id = ?`,
      )
      .bind(userId)
      .first<any>();
    if (!row) return safe;
    const noPass = !row.password_hash || String(row.password_hash).length === 0;
    const noGoogle = !row.google_id || String(row.google_id).length === 0;
    return {
      isGuest: noPass && noGoogle,
      freezes: Number(row.streak_freezes) || 0,
      monthKey: row.streak_month_key ?? null,
      claimsMonth: Number(row.streak_claims_month) || 0,
      chestMonth: row.streak_chest_month ?? null,
      streakMax: Number(row.streak_max) || 0,
      freeMinutes: Number(row.free_call_minutes) || 0,
      hasExtraColumns: true,
    };
  } catch {
    // Legacy schema / test harness without the extra columns.
    return safe;
  }
}

// Best-effort secondary write for the newer columns. Wrapped per-statement so a
// legacy DB missing a column never fails the (already-committed) coin credit.
async function writeUserExtras(
  db: D1Database,
  userId: string,
  fields: Record<string, number | string>,
): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  try {
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    await db
      .prepare(`UPDATE users SET ${setClause} WHERE id = ?`)
      .bind(...keys.map((k) => fields[k]), userId)
      .run();
  } catch (err) {
    console.warn('[streak] writeUserExtras skipped (legacy schema?):', err);
  }
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
  variableEnabled: boolean;
  variableTable: VariableTier[];
  comebackBonus: number;
  guestMultiplier: number;
  minuteRewards: Record<string, number>;
  freezeEnabled: boolean;
  freezeMonthly: number;
  repairCostCoins: number;
  chestEnabled: boolean;
  chestThreshold: number;
  chestReward: number;
}> {
  // Each piece falls back to its DEFAULT_* if the row is missing or the JSON
  // is malformed. The streak system must keep working even when admin
  // settings are mid-edit / missing / corrupted.
  const [
    schStr, msStr, enStr, varEnStr, varTblStr,
    comebackStr, guestStr, minStr,
    frEnStr, frMonStr, repCostStr,
    chEnStr, chThrStr, chRewStr,
  ] = await Promise.all([
    readSetting(db, 'daily_streak_schedule'),
    readSetting(db, 'daily_streak_milestones'),
    readSetting(db, 'daily_streak_enabled'),
    readSetting(db, 'daily_streak_variable_enabled'),
    readSetting(db, 'daily_streak_variable_table'),
    readSetting(db, 'daily_streak_comeback_bonus'),
    readSetting(db, 'daily_streak_guest_multiplier'),
    readSetting(db, 'daily_streak_minute_rewards'),
    readSetting(db, 'daily_streak_freeze_enabled'),
    readSetting(db, 'daily_streak_freeze_monthly'),
    readSetting(db, 'daily_streak_repair_cost_coins'),
    readSetting(db, 'daily_streak_chest_enabled'),
    readSetting(db, 'daily_streak_chest_threshold'),
    readSetting(db, 'daily_streak_chest_reward'),
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

  // Variable-reward mode is OFF by default — enabling it changes the *feel*
  // (variance) but never the average payout. Admins opt in explicitly.
  const variableEnabled = varEnStr === '1';
  const variableTable = normalizeVariableTable(varTblStr);

  // ── New levers — each parsed defensively with a safe default ──
  const num = (s: string | null, dflt: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
  };
  const comebackBonus = Math.floor(num(comebackStr, DEFAULT_COMEBACK_BONUS, 0));
  // Guest multiplier clamped to [0, 1] — it can only reduce, never inflate.
  const guestMultiplier = num(guestStr, DEFAULT_GUEST_MULTIPLIER, 0, 1);
  const freezeEnabled = frEnStr === null ? DEFAULT_FREEZE_ENABLED : frEnStr === '1';
  const freezeMonthly = Math.floor(num(frMonStr, DEFAULT_FREEZE_MONTHLY, 0, 31));
  const repairCostCoins = Math.floor(num(repCostStr, DEFAULT_REPAIR_COST_COINS, 0));
  const chestEnabled = chEnStr === null ? DEFAULT_CHEST_ENABLED : chEnStr === '1';
  const chestThreshold = Math.floor(num(chThrStr, DEFAULT_CHEST_THRESHOLD, 1, 31));
  const chestReward = Math.floor(num(chRewStr, DEFAULT_CHEST_REWARD, 0));

  let minuteRewards: Record<string, number> = { ...DEFAULT_MINUTE_REWARDS };
  if (minStr) {
    try {
      const parsed = JSON.parse(minStr);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const dayNum = parseInt(k, 10);
          const mins = Math.max(0, Math.floor(Number(v)));
          if (Number.isFinite(dayNum) && Number.isFinite(mins) && mins > 0) {
            cleaned[String(dayNum)] = mins;
          }
        }
        minuteRewards = cleaned;
      }
    } catch {
      /* fall back to default (none) */
    }
  }

  return {
    schedule, milestones, enabled, variableEnabled, variableTable,
    comebackBonus, guestMultiplier, minuteRewards,
    freezeEnabled, freezeMonthly, repairCostCoins,
    chestEnabled, chestThreshold, chestReward,
  };
}

// ─── Variable reward (lucky wheel) helpers ─────────────────────────────────

/** Parse/sanitize the variable table; fall back to the default on any issue. */
function normalizeVariableTable(json: string | null): VariableTier[] {
  if (!json) return [...DEFAULT_VARIABLE_TABLE];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      const cleaned: VariableTier[] = [];
      for (const row of parsed) {
        const m = Number(row?.m);
        const p = Number(row?.p);
        if (Number.isFinite(m) && m > 0 && Number.isFinite(p) && p > 0) {
          cleaned.push({ m, p });
        }
      }
      if (cleaned.length > 0) return cleaned;
    }
  } catch {
    /* fall through to default */
  }
  return [...DEFAULT_VARIABLE_TABLE];
}

/** Probability-weighted expected multiplier E[m] of a table (always > 0). */
function tableExpectedValue(table: VariableTier[]): number {
  let weightSum = 0;
  let evSum = 0;
  for (const t of table) {
    weightSum += t.p;
    evSum += t.m * t.p;
  }
  if (weightSum <= 0) return 1;
  const ev = evSum / weightSum;
  return ev > 0 ? ev : 1;
}

/** Draw one multiplier from the table by its relative probabilities. */
function drawVariableMultiplier(table: VariableTier[], rng: () => number = Math.random): number {
  let total = 0;
  for (const t of table) total += t.p;
  if (total <= 0) return 1;
  let r = rng() * total;
  for (const t of table) {
    r -= t.p;
    if (r <= 0) return t.m;
  }
  return table[table.length - 1].m;
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

  // ── New status fields (freeze/repair, urgency, monthly chest) ──
  const extras = await readUserExtras(db, userId);
  const monthKey = istMonthKey(now);
  const todayIdx = istDayIndex(now);
  const lastClaimIdx = lastClaim > 0 ? istDayIndex(lastClaim) : -1;
  const gap = lastClaim > 0 ? todayIdx - lastClaimIdx : Infinity;

  const nextMidnight = nextIstMidnight(now);
  const secondsUntilReset = Math.max(0, nextMidnight - now);

  // Repair is offered only when the user missed EXACTLY yesterday (gap === 2)
  // and still has an active streak to save — and the feature is enabled.
  const canRepair =
    cfg.enabled && cfg.freezeEnabled && currentStreak > 0 && lastClaim > 0 && gap === 2;

  // "At risk" = streak alive, claimed yesterday (gap === 1), not yet today, and
  // we're inside the last 6h before the IST reset.
  const atRisk =
    cfg.enabled && currentStreak > 0 && gap === 1 && !claimedToday && secondsUntilReset <= 6 * 3600;

  const freezesAvailable = extras.monthKey === monthKey ? extras.freezes : cfg.freezeMonthly;
  const claimsThisMonth = extras.monthKey === monthKey ? extras.claimsMonth : 0;

  return {
    streak_days: currentStreak,
    last_claim_at: lastClaim,
    can_claim_now: cfg.enabled && !claimedToday,
    next_claim_at: claimedToday ? nextMidnight : now,
    next_reward: reward.base + reward.milestone,
    next_reward_base: reward.base,
    next_reward_milestone: reward.milestone,
    schedule: cfg.schedule,
    milestones: cfg.milestones,
    enabled: cfg.enabled,
    variable_enabled: cfg.variableEnabled,
    variable_table: cfg.variableEnabled ? cfg.variableTable : [],
    seconds_until_reset: secondsUntilReset,
    at_risk: atRisk,
    streak_max: Math.max(extras.streakMax, currentStreak),
    freeze_enabled: cfg.freezeEnabled,
    freezes_available: freezesAvailable,
    can_repair: canRepair,
    repair_cost_coins: cfg.repairCostCoins,
    chest_enabled: cfg.chestEnabled,
    chest_threshold: cfg.chestThreshold,
    chest_reward: cfg.chestReward,
    claims_this_month: claimsThisMonth,
    chest_claimed_this_month: extras.chestMonth === monthKey,
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

  // Optional/newer columns (guest flag, monthly counters, freeze tokens). Reads
  // safe defaults on a legacy schema, so the core credit path never breaks.
  const extras = await readUserExtras(db, userId);
  const monthKey = istMonthKey(now);
  const sameMonth = extras.monthKey === monthKey;

  // Variable-reward mode (Priority 4): draw a multiplier and rescale the BASE
  // by m / E[m] so the expected payout stays exactly the scheduled base
  // (budget-neutral) while individual claims swing for the dopamine. Milestone
  // bonuses are NOT randomized — they stay a guaranteed celebration.
  let multiplier = 1;
  let realizedBase = base;
  if (cfg.variableEnabled && base > 0) {
    multiplier = drawVariableMultiplier(cfg.variableTable);
    const ev = tableExpectedValue(cfg.variableTable);
    realizedBase = Math.max(1, Math.round((base * multiplier) / ev));
  }

  // Comeback softener: only when a previously-active streak lapsed and reset
  // (never on a first-ever claim). Default 0 → no behavior change.
  const hadActiveStreak = lastClaim > 0 && (Number(user.streak_days) || 0) > 0;
  const comebackBonus = !continued && hadActiveStreak ? cfg.comebackBonus : 0;

  // Monthly chest: unlocks once the claim count for the IST month crosses the
  // threshold, and only once per month.
  const newClaimsMonth = (sameMonth ? extras.claimsMonth : 0) + 1;
  const chestBonus =
    cfg.chestEnabled && newClaimsMonth >= cfg.chestThreshold && extras.chestMonth !== monthKey
      ? cfg.chestReward
      : 0;

  // Reward variety: free call minutes credited at specific streak days.
  const minutesReward = cfg.minuteRewards[String(newStreak)] || 0;

  // Anti-farming: scale COIN rewards for guest (quick-login) accounts. 1 = off.
  const guestMult = extras.isGuest ? cfg.guestMultiplier : 1;
  const grossCoins = realizedBase + milestone + comebackBonus + chestBonus;
  const totalReward = Math.max(0, Math.round(grossCoins * guestMult));

  // CAS — only update if last_streak_claim_at is still strictly before the
  // start of today's IST day. Concurrent claim attempts collapse onto
  // exactly one winner. (Kept to the base columns so it works on every schema.)
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

  // We won the CAS — now best-effort write the newer columns (monthly counters,
  // longest streak, freeze replenishment, free-minute reward). Each is wrapped
  // so a legacy DB missing a column never undoes the committed coin credit.
  await writeUserExtras(db, userId, {
    streak_month_key: monthKey,
    streak_claims_month: newClaimsMonth,
    streak_max: Math.max(extras.streakMax, newStreak),
    // Replenish freeze tokens at the IST month boundary.
    streak_freezes: sameMonth ? extras.freezes : cfg.freezeMonthly,
    // Stamp the chest month only when actually awarded; otherwise preserve.
    streak_chest_month: chestBonus > 0 ? monthKey : extras.chestMonth ?? '',
  });
  if (minutesReward > 0) {
    try {
      await db
        .prepare('UPDATE users SET free_call_minutes = COALESCE(free_call_minutes, 0) + ? WHERE id = ?')
        .bind(minutesReward, userId)
        .run();
    } catch (err) {
      console.warn('[streak] free-minute reward credit skipped (legacy schema?):', err);
    }
  }

  // Audit trail. Best-effort — never fail the claim if the trail insert throws.
  try {
    const parts: string[] = [`+${realizedBase} base`];
    if (milestone > 0) parts.push(`+${milestone} milestone`);
    if (comebackBonus > 0) parts.push(`+${comebackBonus} comeback`);
    if (chestBonus > 0) parts.push(`+${chestBonus} monthly chest`);
    if (minutesReward > 0) parts.push(`+${minutesReward} free min`);
    if (multiplier !== 1) parts.push(`${multiplier}x`);
    if (guestMult !== 1) parts.push(`guest x${guestMult}`);
    await db
      .prepare(
        'INSERT INTO coin_transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        userId,
        'bonus',
        totalReward,
        `Daily streak Day ${newStreak} (${parts.join(', ')})`,
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
    base_reward: realizedBase,
    milestone_bonus: milestone,
    next_claim_at: nextIstMidnight(now),
    new_balance: (Number(user.coins) || 0) + totalReward,
    variable: cfg.variableEnabled && base > 0,
    multiplier,
    minutes_reward: minutesReward,
    comeback_bonus: comebackBonus,
    chest_bonus: chestBonus,
    claims_this_month: newClaimsMonth,
  };
}

// ─── Streak repair / freeze ────────────────────────────────────────────────

export interface StreakRepairResult {
  success: boolean;
  repaired: boolean;
  code: 'OK' | 'FEATURE_DISABLED' | 'USER_NOT_FOUND' | 'NOTHING_TO_REPAIR' | 'INSUFFICIENT_FUNDS';
  /** How the repair was paid for. */
  method?: 'freeze' | 'coins';
  freezes_remaining?: number;
  coins_spent?: number;
  new_balance?: number;
  streak_days?: number;
  message?: string;
}

/**
 * Restore a streak after the user missed EXACTLY one day (yesterday in IST).
 * Consumes a free freeze token if available, otherwise charges coins. On
 * success we move `last_streak_claim_at` to yesterday's IST midnight so the
 * NEXT claim continues the streak instead of resetting it.
 */
export async function repairStreak(db: D1Database, userId: string): Promise<StreakRepairResult> {
  const cfg = await loadConfig(db);
  if (!cfg.enabled || !cfg.freezeEnabled) {
    return { success: false, repaired: false, code: 'FEATURE_DISABLED' };
  }

  const user = await db
    .prepare('SELECT streak_days, last_streak_claim_at, coins FROM users WHERE id = ?')
    .bind(userId)
    .first<{ streak_days: number | null; last_streak_claim_at: number | null; coins: number | null }>();
  if (!user) return { success: false, repaired: false, code: 'USER_NOT_FOUND' };

  const now = Math.floor(Date.now() / 1000);
  const todayStart = startOfIstDay(now);
  const lastClaim = Number(user.last_streak_claim_at) || 0;
  const streakDays = Number(user.streak_days) || 0;
  const gap = lastClaim > 0 ? istDayIndex(now) - istDayIndex(lastClaim) : Infinity;

  // Repairable ONLY when there is an active streak that lapsed exactly one day.
  if (streakDays <= 0 || lastClaim <= 0 || gap !== 2) {
    return {
      success: true,
      repaired: false,
      code: 'NOTHING_TO_REPAIR',
      message: 'Your streak is not in a repairable state.',
    };
  }

  const extras = await readUserExtras(db, userId);
  const monthKey = istMonthKey(now);
  const freezes = extras.monthKey === monthKey ? extras.freezes : cfg.freezeMonthly;
  const yesterdayMidnight = todayStart - SECONDS_PER_DAY;

  if (freezes > 0) {
    // Spend a free freeze.
    await writeUserExtras(db, userId, {
      last_streak_claim_at: yesterdayMidnight,
      streak_freezes: freezes - 1,
      streak_month_key: monthKey,
    });
    return {
      success: true,
      repaired: true,
      code: 'OK',
      method: 'freeze',
      freezes_remaining: freezes - 1,
      coins_spent: 0,
      streak_days: streakDays,
      new_balance: Number(user.coins) || 0,
    };
  }

  // No free freeze — charge coins (atomic guard prevents over-spend / double-repair).
  const cost = cfg.repairCostCoins;
  if (cost <= 0 || (Number(user.coins) || 0) < cost) {
    return {
      success: false,
      repaired: false,
      code: 'INSUFFICIENT_FUNDS',
      coins_spent: 0,
      message: `Not enough coins to repair (need ${cost}).`,
    };
  }
  const upd = await db
    .prepare(
      'UPDATE users SET coins = coins - ?1, last_streak_claim_at = ?2, updated_at = unixepoch() WHERE id = ?3 AND coins >= ?1 AND COALESCE(last_streak_claim_at,0) < ?4',
    )
    .bind(cost, yesterdayMidnight, userId, todayStart)
    .run();
  if (!upd.meta?.changes) {
    return { success: false, repaired: false, code: 'INSUFFICIENT_FUNDS', message: 'Repair failed — please retry.' };
  }
  // Keep month bookkeeping fresh (best-effort).
  await writeUserExtras(db, userId, { streak_month_key: monthKey, streak_freezes: freezes });
  try {
    await db
      .prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), userId, 'spend', -cost, `Streak repair (Day ${streakDays} restored)`)
      .run();
  } catch (err) {
    console.warn('[streak] repair audit insert failed (non-fatal):', err);
  }
  return {
    success: true,
    repaired: true,
    code: 'OK',
    method: 'coins',
    freezes_remaining: 0,
    coins_spent: cost,
    new_balance: (Number(user.coins) || 0) - cost,
    streak_days: streakDays,
  };
}


// ─── IST helpers for the reminder cron ─────────────────────────────────────
// Exposes the IST hour-of-day, day index, and day-start (UTC seconds) for a
// given instant so the scheduled reminder job (src/index.ts) can fire once per
// IST day at the admin-configured hour without duplicating the IST math.
export function istContext(unixSec: number): { hour: number; dayIndex: number; dayStart: number } {
  const shifted = unixSec + IST_OFFSET_SEC;
  return {
    hour: Math.floor((((shifted % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY) / 3600),
    dayIndex: Math.floor(shifted / SECONDS_PER_DAY),
    dayStart: Math.floor(shifted / SECONDS_PER_DAY) * SECONDS_PER_DAY - IST_OFFSET_SEC,
  };
}
