// ============================================================================
// Smart Recharge Recommendation Engine — usage-aware "best pack for you".
// ============================================================================
//
// Most users have no idea which coin pack to buy. This analyses each user's
// real spending behaviour and recommends the pack that actually fits them:
//
//   1. BURN RATE — average coins spent per day over a lookback window
//      (calls + tips + gifts; excludes refunds/withdrawals which aren't spend).
//   2. RUNWAY — how many days their current balance will last at that rate.
//   3. BEST PACK — the smallest pack that keeps them topped up for ~target days
//      (so we don't over-sell), falling back to the largest pack for heavy
//      users, and to the popular/mid pack for brand-new users with no history.
//   4. URGENCY — critical (<2 days left) / low (<5) / normal, so the UI can
//      nudge harder when they're about to run dry mid-call.
//
// Output powers a "⭐ Best for you" badge + a human hint on checkout
// ("Your coins run out in ~2 days. This pack lasts ~24 days!"). Admin-tunable
// and defaults to DISABLED — pure opt-in, no behaviour change until enabled.
// ============================================================================

export interface RechargeRecommendation {
  enabled: boolean;
  /** The plan we recommend the user buy. null when we can't recommend one. */
  recommended_plan_id: string | null;
  /** Avg coins/day the user burns (0 for a brand-new user). */
  burn_rate_per_day: number;
  /** Days the CURRENT balance lasts at the burn rate. null = effectively unlimited. */
  days_left: number | null;
  /** Days the RECOMMENDED pack would last at the burn rate. null = unknown. */
  lasts_days: number | null;
  /** UI urgency tier. */
  urgency: 'critical' | 'low' | 'normal';
  /** Ready-to-show human hint. */
  reason: string;
}

const NO_REC: RechargeRecommendation = {
  enabled: false,
  recommended_plan_id: null,
  burn_rate_per_day: 0,
  days_left: null,
  lasts_days: null,
  urgency: 'normal',
  reason: '',
};

async function readInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}
async function readBool(db: D1Database, key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallback;
    return row.value !== '0' && row.value.toLowerCase() !== 'false';
  } catch { return fallback; }
}

interface PlanRow { id: string; coins: number; bonus_coins: number | null; is_popular: number | null; price: number | null; }

/**
 * Pure pack-selection given a burn rate + the catalog. Exported for unit tests.
 *   - burnRate <= 0 (no history): pick the popular pack, else the middle pack.
 *   - otherwise: the SMALLEST pack that lasts >= targetDays (don't over-sell);
 *     if none reaches targetDays, the LARGEST pack (heavy user).
 */
export function pickRecommendedPlan(
  plans: PlanRow[],
  burnRate: number,
  targetDays: number,
): { plan: PlanRow | null; lastsDays: number | null } {
  const active = plans.filter((p) => (Number(p.coins) || 0) > 0);
  if (active.length === 0) return { plan: null, lastsDays: null };

  const totalCoins = (p: PlanRow) => (Number(p.coins) || 0) + (Number(p.bonus_coins) || 0);
  const bySize = [...active].sort((a, b) => totalCoins(a) - totalCoins(b));

  // No usage signal yet → nudge the popular pack (or the middle of the ladder).
  if (!(burnRate > 0)) {
    const popular = bySize.find((p) => p.is_popular);
    const plan = popular ?? bySize[Math.floor(bySize.length / 2)] ?? bySize[0];
    return { plan, lastsDays: null };
  }

  // Smallest pack that covers the target runway (avoids pushing the biggest one).
  const sufficient = bySize.find((p) => totalCoins(p) / burnRate >= targetDays);
  const plan = sufficient ?? bySize[bySize.length - 1]; // else heaviest pack
  return { plan, lastsDays: Math.floor(totalCoins(plan) / burnRate) };
}

/**
 * Compute the personalized recharge recommendation for a user.
 */
export async function computeRechargeRecommendation(
  db: D1Database,
  userId: string,
): Promise<RechargeRecommendation> {
  try {
    if (!(await readBool(db, 'smart_recommend_enabled', false))) return NO_REC;

    const lookbackDays = Math.max(1, await readInt(db, 'smart_recommend_lookback_days', 14));
    const targetDays = Math.max(1, await readInt(db, 'smart_recommend_target_days', 30));
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - lookbackDays * 86400;

    // Coin OUTFLOW over the window = burn. Negative-amount rows are money
    // leaving the wallet; exclude refunds (a reversal, not spend) and
    // withdrawals (host payout, not caller usage).
    const burnRow = await db
      .prepare(
        `SELECT COALESCE(SUM(-amount), 0) AS burned
         FROM coin_transactions
         WHERE user_id = ? AND created_at > ? AND amount < 0
           AND type NOT IN ('refund', 'withdrawal')`,
      )
      .bind(userId, cutoff)
      .first<{ burned: number }>();

    const burned = Math.max(0, Number(burnRow?.burned) || 0);
    const burnRate = burned / lookbackDays; // coins/day

    const userRow = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(userId).first<{ coins: number }>();
    const balance = Math.max(0, Number(userRow?.coins) || 0);
    const daysLeft = burnRate > 0 ? Math.floor(balance / burnRate) : null;

    const plansRes = await db
      .prepare('SELECT id, coins, bonus_coins, is_popular, price FROM coin_plans WHERE is_active = 1')
      .all<PlanRow>();
    const plans = plansRes.results ?? [];

    const { plan, lastsDays } = pickRecommendedPlan(plans, burnRate, targetDays);
    if (!plan) return { ...NO_REC, enabled: true };

    // Urgency from runway (only meaningful when we have a burn rate).
    let urgency: RechargeRecommendation['urgency'] = 'normal';
    if (daysLeft != null) {
      if (daysLeft < 2) urgency = 'critical';
      else if (daysLeft < 5) urgency = 'low';
    }

    // Human hint.
    let reason: string;
    if (burnRate <= 0) {
      reason = 'Popular choice — a great pack to get started! 🚀';
    } else if (urgency === 'critical') {
      reason = `⚠️ Your coins run out in ~${daysLeft ?? 0} day${daysLeft === 1 ? '' : 's'}. Recharge now to keep your calls going!`;
    } else if (lastsDays != null) {
      const leftTxt = daysLeft != null ? `Your balance lasts ~${daysLeft} day${daysLeft === 1 ? '' : 's'}. ` : '';
      reason = `${leftTxt}This pack keeps you going for ~${lastsDays} day${lastsDays === 1 ? '' : 's'} at your pace. 💛`;
    } else {
      reason = 'Recommended for your usage. 💛';
    }

    return {
      enabled: true,
      recommended_plan_id: plan.id,
      burn_rate_per_day: Math.round(burnRate * 10) / 10,
      days_left: daysLeft,
      lasts_days: lastsDays,
      urgency,
      reason,
    };
  } catch (e) {
    console.warn('[smartRecommend] computeRechargeRecommendation failed for', userId, e);
    return NO_REC;
  }
}
