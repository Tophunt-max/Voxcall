// ============================================================================
// Host daily streak — engagement/dopamine layer for hosts.
// ============================================================================
//
// A host earns a "streak day" the first time they come ONLINE on a given IST
// calendar day (auto-credited from PATCH /api/host/status — no manual claim,
// so the reward feels instant: "You're online! Day 5 🔥 +30 coins").
//
//   - Same IST day as last credit  → already credited today, no-op.
//   - Yesterday (IST) was last day  → streak_days += 1.
//   - 2+ IST days gap               → streak resets to 1.
//
// Reward = schedule[(streak-1) mod len] + milestones[streak] (one-time).
// Rewards are engagement BONUS coins credited to the host's balance — they are
// intentionally NOT added to hosts.total_earnings, so daily logins can't be
// farmed to inflate the (work-based) level system.
//
// Schedule + milestones live in app_settings (host_streak_*) so admins retune
// without a redeploy. All day math is IST, reusing lib/streak.ts's istContext.

import { istContext } from './streak';

const SECONDS_PER_DAY = 86400;

const DEFAULT_SCHEDULE: ReadonlyArray<number> = [0, 10, 15, 20, 30, 50, 75];
const DEFAULT_MILESTONES: Readonly<Record<string, number>> = {
  '7': 100,
  '14': 250,
  '30': 1000,
  '60': 3000,
  '100': 10000,
};

export interface HostStreakConfig {
  enabled: boolean;
  schedule: number[];
  milestones: Record<string, number>;
}

export interface HostStreakStatus {
  enabled: boolean;
  streak_days: number;
  streak_max: number;
  /** Already credited a streak day today (host came online). */
  active_today: boolean;
  /** Coins the host will get on their next (or today's pending) streak credit. */
  next_reward: number;
  next_reward_base: number;
  next_reward_milestone: number;
  /** Seconds until the IST day rolls over (streak window resets). */
  seconds_until_reset: number;
  /** Active streak, not yet active today, and inside the last 6h → urgency UI. */
  at_risk: boolean;
  schedule: number[];
  milestones: Record<string, number>;
}

export interface HostStreakCredit {
  credited: boolean;
  streak_days: number;
  streak_max: number;
  reward: number;
  base_reward: number;
  milestone_bonus: number;
  new_balance?: number;
}

async function readSetting(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function loadHostStreakConfig(db: D1Database): Promise<HostStreakConfig> {
  const [enStr, schStr, msStr] = await Promise.all([
    readSetting(db, 'host_streak_enabled'),
    readSetting(db, 'host_streak_schedule'),
    readSetting(db, 'host_streak_milestones'),
  ]);

  const enabled = enStr === null ? true : enStr !== '0';

  let schedule: number[] = [...DEFAULT_SCHEDULE];
  if (schStr) {
    try {
      const parsed = JSON.parse(schStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cleaned = parsed.map((n) => Math.max(0, Math.floor(Number(n)))).filter((n) => Number.isFinite(n));
        if (cleaned.length > 0) schedule = cleaned;
      }
    } catch { /* keep default */ }
  }

  let milestones: Record<string, number> = { ...DEFAULT_MILESTONES };
  if (msStr) {
    try {
      const parsed = JSON.parse(msStr);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const day = parseInt(k, 10);
          const reward = Math.max(0, Math.floor(Number(v)));
          if (Number.isFinite(day) && Number.isFinite(reward)) cleaned[String(day)] = reward;
        }
        milestones = cleaned;
      }
    } catch { /* keep default */ }
  }

  return { enabled, schedule, milestones };
}

function computeReward(streak: number, schedule: number[], milestones: Record<string, number>): { base: number; milestone: number } {
  const len = schedule.length || 1;
  const idx = (((streak - 1) % len) + len) % len;
  return { base: schedule[idx] ?? 0, milestone: milestones[String(streak)] ?? 0 };
}

