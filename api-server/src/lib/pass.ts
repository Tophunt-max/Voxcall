// ============================================================================
// Monthly Pass helpers
// ============================================================================
// Shared between routes/pass.ts (the user-facing pass surface) and
// routes/rewards.ts (which awards Pass Points whenever a reward task is
// claimed). Everything is keyed by `period_key` ('YYYY-MM' UTC) so points,
// premium unlock and claims reset automatically at the month boundary.
//
// Every function is defensive: a missing table / column on an un-migrated DB
// resolves to a no-op rather than throwing, so awarding points can be dropped
// into the reward-claim hot path without any risk of breaking a claim.
// ============================================================================

/** 'YYYY-MM' in UTC — the current monthly pass cycle key. */
export function passMonthKey(ts: number = Math.floor(Date.now() / 1000)): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Unix seconds of the start of NEXT UTC month (= end of the current cycle). */
export function passMonthEndUnix(ts: number = Math.floor(Date.now() / 1000)): number {
  const d = new Date(ts * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0) / 1000);
}

/** UTC day key 'YYYY-MM-DD' — matches routes/rewards.ts's budget accounting. */
function utcDayKey(ts: number = Math.floor(Date.now() / 1000)): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface PassTier {
  level: number;
  points: number;
  label: string;
  free_coins: number;
  premium_coins: number;
}

/** Parse + normalise the JSON `tiers` blob into a sorted, sane array. */
export function parsePassTiers(raw: unknown): PassTier[] {
  let arr: unknown;
  try {
    arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const tiers = arr
    .map((t, i) => {
      const o = (t ?? {}) as Record<string, unknown>;
      return {
        level: Math.max(1, Math.floor(Number(o.level) || i + 1)),
        points: Math.max(0, Math.floor(Number(o.points) || 0)),
        label: String(o.label ?? `Tier ${i + 1}`),
        free_coins: Math.max(0, Math.floor(Number(o.free_coins) || 0)),
        premium_coins: Math.max(0, Math.floor(Number(o.premium_coins) || 0)),
      };
    })
    .sort((a, b) => a.points - b.points || a.level - b.level);
  return tiers;
}

/**
 * Award Pass Points to a user for the current month. Best-effort — never
 * throws. Called from the reward-claim path with the coins just credited so
 * pass progress mirrors task value.
 */
export async function addPassPoints(db: D1Database, userId: string, points: number): Promise<void> {
  if (!userId || !Number.isFinite(points) || points <= 0) return;
  const now = Math.floor(Date.now() / 1000);
  const period = passMonthKey(now);
  const pts = Math.floor(points);
  try {
    await db
      .prepare(
        `INSERT INTO user_pass_state (user_id, period_key, points, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, period_key) DO UPDATE SET points = points + ?, updated_at = ?`,
      )
      .bind(userId, period, pts, now, pts, now)
      .run();
  } catch (err) {
    console.warn('[pass] addPassPoints failed (non-fatal):', err);
  }
}

/**
 * Would crediting `amount` coins push today's reward budget OVER the cap?
 * Mirrors routes/rewards.ts so pass payouts share the same daily budget.
 * Cap of 0 = unlimited.
 */
export async function passWouldExceedBudget(
  db: D1Database,
  amount: number,
): Promise<{ exceeded: boolean; cap: number }> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('reward_daily_budget_cap').first<{ value: string }>();
    const cap = Number.parseInt(row?.value ?? '0', 10);
    if (!Number.isFinite(cap) || cap <= 0) return { exceeded: false, cap: 0 };
    const today = utcDayKey();
    const paidRow = await db.prepare('SELECT coins_paid FROM reward_budget_daily WHERE day_key = ?').bind(today).first<{ coins_paid: number }>();
    const paid = Number(paidRow?.coins_paid ?? 0);
    return { exceeded: paid + amount > cap, cap };
  } catch {
    return { exceeded: false, cap: 0 };
  }
}

/** Statement that inserts-or-increments today's reward budget counter. */
export function passBudgetIncrementStmt(db: D1Database, coins: number) {
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
