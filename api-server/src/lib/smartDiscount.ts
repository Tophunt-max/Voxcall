// ============================================================================
// Smart Discount Engine — segment-aware, time-limited recharge offers.
// ============================================================================
//
// Instead of a single flat "first recharge bonus", this computes the BEST
// personalized offer for a user based on their lifecycle segment:
//
//   • welcome        — brand-new account, inside a time-limited welcome window
//                      (e.g. "50% extra, valid for the first 24 hours").
//   • first_recharge — has never purchased (no time limit) — convert them.
//   • winback        — purchased before but has been idle N+ days — pull them back.
//   • vip            — active VIP member — an exclusive loyalty perk.
//   • returning      — active, recent buyer — a small everyday loyalty bonus.
//
// The offer is delivered as EXTRA BONUS COINS (not a price cut), because:
//   1. It works identically across every payment method (gateway + manual UPI).
//   2. It's granted + enforced SERVER-SIDE at credit time — impossible to game.
//   3. It matches the existing applyPurchaseBonuses architecture.
//
// Everything is admin-configurable via app_settings and defaults to DISABLED,
// so turning it on is an explicit opt-in with no surprise behaviour change.
//
// The SAME function powers both:
//   • the checkout DISPLAY (GET /api/coins/offer) — show "you'll get +X%!"
//   • the money path (applyPurchaseBonuses) — actually grant the bonus.
// so what the user is promised is exactly what they receive.
// ============================================================================

export type SmartSegment =
  | 'welcome'
  | 'first_recharge'
  | 'winback'
  | 'vip'
  | 'returning'
  | 'none';

export interface SmartOffer {
  enabled: boolean;
  segment: SmartSegment;
  /** Short, attractive title for the checkout banner. */
  label: string;
  /** One-line supporting copy. */
  description: string;
  /** Bonus coin percentage applied to the plan's base coins. */
  bonus_pct: number;
  /** Unix seconds when a TIME-LIMITED offer expires (welcome window). null = no expiry. */
  expires_at: number | null;
  /** Seconds remaining for a time-limited offer (0 when not time-limited). */
  expires_in_sec: number;
}

