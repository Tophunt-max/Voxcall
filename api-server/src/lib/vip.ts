// ============================================================================
// VIP subscription helpers
// ============================================================================
// Single source of truth for "is this user an active VIP and what perks do they
// get". Benefits are read live from vip_plans (joined on the user's stored
// tier) so admin edits apply to every active subscriber immediately.
//
// Every function is defensive: any DB error (e.g. the VIP tables/columns don't
// exist on an un-migrated deployment) resolves to "not a VIP" instead of
// throwing, so VIP checks can be dropped into hot paths (call initiate, chat)
// without any risk of breaking them.
// ============================================================================

export interface VipStatus {
  isVip: boolean;
  tier: string | null;
  planName: string | null;
  expiresAt: number | null;
  /** % discount on the per-minute call rate (0–90). */
  callDiscountPct: number;
  /** Coins claimable once per day. */
  dailyBonusCoins: number;
  /** Whether VIP can DM any host without a prior call (bypasses call_first). */
  chatUnlock: boolean;
}

export const NO_VIP: VipStatus = {
  isVip: false,
  tier: null,
  planName: null,
  expiresAt: null,
  callDiscountPct: 0,
  dailyBonusCoins: 0,
  chatUnlock: false,
};

/** Resolve a user's live VIP status + perks. Never throws. */
export async function getVipStatus(db: D1Database, userId: string): Promise<VipStatus> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await db
      .prepare(
        `SELECT u.vip_tier AS tier, u.vip_expires_at AS expires_at,
                p.name AS plan_name, p.call_discount_pct, p.daily_bonus_coins, p.chat_unlock
         FROM users u
         LEFT JOIN vip_plans p ON p.tier = u.vip_tier
         WHERE u.id = ?`
      )
      .bind(userId)
      .first<any>();

    if (!row || !row.expires_at || Number(row.expires_at) <= now) return NO_VIP;

    return {
      isVip: true,
      tier: row.tier ?? null,
      planName: row.plan_name ?? null,
      expiresAt: Number(row.expires_at),
      callDiscountPct: Math.max(0, Math.min(90, Number(row.call_discount_pct) || 0)),
      dailyBonusCoins: Math.max(0, Number(row.daily_bonus_coins) || 0),
      chatUnlock: row.chat_unlock === null || row.chat_unlock === undefined ? true : !!Number(row.chat_unlock),
    };
  } catch {
    return NO_VIP;
  }
}

/**
 * Apply a VIP call discount to a base per-minute rate, clamped so it can never
 * drop below the platform's loss-proof floor. Returns a whole-coin rate.
 */
export function applyVipCallDiscount(baseRate: number, discountPct: number, floorRate: number): number {
  if (!discountPct || discountPct <= 0) return Math.max(baseRate, floorRate);
  const discounted = Math.round(baseRate * (1 - discountPct / 100));
  return Math.max(discounted, floorRate);
}