/** Read-only snapshot for the host dashboard streak card. Null if not a host. */
export async function getHostStreakStatus(db: D1Database, hostUserId: string): Promise<HostStreakStatus | null> {
  const cfg = await loadHostStreakConfig(db);
  let row: { streak_days: number | null; last_streak_day_at: number | null; streak_max: number | null } | null = null;
  try {
    row = await db
      .prepare('SELECT streak_days, last_streak_day_at, streak_max FROM hosts WHERE user_id = ?')
      .bind(hostUserId)
      .first();
  } catch {
    row = null; // pre-migration DB — columns absent
  }
  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  const todayStart = istContext(now).dayStart;
  const last = Number(row.last_streak_day_at) || 0;
  const lastDayStart = last > 0 ? istContext(last).dayStart : 0;
  const activeToday = lastDayStart === todayStart && last > 0;
  const current = Number(row.streak_days) || 0;

  let projected: number;
  if (activeToday) projected = current;
  else if (last > 0 && lastDayStart === todayStart - SECONDS_PER_DAY) projected = current + 1;
  else projected = 1;
  const reward = computeReward(projected, cfg.schedule, cfg.milestones);

  const nextMidnight = todayStart + SECONDS_PER_DAY;
  const secondsUntilReset = Math.max(0, nextMidnight - now);
  const gap = last > 0 ? istContext(now).dayIndex - istContext(last).dayIndex : Infinity;
  const atRisk = cfg.enabled && current > 0 && gap === 1 && !activeToday && secondsUntilReset <= 6 * 3600;

  return {
    enabled: cfg.enabled,
    streak_days: current,
    streak_max: Math.max(Number(row.streak_max) || 0, current),
    active_today: activeToday,
    next_reward: reward.base + reward.milestone,
    next_reward_base: reward.base,
    next_reward_milestone: reward.milestone,
    seconds_until_reset: secondsUntilReset,
    at_risk: atRisk,
    schedule: cfg.schedule,
    milestones: cfg.milestones,
  };
}

/**
 * Credit today's streak day for a host who just became active (came online).
 * Idempotent per IST day via a CAS on hosts.last_streak_day_at — concurrent
 * calls collapse onto exactly one winner (no double credit). Reward coins are
 * added to the host's balance with a 'bonus' ledger row. Never throws.
 */
export async function creditHostStreakOnActivity(db: D1Database, hostUserId: string): Promise<HostStreakCredit> {
  const noop: HostStreakCredit = { credited: false, streak_days: 0, streak_max: 0, reward: 0, base_reward: 0, milestone_bonus: 0 };
  try {
    const cfg = await loadHostStreakConfig(db);
    if (!cfg.enabled) return noop;

    const row = await db
      .prepare('SELECT streak_days, last_streak_day_at, streak_max FROM hosts WHERE user_id = ?')
      .bind(hostUserId)
      .first<{ streak_days: number | null; last_streak_day_at: number | null; streak_max: number | null }>();
    if (!row) return noop;

    const now = Math.floor(Date.now() / 1000);
    const todayStart = istContext(now).dayStart;
    const last = Number(row.last_streak_day_at) || 0;
    const lastDayStart = last > 0 ? istContext(last).dayStart : 0;
    const current = Number(row.streak_days) || 0;

    // Already credited today.
    if (lastDayStart === todayStart && last > 0) {
      return { credited: false, streak_days: current, streak_max: Math.max(Number(row.streak_max) || 0, current), reward: 0, base_reward: 0, milestone_bonus: 0 };
    }

    const continued = last > 0 && lastDayStart === todayStart - SECONDS_PER_DAY;
    const newStreak = continued ? current + 1 : 1;
    const { base, milestone } = computeReward(newStreak, cfg.schedule, cfg.milestones);

    // Atomic CAS: only the first activity of the IST day wins. The same guarded
    // UPDATE also increments `active_days` (a lifetime count of distinct active
    // days used by the level system) so it can never double-count for a day.
    const upd = await db
      .prepare(
        `UPDATE hosts SET streak_days = ?1, last_streak_day_at = ?2,
                          streak_max = MAX(COALESCE(streak_max, 0), ?1),
                          active_days = COALESCE(active_days, 0) + 1, updated_at = unixepoch()
         WHERE user_id = ?3 AND COALESCE(last_streak_day_at, 0) < ?4`,
      )
      .bind(newStreak, now, hostUserId, todayStart)
      .run();

    if (!upd.meta?.changes) {
      return { credited: false, streak_days: current, streak_max: Math.max(Number(row.streak_max) || 0, current), reward: 0, base_reward: 0, milestone_bonus: 0 };
    }

    const reward = base + milestone;
    let newBalance: number | undefined;
    if (reward > 0) {
      await db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(reward, hostUserId).run().catch(() => {});
      const parts = [`+${base} base`];
      if (milestone > 0) parts.push(`+${milestone} milestone`);
      await db
        .prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), hostUserId, 'bonus', reward, `Host streak Day ${newStreak} (${parts.join(', ')})`)
        .run()
        .catch(() => {});
      const after = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(hostUserId).first<{ coins: number }>().catch(() => null);
      newBalance = after ? Number(after.coins) || 0 : undefined;
    }

    return {
      credited: true,
      streak_days: newStreak,
      streak_max: Math.max(Number(row.streak_max) || 0, newStreak),
      reward,
      base_reward: base,
      milestone_bonus: milestone,
      new_balance: newBalance,
    };
  } catch (e) {
    console.warn('[hostStreak] credit failed (non-fatal):', e);
    return noop;
  }
}