const NO_OFFER: SmartOffer = {
  enabled: false,
  segment: 'none',
  label: '',
  description: '',
  bonus_pct: 0,
  expires_at: null,
  expires_in_sec: 0,
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
/**
 * Compute the single best offer for a user right now.
 *
 * @param excludePurchaseId When granting AFTER a purchase row is already marked
 *   'success', pass its id so it isn't counted when deciding "first recharge".
 *   Omit for the pre-purchase checkout display.
 */
export async function computeSmartOffer(
  db: D1Database,
  userId: string,
  opts: { excludePurchaseId?: string } = {},
): Promise<SmartOffer> {
  try {
    if (!(await readBool(db, 'smart_discount_enabled', false))) return NO_OFFER;

    const now = Math.floor(Date.now() / 1000);

    // One round-trip for the user's lifecycle signals.
    const user = await db
      .prepare('SELECT created_at, updated_at, vip_expires_at FROM users WHERE id = ?')
      .bind(userId)
      .first<{ created_at: number | null; updated_at: number | null; vip_expires_at: number | null }>();
    if (!user) return NO_OFFER;

    // Successful-purchase signals (count + most recent), excluding the current
    // purchase when granting post-approval.
    const purchaseRow = await db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(MAX(created_at), 0) AS last_at
         FROM coin_purchases
         WHERE user_id = ? AND status = 'success' AND id != ?`,
      )
      .bind(userId, opts.excludePurchaseId ?? '')
      .first<{ n: number; last_at: number }>();

    const purchaseCount = Number(purchaseRow?.n) || 0;
    const lastPurchaseAt = Number(purchaseRow?.last_at) || 0;
    const hasPurchased = purchaseCount > 0;

    const createdAt = Number(user.created_at) || now;
    const vipActive = (Number(user.vip_expires_at) || 0) > now;

    // "Last active" = most recent of last purchase or profile activity.
    const lastActive = Math.max(lastPurchaseAt, Number(user.updated_at) || 0, createdAt);
    const idleSec = Math.max(0, now - lastActive);

    const cap = Math.max(0, await readInt(db, 'smart_discount_max_pct', 100));
    const clampPct = (p: number) => Math.max(0, Math.min(cap, p));

    // ── Global campaign window (admin "discount valid until") ──────────────
    // `smart_discount_ends_at` (unix seconds; 0 = no global expiry). When set,
    // the ENTIRE campaign stops after this time, and EVERY segment offer shows
    // a live countdown to it (not just the welcome window). This is the admin's
    // "kitne din tak discount milega" control.
    const campaignEnd = await readInt(db, 'smart_discount_ends_at', 0);
    if (campaignEnd > 0 && now >= campaignEnd) return NO_OFFER; // campaign is over

    // Effective expiry for an offer = the SOONEST of its own limit (e.g. the
    // welcome window) and the global campaign end. null = no time limit.
    const buildExpiry = (segmentEnd: number | null): { expires_at: number | null; expires_in_sec: number } => {
      const candidates = [segmentEnd, campaignEnd > 0 ? campaignEnd : null].filter(
        (x): x is number => x != null && x > 0,
      );
      if (candidates.length === 0) return { expires_at: null, expires_in_sec: 0 };
      const e = Math.min(...candidates);
      return { expires_at: e, expires_in_sec: Math.max(0, e - now) };
    };

    // ── Segment resolution (priority order) ────────────────────────────────
    // 1) Brand-new account still inside the welcome window (and yet to buy) —
    //    the strongest, urgency-driven offer with a live countdown.
    if (!hasPurchased) {
      const welcomeHours = await readInt(db, 'smart_discount_welcome_hours', 24);
      const welcomeEnd = createdAt + welcomeHours * 3600;
      if (welcomeHours > 0 && now < welcomeEnd) {
        const pct = clampPct(await readInt(db, 'smart_discount_welcome_pct', 50));
        if (pct > 0) {
          return {
            enabled: true,
            segment: 'welcome',
            label: `🎁 Welcome Offer — ${pct}% Extra Coins!`,
            description: `Recharge now and get ${pct}% bonus coins — but hurry, this welcome deal is only for your first few hours! ⏳`,
            bonus_pct: pct,
            ...buildExpiry(welcomeEnd),
          };
        }
      }
      // 2) Never purchased, welcome window passed — steady first-recharge push.
      const pct = clampPct(await readInt(db, 'smart_discount_first_recharge_pct', 30));
      if (pct > 0) {
        return {
          enabled: true,
          segment: 'first_recharge',
          label: `🚀 First Recharge — ${pct}% Extra Coins!`,
          description: `Make your very first recharge and instantly get ${pct}% bonus coins on top. 💛`,
          bonus_pct: pct,
          ...buildExpiry(null),
        };
      }
      return NO_OFFER;
    }

    // 3) Lapsed buyer — win them back.
    const winbackIdleDays = await readInt(db, 'smart_discount_winback_idle_days', 7);
    if (winbackIdleDays > 0 && idleSec >= winbackIdleDays * 86400) {
      const pct = clampPct(await readInt(db, 'smart_discount_winback_pct', 25));
      if (pct > 0) {
        return {
          enabled: true,
          segment: 'winback',
          label: `💜 We Missed You — ${pct}% Extra Coins!`,
          description: `Welcome back! Here's ${pct}% bonus coins on your next recharge to pick up right where you left off. ✨`,
          bonus_pct: pct,
          ...buildExpiry(null),
        };
      }
    }

    // 4) Active VIP — exclusive loyalty perk.
    if (vipActive) {
      const pct = clampPct(await readInt(db, 'smart_discount_vip_pct', 15));
      if (pct > 0) {
        return {
          enabled: true,
          segment: 'vip',
          label: `👑 VIP Bonus — ${pct}% Extra Coins!`,
          description: `As a VIP member you get an exclusive ${pct}% bonus on every recharge. Enjoy! 🌟`,
          bonus_pct: pct,
          ...buildExpiry(null),
        };
      }
    }

    // 5) Everyday loyal, active buyer — small thank-you bonus.
    const pct = clampPct(await readInt(db, 'smart_discount_returning_pct', 10));
    if (pct > 0) {
      return {
        enabled: true,
        segment: 'returning',
        label: `⭐ Loyalty Bonus — ${pct}% Extra Coins!`,
        description: `Thanks for being with us! Enjoy ${pct}% bonus coins on this recharge. 💛`,
        bonus_pct: pct,
        ...buildExpiry(null),
      };
    }

    return NO_OFFER;
  } catch (e) {
    console.warn('[smartDiscount] computeSmartOffer failed for', userId, e);
    return NO_OFFER;
  }
}

/**
 * Compute the bonus COINS a smart offer grants for a given base coin amount.
 * Applies the same per-grant max-coins safety cap used elsewhere.
 */
export async function smartOfferBonusCoins(
  db: D1Database,
  offer: SmartOffer,
  baseCoins: number,
): Promise<number> {
  if (!offer.enabled || offer.bonus_pct <= 0 || baseCoins <= 0) return 0;
  const raw = Math.round((baseCoins * offer.bonus_pct) / 100);
  const cap = await readInt(db, 'smart_discount_max_coins', 100000);
  return Math.max(0, Math.min(cap, raw));
}
