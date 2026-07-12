// ============================================================================
// Personalized host recommendation — scoring engine (Priority 1)
// ============================================================================
//
// The public host list (`GET /api/hosts`) ranks every host the SAME way for
// everyone: is_online → rank_boost → rating → total_minutes. That's a fine
// "browse all" ordering but it is not personalized and it never gives new
// hosts a chance to be discovered (rich-get-richer).
//
// This module adds a per-user weighted score on top of the existing quality
// signals, blending:
//
//   • Quality      — rating, level rank_boost, popularity (review_count).
//   • Availability — online right now is a big boost.
//   • Affinity     — favorites, prior calls with this host, and the user's
//                    inferred language/specialty/gender preferences.
//   • Exploration  — a cold-start "freshness" boost for new hosts plus a small
//                    random jitter (epsilon-greedy style) so the rail isn't
//                    identical on every load and new supply gets exposure.
//
// It is intentionally a transparent, tunable linear model (NOT an opaque ML
// black box): every weight lives in `app_settings.reco_weights` so admins can
// retune without a deploy, and every result carries a human-readable `reason`.
//
// Pure functions only — no DB, no env. The route (host.ts) gathers the
// candidate pool + the user's affinity signals and calls `scoreHosts()`.
// ============================================================================

import { getRankBoost, type LevelDef } from './levels';

/** Tunable weights for the linear scoring model. All default to sane values. */
export interface RecoWeights {
  /** Host is online right now. Dominant signal — an offline host can't take a call. */
  online: number;
  /** Average rating, normalized to 0..1 (rating / 5). */
  rating: number;
  /** Level rank_boost, normalized against the configured ladder's max. */
  rank_boost: number;
  /** Popularity from review_count, log-scaled and capped. */
  popularity: number;
  /** User has favorited this host. */
  favorite: number;
  /** User has called this host before (log-scaled affinity). */
  past_calls: number;
  /** Fraction of the host's languages that match the user's inferred languages. */
  language: number;
  /** Fraction of the host's specialties that match the user's inferred specialties. */
  specialty: number;
  /** Host gender matches the gender the user tends to call. */
  gender: number;
  /** Cold-start boost for new hosts with few reviews (exploration). */
  freshness: number;
  /** Magnitude of the random jitter added to every score (exploration). */
  exploration: number;
  /** Recent conversion performance (impressions→calls) from engagement stats. */
  performance: number;
}

export const DEFAULT_WEIGHTS: RecoWeights = {
  online: 1.0,
  rating: 0.6,
  rank_boost: 0.5,
  popularity: 0.3,
  favorite: 1.2,
  past_calls: 0.8,
  language: 0.4,
  specialty: 0.4,
  gender: 0.3,
  freshness: 0.5,
  exploration: 0.15,
  performance: 0.5,
};

/**
 * Merge an arbitrary (possibly partial / malformed) saved weights blob over
 * the defaults. Every field is coerced to a finite non-negative number so a
 * corrupt `app_settings.reco_weights` row can never produce NaN scores or
 * negative weights — it just falls back to the default for that field.
 */
