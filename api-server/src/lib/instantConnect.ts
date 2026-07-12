// ============================================================================
// Smart Instant-Connect engine
// ============================================================================
//
// `lib/matchWeight.ts` powers the RANDOM matcher (quality-weighted draw, no
// per-user affinity). This module powers a different flow: the user taps
// "Talk Now" and we connect them to the single BEST host for THEM right now —
// blending personal affinity with availability and fair load-spreading — and,
// when nobody suitable is online, we return an honest wait estimate + a queue
// position instead of a dead end.
//
// Score for an online candidate (all sub-scores 0..1, then weighted):
//   • affinity     — favorite / prior calls with this host (personal).
//   • rating       — host quality.
//   • rank_boost   — level perk (precomputed, normalized by the caller).
//   • freshness    — cold-start exposure for new hosts.
//   • load_balance — multiplicative penalty for hosts matched a lot recently,
//                    so instant-connect demand spreads across the roster.
//
// When no host is online, estimateWaitSeconds() turns the pool's historical
// availability likelihood into an ETA so the UI can say "~2 min" instead of
// failing. DEFAULT OFF (instant_connect_enabled=0). Pure functions only.
// ============================================================================

export interface InstantWeights {
  affinity: number;
  rating: number;
  rank_boost: number;
  freshness: number;
  load_balance: number;
}

export const DEFAULT_INSTANT_WEIGHTS: InstantWeights = {
  affinity: 1.4,
  rating: 1.0,
  rank_boost: 0.7,
  freshness: 0.5,
  load_balance: 1.0,
};

export function normalizeInstantWeights(input: unknown): InstantWeights {
  const out: InstantWeights = { ...DEFAULT_INSTANT_WEIGHTS };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(DEFAULT_INSTANT_WEIGHTS) as (keyof InstantWeights)[]) {
      const v = Number((input as Record<string, unknown>)[key]);
      if (Number.isFinite(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}

export interface InstantCandidate {
  host_id: string;
  is_online: boolean;
  rating: number;
  review_count: number;
  created_at: number;
  /** rank_boost normalized to 0..1 by the caller (keeps the levels dep out). */
  rank_boost_norm: number;
  /** Times the user has called this host before. */
  past_calls: number;
  /** Whether the user has favorited this host. */
  is_favorite: boolean;
  /** Times matched via instant-connect in the recent load window. */
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

/** Selection score for one online candidate. Always >= 0. */
export function scoreInstantCandidate(
  c: InstantCandidate,
  weights: InstantWeights,
  now: number,
): number {
  const affinity =
    (c.is_favorite ? 0.6 : 0) + clamp01(Math.log10(1 + Math.max(0, Number(c.past_calls) || 0))) * 0.4;
  const rating = clamp01((Number(c.rating) || 0) / 5);
  const rankBoost = clamp01(c.rank_boost_norm);
  const freshness = freshnessScore(c.created_at, c.review_count, now);

  const quality =
    weights.affinity * clamp01(affinity) +
    weights.rating * rating +
    weights.rank_boost * rankBoost +
    weights.freshness * freshness;

  const recent = Math.max(0, Number(c.recent_matches) || 0);
  const loadFactor = 1 / (1 + (recent * weights.load_balance) / 4);

  const s = quality * loadFactor;
  return s > 0 ? s : 0;
}

export interface InstantPick {
  host_id: string | null;
  /** true when we found an online host to connect to. */
  matched: boolean;
  /** Estimated wait in seconds when no host is online (else 0). */
  wait_seconds: number;
  /** Best-effort queue position (1-based) when waiting. */
  queue_position: number;
  reason: string;
}

/**
 * Pick the best ONLINE candidate. Returns null host_id when none are online
 * (caller then falls back to estimateWaitSeconds for the queued path).
 */
export function pickBestInstant(
  candidates: InstantCandidate[],
  weights: InstantWeights,
  now: number,
): { host_id: string | null; score: number } {
  let best: { host_id: string | null; score: number } = { host_id: null, score: -1 };
  for (const c of candidates) {
    if (!c.is_online) continue;
    const s = scoreInstantCandidate(c, weights, now);
    if (s > best.score) best = { host_id: c.host_id, score: s };
  }
  return best;
}

/**
 * Estimate wait time (seconds) before a suitable host is likely online, from
 * the aggregate historical availability likelihood of the candidate pool.
 *
 * @param poolLikelihood  Sum of per-host P(online) over the pool at this hour
 *                        (an expected number of hosts online).
 * @param maxWaitSeconds  Cap so we never promise an absurd ETA.
 */
export function estimateWaitSeconds(poolLikelihood: number, maxWaitSeconds = 300): number {
  const lambda = Math.max(0, Number(poolLikelihood) || 0);
  if (lambda <= 0) return maxWaitSeconds;
  // Expected wait for a Poisson-ish arrival with rate lambda per (scaled) window.
  // Higher expected-online ⇒ shorter wait. Clamp to [10, maxWaitSeconds].
  const est = Math.round(60 / lambda);
  return Math.min(maxWaitSeconds, Math.max(10, est));
}

/** Compose a full instant-connect decision from a pool + wait inputs. */
export function decideInstant(
  candidates: InstantCandidate[],
  weights: InstantWeights,
  opts: { now: number; poolLikelihood: number; queuePosition?: number; maxWaitSeconds?: number },
): InstantPick {
  const best = pickBestInstant(candidates, weights, opts.now);
  if (best.host_id) {
    return {
      host_id: best.host_id,
      matched: true,
      wait_seconds: 0,
      queue_position: 0,
      reason: 'Connecting you to a great match',
    };
  }
  const wait = estimateWaitSeconds(opts.poolLikelihood, opts.maxWaitSeconds);
  const mins = Math.max(1, Math.round(wait / 60));
  return {
    host_id: null,
    matched: false,
    wait_seconds: wait,
    queue_position: Math.max(1, Math.floor(opts.queuePosition ?? 1)),
    reason: `Hosts are busy — usually about ${mins} min. We'll connect you shortly.`,
  };
}
