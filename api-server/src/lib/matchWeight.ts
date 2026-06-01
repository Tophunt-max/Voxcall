// ============================================================================
// Quality-weighted random matchmaking (Priority 3)
// ============================================================================
//
// The original /match/find picks a host with a uniform COUNT-then-OFFSET draw:
// every online host in the filtered pool has an identical chance. That ignores
// host quality entirely AND lets a handful of hosts who happen to be online
// soak up matches with no regard to whether the user will have a good call.
//
// This module replaces the uniform draw with a WEIGHTED random sample over a
// bounded candidate pool. Each host's selection weight blends:
//
//   • base          — a floor so every eligible host keeps a real chance
//                     (exploration; prevents winner-take-all).
//   • rating        — better-rated hosts surface more often.
//   • rank_boost    — higher level = configured perk weight (normalized).
//   • popularity    — log-scaled review_count (social proof).
//   • freshness     — new hosts get a cold-start bump so fresh supply gets
//                     random calls and is retained.
//   • demand_balance — DAMPENS hosts who've been matched a lot in the recent
//                      window, so demand spreads across the roster instead of
//                      piling onto a few. Applied as a multiplicative penalty
//                      so a weight can never go negative.
//
// Pure functions only (no DB / env) so the route stays testable. Weights live
// in app_settings.match_weights so admins can retune without a deploy.
// ============================================================================

export interface MatchWeights {
  /** Floor weight every candidate gets — drives exploration / fairness. */
  base: number;
  /** Average rating (rating/5). */
  rating: number;
  /** Level rank_boost, normalized against the ladder max (passed precomputed). */
  rank_boost: number;
  /** log10(1+review_count)/3, capped — social proof. */
  popularity: number;
  /** New-host cold-start additive bump. */
  freshness: number;
  /** Strength of the recent-demand penalty (higher = spread harder). */
  demand_balance: number;
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  base: 1.0,
  rating: 1.2,
  rank_boost: 0.8,
  popularity: 0.4,
  freshness: 0.6,
  demand_balance: 1.0,
};

/** Coerce a possibly-malformed saved blob over the defaults (finite, >= 0). */
export function normalizeMatchWeights(input: unknown): MatchWeights {
  const out: MatchWeights = { ...DEFAULT_MATCH_WEIGHTS };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(DEFAULT_MATCH_WEIGHTS) as (keyof MatchWeights)[]) {
      const v = Number((input as Record<string, unknown>)[key]);
      if (Number.isFinite(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}

export interface WeightCandidate {
  rating: number;
  review_count: number;
  created_at: number;
  /** rank_boost already normalized to 0..1 by the caller (keeps levels dep out). */
  rank_boost_norm: number;
  /** How many times this host was matched in the recent demand window. */
  recent_matches: number;
}

const SECONDS_PER_DAY = 86400;

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? 1 : n;
}

function freshnessScore(createdAt: number, reviewCount: number, now: number): number {
  const ageDays = Math.max(0, (now - (Number(createdAt) || now)) / SECONDS_PER_DAY);
  if (ageDays > 30) return 0;
  const ageFactor = 1 - ageDays / 30;
  const reviewFactor = 1 / (1 + Math.max(0, Number(reviewCount) || 0) / 10);
  return clamp01(ageFactor * reviewFactor);
}

/**
 * Selection weight for one candidate. Always strictly positive so every
 * eligible host can be drawn.
 */
export function computeMatchWeight(
  c: WeightCandidate,
  weights: MatchWeights,
  opts: { now: number },
): number {
  const quality =
    weights.base +
    weights.rating * clamp01((Number(c.rating) || 0) / 5) +
    weights.rank_boost * clamp01(c.rank_boost_norm) +
    weights.popularity * clamp01(Math.log10(1 + Math.max(0, Number(c.review_count) || 0)) / 3) +
    weights.freshness * freshnessScore(c.created_at, c.review_count, opts.now);

  // Multiplicative demand penalty: 0 recent matches → factor 1 (no penalty);
  // grows with recent_matches, scaled by the demand_balance weight. Never <= 0.
  const recent = Math.max(0, Number(c.recent_matches) || 0);
  const demandFactor = 1 / (1 + (recent * weights.demand_balance) / 5);

  const w = quality * demandFactor;
  return w > 0 ? w : 0.0001;
}

/**
 * Weighted random sample. Returns null for an empty list. `rng` defaults to
 * Math.random but is injectable for deterministic tests. Non-positive total
 * weight degrades gracefully to the first item.
 */
export function weightedSample<T>(
  items: T[],
  weightOf: (item: T) => number,
  rng: () => number = Math.random,
): T | null {
  if (!items.length) return null;
  let total = 0;
  const weights = items.map((it) => {
    const w = weightOf(it);
    const safe = Number.isFinite(w) && w > 0 ? w : 0;
    total += safe;
    return safe;
  });
  if (total <= 0) return items[0];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