export function normalizeWeights(input: unknown): RecoWeights {
  const out: RecoWeights = { ...DEFAULT_WEIGHTS };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof RecoWeights)[]) {
      const v = Number((input as Record<string, unknown>)[key]);
      if (Number.isFinite(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}

/** A candidate host the scorer ranks. Mirrors the columns host.ts selects. */
export interface CandidateHost {
  id: string;
  user_id: string;
  level: number;
  rating: number;
  review_count: number;
  is_online: number;
  created_at: number;
  gender: string | null;
  languages: string[];
  specialties: string[];
  /**
   * Recent conversion performance in [0,1]: how often surfacing this host led
   * to a call (impressions→conversions from host_engagement_stats), confidence-
   * shrunk so low-traffic hosts aren't over/under-rated. Optional — defaults 0.
   */
  performanceScore?: number;
  // Passthrough fields the route returns to the client (not used in scoring).
  [extra: string]: unknown;
}

/** Per-user affinity signals, derived once per request from the user's history. */
export interface UserAffinity {
  /** Host ids the user has favorited. */
  favoriteHostIds: Set<string>;
  /** host_id → number of past ended calls with that host. */
  callCountByHost: Map<string, number>;
  /** Languages the user tends to engage with (lowercased). */
  preferredLanguages: Set<string>;
  /** Specialties the user tends to engage with (lowercased). */
  preferredSpecialties: Set<string>;
  /** Gender the user tends to call ('male' | 'female' | null). */
  preferredGender: string | null;
}

export interface ScoredHost {
  host: CandidateHost;
  score: number;
  /** Short, user-facing explanation of why this host surfaced. */
  reason: string;
  /** Per-signal contribution breakdown — handy for admin debugging / tuning. */
  breakdown: Record<string, number>;
}

const NOW = () => Math.floor(Date.now() / 1000);
const SECONDS_PER_DAY = 86400;

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? 1 : n;
}

function lower(s: string): string {
  return String(s).trim().toLowerCase();
}

/** Fraction of `hostItems` that appear in `prefSet` (0..1). */
function overlapFraction(hostItems: string[], prefSet: Set<string>): number {
  if (!hostItems.length || prefSet.size === 0) return 0;
  let hits = 0;
  for (const item of hostItems) {
    if (prefSet.has(lower(item))) hits++;
  }
  return hits / hostItems.length;
}

/**
 * Cold-start boost: highest for hosts created recently that still have few
 * reviews, decaying to 0 over ~30 days or once they accumulate reviews. This
 * is the exploration lever that gives new supply a fair shot at discovery.
 */
function freshnessScore(createdAt: number, reviewCount: number, now: number): number {
  const ageDays = Math.max(0, (now - (Number(createdAt) || now)) / SECONDS_PER_DAY);
  if (ageDays > 30) return 0;
  const ageFactor = 1 - ageDays / 30; // 1 when brand new → 0 at 30 days
  // Established hosts (lots of reviews) don't need a cold-start nudge.
  const reviewFactor = 1 / (1 + Math.max(0, Number(reviewCount) || 0) / 10);
  return clamp01(ageFactor * reviewFactor);
}

/**
 * Deterministic-but-spread pseudo-random in [0,1) seeded by host id + an
 * optional per-request seed. Using a seeded hash (instead of Math.random)
 * keeps a single response stable if scored twice, while the optional seed
 * lets the route vary exploration between loads.
 */
function seededJitter(hostId: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < hostId.length; i++) {
    h ^= hostId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map to [0,1)
  return ((h >>> 0) % 100000) / 100000;
}

/** Score a single host for a user. Exposed for unit testing. */
export function scoreHost(
  host: CandidateHost,
  affinity: UserAffinity,
  weights: RecoWeights,
  config: LevelDef[],
  opts: { now?: number; maxRankBoost?: number; seed?: number } = {},
): ScoredHost {
  const now = opts.now ?? NOW();
  const seed = opts.seed ?? 0;

  const online = host.is_online ? 1 : 0;
  const ratingNorm = clamp01((Number(host.rating) || 0) / 5);

  const maxRankBoost = opts.maxRankBoost && opts.maxRankBoost > 0 ? opts.maxRankBoost : 1;
  const rankBoostNorm = clamp01(getRankBoost(host.level ?? 1, config) / maxRankBoost);

  // log10(1+n)/3 ≈ 1.0 around 1000 reviews; capped at 1.
  const popularity = clamp01(Math.log10(1 + Math.max(0, Number(host.review_count) || 0)) / 3);

  const isFavorite = affinity.favoriteHostIds.has(host.id) ? 1 : 0;

  const calls = affinity.callCountByHost.get(host.id) ?? 0;
  // log10(1+calls): 1 call ≈ 0.30, 10 calls ≈ 1.0 (capped).
  const pastCalls = clamp01(Math.log10(1 + calls));

  const languageMatch = overlapFraction(host.languages ?? [], affinity.preferredLanguages);
  const specialtyMatch = overlapFraction(host.specialties ?? [], affinity.preferredSpecialties);

  const genderMatch =
    affinity.preferredGender && lower(String(host.gender ?? '')) === affinity.preferredGender ? 1 : 0;

  const freshness = freshnessScore(host.created_at, host.review_count, now);
  const jitter = seededJitter(host.id, seed);
  const performance = clamp01(Number(host.performanceScore) || 0);

  const breakdown: Record<string, number> = {
    online: weights.online * online,
    rating: weights.rating * ratingNorm,
    rank_boost: weights.rank_boost * rankBoostNorm,
    popularity: weights.popularity * popularity,
    favorite: weights.favorite * isFavorite,
    past_calls: weights.past_calls * pastCalls,
    language: weights.language * languageMatch,
    specialty: weights.specialty * specialtyMatch,
    gender: weights.gender * genderMatch,
    freshness: weights.freshness * freshness,
    exploration: weights.exploration * jitter,
    performance: weights.performance * performance,
  };

  let score = 0;
  for (const v of Object.values(breakdown)) score += v;

  // Reason picks the strongest *affinity/quality* signal (ignoring the
  // always-on online + exploration noise) for a friendly UI label.
  const reason = pickReason({
    isFavorite,
    pastCalls,
    languageMatch,
    specialtyMatch,
    genderMatch,
    freshness,
    ratingNorm,
    online,
  });

  return { host, score, reason, breakdown };
}

function pickReason(s: {
  isFavorite: number;
  pastCalls: number;
  languageMatch: number;
  specialtyMatch: number;
  genderMatch: number;
  freshness: number;
  ratingNorm: number;
  online: number;
}): string {
  if (s.isFavorite) return 'One of your favorites';
  if (s.pastCalls > 0) return "You've talked before";
  if (s.languageMatch > 0) return 'Speaks your language';
  if (s.specialtyMatch > 0) return 'Matches your interests';
  if (s.freshness > 0.5) return 'New host — say hi';
  if (s.ratingNorm >= 0.9) return 'Top rated';
  if (s.genderMatch) return 'Recommended for you';
  if (s.online) return 'Online now';
  return 'Recommended for you';
}

/**
 * Rank a candidate pool for a user. Returns the top `limit` hosts by score,
 * highest first. Online hosts always outrank offline ones (availability gate)
 * regardless of other signals, since you can't call someone who's offline.
 */
export function scoreHosts(
  hosts: CandidateHost[],
  affinity: UserAffinity,
  weights: RecoWeights,
  config: LevelDef[],
  opts: { now?: number; limit?: number; seed?: number } = {},
): ScoredHost[] {
  const now = opts.now ?? NOW();
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 20;

  // Normalize rank_boost against the ladder's max so the weight behaves the
  // same regardless of how generous the admin's top-tier boost is.
  const maxRankBoost = Math.max(
    1,
    ...config.map((l) => getRankBoost(l.level, config)),
  );

  const scored = hosts.map((h) =>
    scoreHost(h, affinity, weights, config, { now, maxRankBoost, seed: opts.seed ?? 0 }),
  );

  scored.sort((a, b) => {
    // Availability gate: online first.
    const aOnline = a.host.is_online ? 1 : 0;
    const bOnline = b.host.is_online ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    if (b.score !== a.score) return b.score - a.score;
    // Stable tiebreak so paging/ordering is deterministic.
    return a.host.id < b.host.id ? -1 : a.host.id > b.host.id ? 1 : 0;
  });

  return scored.slice(0, limit);
}
