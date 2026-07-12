// ============================================================================
// Personalized Home Rail Ordering engine
// ============================================================================
//
// `lib/recommend.ts` ranks hosts WITHIN a rail. This module ranks the RAILS
// themselves — the order the home screen stacks "Your favorites",
// "Recommended for you", "Online now", "By interest", etc. — per user, from
// their own tap history.
//
// Signal: engagement_events (surface = rail id, event_type = impression/click/
// conversion). For each rail we compute an affinity = a CTR-like ratio of
// weighted interactions to impressions, Laplace-smoothed so a rail with few
// impressions doesn't swing wildly. Rails the user engages with float up.
//
// Design guarantees:
//   • DEFAULT OFF (rail_order_enabled=0) → the caller keeps its static order.
//   • Pinned rails (e.g. an admin promo banner) never move.
//   • A brand-new user with no history gets exactly the default order (the
//     smoothing prior === the default rank), so cold-start is a no-op.
//   • Pure, deterministic, stable-sorted — same input ⇒ same output.
//
// Pure functions only; the DB gather + flag read live in the route.
// ============================================================================

export interface RailStat {
  /** Stable rail id, e.g. 'favorites' | 'recommended' | 'online' | 'interest'. */
  surface: string;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface RailOrderWeights {
  /** Weight of a click toward affinity. */
  click: number;
  /** Weight of a conversion (call started) — the strongest signal. */
  conversion: number;
  /** Laplace smoothing strength: higher = stickier to the default order. */
  prior: number;
}

export const DEFAULT_RAIL_WEIGHTS: RailOrderWeights = {
  click: 1.0,
  conversion: 3.0,
  prior: 8.0,
};

export function normalizeRailWeights(input: unknown): RailOrderWeights {
  const out: RailOrderWeights = { ...DEFAULT_RAIL_WEIGHTS };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(DEFAULT_RAIL_WEIGHTS) as (keyof RailOrderWeights)[]) {
      const v = Number((input as Record<string, unknown>)[key]);
      if (Number.isFinite(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}

/**
 * Smoothed affinity for one rail. Weighted interactions over impressions, with
 * a Laplace prior in BOTH numerator and denominator so that, with zero
 * history, affinity === `prior/(impr+prior)`-scaled baseline ≈ neutral. Rails
 * with real engagement rise above the prior; ignored rails sink below it.
 */
export function railAffinity(stat: RailStat, w: RailOrderWeights): number {
  const impressions = Math.max(0, Number(stat.impressions) || 0);
  const clicks = Math.max(0, Number(stat.clicks) || 0);
  const conversions = Math.max(0, Number(stat.conversions) || 0);
  const weightedInteractions = clicks * w.click + conversions * w.conversion;
  // Add-prior smoothing: neutral baseline when impressions are low.
  return (weightedInteractions + w.prior * 0.5) / (impressions + w.prior);
}

/**
 * Order rails for a user.
 *
 * @param defaultOrder  Rail ids in their static/default order (authoritative
 *                      fallback + tiebreak).
 * @param stats         Per-rail engagement stats (may be sparse / partial).
 * @param weights       Tunable weights.
 * @param pinned        Rail ids that must keep their default position (never
 *                      re-ranked), e.g. an admin-controlled promo rail.
 * @returns             The reordered rail ids (a permutation of defaultOrder).
 */
export function orderRails(
  defaultOrder: string[],
  stats: Record<string, RailStat>,
  weights: RailOrderWeights,
  pinned: string[] = [],
): string[] {
  const pinnedSet = new Set(pinned);
  const defaultRank = new Map(defaultOrder.map((id, i) => [id, i]));

  // Movable rails, sorted by affinity desc; ties fall back to default order so
  // the result is deterministic and a no-signal user gets the default order.
  const movable = defaultOrder.filter((id) => !pinnedSet.has(id));
  const scored = movable.map((id) => ({
    id,
    affinity: stats[id] ? railAffinity(stats[id], weights) : railAffinity({ surface: id, impressions: 0, clicks: 0, conversions: 0 }, weights),
  }));
  scored.sort((a, b) => {
    if (b.affinity !== a.affinity) return b.affinity - a.affinity;
    return (defaultRank.get(a.id) ?? 0) - (defaultRank.get(b.id) ?? 0);
  });

  // Re-interleave: pinned rails hold their original slots; movable rails fill
  // the remaining slots in their new affinity order.
  const result: string[] = new Array(defaultOrder.length);
  const movableOrder = scored.map((s) => s.id);
  let mi = 0;
  for (let i = 0; i < defaultOrder.length; i++) {
    const original = defaultOrder[i];
    if (pinnedSet.has(original)) {
      result[i] = original;
    } else {
      result[i] = movableOrder[mi++];
    }
  }
  return result;
}
