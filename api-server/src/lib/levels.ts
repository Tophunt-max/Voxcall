// ============================================================================
// Host Level System — single source of truth
// ============================================================================
//
// Host levels start at 1 (the floor every new host begins at) and run up to
// the length of the admin-configured ladder. The thresholds, names, badges,
// colors, coin rewards and PERKS are configurable by admins and persisted as
// JSON in `app_settings.level_config`. Admins may add or remove rungs (within
// MIN_LEVELS..MAX_LEVELS) — see the admin panel and `normalizeLevelConfig`.
//
// ── Flexible N-criteria model (v2) ──────────────────────────────────────────
// Each level rung carries a `criteria` array of {metric, op, value} rules. A
// host earns a level only when EVERY criterion on that rung is satisfied. This
// replaces the old hardcoded 4-threshold model (min_calls / min_rating /
// min_minutes / min_earnings) with an open-ended one — a rung can require any
// number of metrics (0, 4, or 8) and different rungs can gate on different
// metrics. See {@link METRIC_REGISTRY} for the supported metrics.
//
// The legacy `min_calls`/`min_rating`/`min_minutes`/`min_earnings` fields are
// still emitted on every normalized rung (mirrored from the matching criteria)
// so older readers — and the classic progress-bar keys — keep working. Configs
// saved before v2 (which only had the legacy fields, no `criteria`) are
// transparently upgraded by synthesizing criteria from those fields, so there
// is NO data migration and NO behavioural change for existing ladders.
//
// This module centralizes:
//
//   • DEFAULT_LEVEL_CONFIG    — the fallback ladder used when nothing is saved
//   • RECOMMENDED_LEVEL_CONFIG — a richer opt-in ladder (admin "load preset")
//   • METRIC_REGISTRY         — the catalog of metrics a criterion may use
//   • getLevelConfig(db)      — loads (and validates) the saved config or default
//   • evaluateLevel()         — the level a host has EARNED from their stats
//   • computeLevelProgress    — current/next level + progress % for the UI
//   • perk helpers            — getLevelPerks / getEarningShare / getMaxRate
//
// The criteria a host must satisfy is intentionally identical between the auto
// level-up engine (lib/levelService.ts), the admin recalculation, and the
// host-facing progress bar, so a host's displayed progress always predicts
// exactly when they'll be promoted.
// ============================================================================

// ── Metric registry ─────────────────────────────────────────────────────────

/** Every metric key a level criterion may reference. */
export type MetricKey =
  | 'review_count'   // rated calls
  | 'rating'         // average rating 0–5
  | 'total_minutes'  // lifetime talk-time (minutes)
  | 'total_earnings' // lifetime coins earned
  | 'unique_callers' // distinct callers who reached a call
  | 'answer_rate'    // answered / incoming (0–1), derived
  | 'favorite_count'   // followers (favorites)
  | 'streak_max'       // best consecutive-active-day streak
  | 'tenure_days'      // days since the host account was created (derived)
  | 'kyc_verified'     // identity verified flag (0/1)
  | 'online_minutes'   // lifetime time spent online/available
  | 'active_days'      // lifetime distinct active days (came online)
  | 'avg_call_minutes' // average call length = total_minutes / answered (derived)
  | 'repeat_callers';  // answered_calls - unique_callers, i.e. repeat calls (derived)

/** Comparison operators a criterion may use. */
export type CriterionOp = '>=' | '==';

/**
 * How a metric is rendered/validated. Drives clamping in normalizeCriteria and
 * formatting in the admin panel:
 *   • int     — non-negative whole number
 *   • rating  — 0..5, one decimal
 *   • percent — 0..1 fraction (shown as %)
 *   • bool    — 0 or 1
 */
export type MetricKind = 'int' | 'rating' | 'percent' | 'bool';

export interface MetricDef {
  key: MetricKey;
  label: string;
  kind: MetricKind;
  defaultOp: CriterionOp;
  /**
   * The legacy LevelDef field this metric mirrors (for back-compat). Only the
   * original four metrics have one; new metrics live purely in `criteria`.
   */
  legacyField?: 'min_calls' | 'min_rating' | 'min_minutes' | 'min_earnings';
}

/**
 * Catalog of metrics a level criterion can gate on. The admin panel renders one
 * row per registry entry; adding a new metric is a single entry here plus a
 * case in {@link resolveMetricValue} (and, if it needs live tracking, a counter
 * bump at the relevant choke point).
 */
export const METRIC_REGISTRY: MetricDef[] = [
  { key: 'review_count',   label: 'Rated calls',           kind: 'int',     defaultOp: '>=', legacyField: 'min_calls' },
  { key: 'rating',         label: 'Average rating',        kind: 'rating',  defaultOp: '>=', legacyField: 'min_rating' },
  { key: 'total_minutes',  label: 'Total talk-minutes',    kind: 'int',     defaultOp: '>=', legacyField: 'min_minutes' },
  { key: 'total_earnings', label: 'Total coins earned',    kind: 'int',     defaultOp: '>=', legacyField: 'min_earnings' },
  { key: 'unique_callers', label: 'Unique callers',        kind: 'int',     defaultOp: '>=' },
  { key: 'answer_rate',    label: 'Answer rate',           kind: 'percent', defaultOp: '>=' },
  { key: 'favorite_count', label: 'Followers (favorites)', kind: 'int',     defaultOp: '>=' },
  { key: 'streak_max',     label: 'Best daily streak',     kind: 'int',     defaultOp: '>=' },
  { key: 'tenure_days',    label: 'Days on platform',      kind: 'int',     defaultOp: '>=' },
  { key: 'kyc_verified',   label: 'KYC verified',          kind: 'bool',    defaultOp: '==' },
  { key: 'online_minutes',   label: 'Total online-time (min)', kind: 'int', defaultOp: '>=' },
  { key: 'active_days',      label: 'Active days (lifetime)',  kind: 'int', defaultOp: '>=' },
  { key: 'avg_call_minutes', label: 'Avg call length (min)',   kind: 'int', defaultOp: '>=' },
  { key: 'repeat_callers',   label: 'Repeat callers',          kind: 'int', defaultOp: '>=' },
];

const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(
  METRIC_REGISTRY.map((m) => [m.key, m]),
);

/** A single threshold rule on a level rung. */
export interface Criterion {
  metric: MetricKey;
  op: CriterionOp;
  value: number;
}

/** Per-level benefits unlocked when a host reaches that level. */
export interface LevelPerks {
  /**
   * Legacy combined max coins/min cap — kept as a back-compat summary
   * (= max(max_audio_rate, max_video_rate)). New code should prefer the
   * channel-specific caps below.
   */
  max_rate: number;
  /** Max coins/min a host at this level may charge for AUDIO calls. */
  max_audio_rate: number;
  /** Max coins/min a host at this level may charge for VIDEO calls. */
  max_video_rate: number;
  /**
   * Coins/min charged for an AUDIO call when the caller used /match/find
   * (random matchmaking) and was assigned a host at THIS level. Lets admins
   * reward higher-level hosts with a richer per-minute rate on random calls
   * instead of the historical flat `random_call_audio_rate`. Falls back to
   * the global `random_call_audio_rate` setting when null/undefined.
   */
  random_audio_rate: number;
  /** Same as `random_audio_rate` but for VIDEO random calls. */
  random_video_rate: number;
  /** Host's share of coins charged per call (0–1). Platform keeps the rest. */
  earning_share: number;
  /** Search/discovery ranking weight — higher = shown earlier to users. */
  rank_boost: number;
}

export interface LevelDef {
  level: number;
  name: string;
  badge: string;
  color: string;
  /**
   * Flexible threshold rules — a host must satisfy ALL of them to earn this
   * level. Always present (possibly empty for level 1) after normalization.
   */
  criteria: Criterion[];
  /** Legacy mirror of the `review_count` criterion — Min RATED calls. */
  min_calls: number;
  /** Legacy mirror of the `rating` criterion — Min average rating (0–5). */
  min_rating: number;
  /** Legacy mirror of the `total_minutes` criterion — Min talk-time (minutes). */
  min_minutes: number;
  /** Legacy mirror of the `total_earnings` criterion — Min coins earned. */
  min_earnings: number;
  coin_reward: number;
  description: string;
  perks: LevelPerks;
}

/** Global hard cap on per-minute rate — no level may exceed this. */
export const ABSOLUTE_MAX_RATE = 500;
/** Baseline host earning share (level 1) — preserves historical behaviour. */
export const BASE_EARNING_SHARE = 0.7;
/**
 * Standard default per-minute call rates for a brand-new host, in COINS.
 * Tied to the production coin economy: coins are bought at ≈ ₹0.20/coin, so:
 *   DEFAULT_AUDIO_RATE    30 coins/min ≈ ₹6/min    (standard voice-call price)
 *   DEFAULT_VIDEO_RATE    50 coins/min ≈ ₹10/min   (HD video — the default,
 *                                                   capped at 720p on clients)
 *   DEFAULT_VIDEO_FHD_RATE 80 coins/min ≈ ₹16/min  (Full-HD premium — only used
 *                                                   if a host/plan opts into
 *                                                   1080p, which costs ~2.25× as
 *                                                   much on Agora)
 * These were re-derived from the Agora cost model (see lib/callEconomics.ts):
 * every default sits comfortably above the loss-proof floor, giving the host a
 * competitive cash payout (~30% of user spend) while keeping a ~60%+ platform
 * margin. A host can still change their own rate within their level cap; these
 * are only the starting values used when no explicit rate was chosen.
 */
export const DEFAULT_AUDIO_RATE = 30;
export const DEFAULT_VIDEO_RATE = 50;
export const DEFAULT_VIDEO_FHD_RATE = 80;
/**
 * Headroom (coins/min) a host may charge ABOVE the admin-configured level cap.
 * Lets a host nudge their rate up to N coins past `max_audio_rate` /
 * `max_video_rate` so the level cap acts as a soft target rather than a hard
 * lid. Still clamped to ABSOLUTE_MAX_RATE.
 */
export const HOST_RATE_BONUS = 5;

/**
 * Minimum number of rungs a configured ladder may have. Level 1 (the
 * starting tier every new host begins at) must always exist.
 */
export const MIN_LEVELS = 1;
/**
 * Maximum number of rungs admins may configure. Cap exists to bound payload
 * size on `app_settings.level_config`, prevent unbounded UI growth in the
 * admin panel, and keep `hosts.level` values within a reasonable range.
 * Tune up here (and re-deploy) if 20 ever proves too tight in production.
 */
export const MAX_LEVELS = 20;

/** Build the classic 4-metric criteria list from legacy threshold values. */
function classicCriteria(
  min_calls: number,
  min_rating: number,
  min_minutes: number,
  min_earnings: number,
): Criterion[] {
  const out: Criterion[] = [];
  if (min_calls > 0) out.push({ metric: 'review_count', op: '>=', value: min_calls });
  if (min_rating > 0) out.push({ metric: 'rating', op: '>=', value: min_rating });
  if (min_minutes > 0) out.push({ metric: 'total_minutes', op: '>=', value: min_minutes });
  if (min_earnings > 0) out.push({ metric: 'total_earnings', op: '>=', value: min_earnings });
  return out;
}

/**
 * Fallback ladder — the seed shipped by default. Kept intentionally to the
 * CLASSIC four work-based metrics so:
 *   • existing production hosts are never suddenly blocked by a metric that has
 *     no historical data, and
 *   • the promotion-only engine behaves exactly as before on a fresh install.
 *
 * Admins who want richer gating (unique callers, answer rate, followers, KYC…)
 * can one-click load {@link RECOMMENDED_LEVEL_CONFIG} from the admin panel, or
 * add individual criteria per rung. Perk tiers are conservative so low-level
 * hosts see no regression: level 1 keeps the historical 70% share.
 */
export const DEFAULT_LEVEL_CONFIG: LevelDef[] = [
  { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0.0, min_minutes: 0,    min_earnings: 0,     criteria: classicCriteria(0, 0.0, 0, 0),             coin_reward: 0,    description: 'New to the platform',  perks: { max_rate: 100, max_audio_rate: 100, max_video_rate: 100, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 0 } },
  { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, min_minutes: 50,   min_earnings: 500,   criteria: classicCriteria(50, 4.0, 50, 500),         coin_reward: 100,  description: 'Getting established',   perks: { max_rate: 150, max_audio_rate: 150, max_video_rate: 150, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 1 } },
  { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, min_minutes: 300,  min_earnings: 3000,  criteria: classicCriteria(200, 4.3, 300, 3000),      coin_reward: 300,  description: 'Proven expertise',     perks: { max_rate: 250, max_audio_rate: 250, max_video_rate: 250, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.72, rank_boost: 2 } },
  { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, min_minutes: 1000, min_earnings: 15000, criteria: classicCriteria(500, 4.6, 1000, 15000),    coin_reward: 500,  description: 'Professional tier',    perks: { max_rate: 400, max_audio_rate: 400, max_video_rate: 400, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.75, rank_boost: 3 } },
  { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, min_minutes: 2500, min_earnings: 50000, criteria: classicCriteria(1000, 4.8, 2500, 50000),   coin_reward: 1000, description: 'Top performer',        perks: { max_rate: 500, max_audio_rate: 500, max_video_rate: 500, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.80, rank_boost: 5 } },
];

/**
 * Richer, opt-in ladder showcasing the N-criteria engine. Higher rungs gate on
 * QUALITY + TRUST + CONSISTENCY (unique callers, answer rate, followers,
 * tenure, streak, KYC) on top of the classic work metrics — not just volume
 * and revenue. Admins load this from the panel; it is NEVER auto-applied, so no
 * host is silently blocked before the denormalized metrics are backfilled.
 */
export const RECOMMENDED_LEVEL_CONFIG: LevelDef[] = [
  {
    level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', coin_reward: 0,
    description: 'New to the platform',
    criteria: [],
    min_calls: 0, min_rating: 0, min_minutes: 0, min_earnings: 0,
    perks: { max_rate: 100, max_audio_rate: 100, max_video_rate: 100, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 0 },
  },
  {
    level: 2, name: 'Rising', badge: '⭐', color: '#F59E0B', coin_reward: 100,
    description: 'Getting established',
    criteria: [
      { metric: 'review_count', op: '>=', value: 50 },
      { metric: 'rating', op: '>=', value: 4.0 },
      { metric: 'total_minutes', op: '>=', value: 50 },
      { metric: 'total_earnings', op: '>=', value: 500 },
    ],
    min_calls: 50, min_rating: 4.0, min_minutes: 50, min_earnings: 500,
    perks: { max_rate: 150, max_audio_rate: 150, max_video_rate: 150, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 1 },
  },
  {
    level: 3, name: 'Expert', badge: '🔥', color: '#EF4444', coin_reward: 300,
    description: 'Proven expertise — genuine repeat audience',
    criteria: [
      { metric: 'review_count', op: '>=', value: 200 },
      { metric: 'rating', op: '>=', value: 4.3 },
      { metric: 'total_minutes', op: '>=', value: 300 },
      { metric: 'total_earnings', op: '>=', value: 3000 },
      { metric: 'unique_callers', op: '>=', value: 30 },
      { metric: 'answer_rate', op: '>=', value: 0.70 },
    ],
    min_calls: 200, min_rating: 4.3, min_minutes: 300, min_earnings: 3000,
    perks: { max_rate: 250, max_audio_rate: 250, max_video_rate: 250, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.72, rank_boost: 2 },
  },
  {
    level: 4, name: 'Pro', badge: '💎', color: '#8B5CF6', coin_reward: 500,
    description: 'Professional tier — loyal fan base & consistency',
    criteria: [
      { metric: 'review_count', op: '>=', value: 500 },
      { metric: 'rating', op: '>=', value: 4.6 },
      { metric: 'total_minutes', op: '>=', value: 1000 },
      { metric: 'total_earnings', op: '>=', value: 15000 },
      { metric: 'favorite_count', op: '>=', value: 100 },
      { metric: 'tenure_days', op: '>=', value: 30 },
      { metric: 'streak_max', op: '>=', value: 7 },
      { metric: 'online_minutes', op: '>=', value: 1200 },
    ],
    min_calls: 500, min_rating: 4.6, min_minutes: 1000, min_earnings: 15000,
    perks: { max_rate: 400, max_audio_rate: 400, max_video_rate: 400, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.75, rank_boost: 3 },
  },
  {
    level: 5, name: 'Elite', badge: '👑', color: '#D97706', coin_reward: 1000,
    description: 'Top performer — trusted, verified & in demand',
    criteria: [
      { metric: 'review_count', op: '>=', value: 1000 },
      { metric: 'rating', op: '>=', value: 4.8 },
      { metric: 'total_minutes', op: '>=', value: 2500 },
      { metric: 'total_earnings', op: '>=', value: 50000 },
      { metric: 'unique_callers', op: '>=', value: 200 },
      { metric: 'answer_rate', op: '>=', value: 0.85 },
      { metric: 'kyc_verified', op: '==', value: 1 },
      { metric: 'online_minutes', op: '>=', value: 6000 },
      { metric: 'active_days', op: '>=', value: 30 },
    ],
    min_calls: 1000, min_rating: 4.8, min_minutes: 2500, min_earnings: 50000,
    perks: { max_rate: 500, max_audio_rate: 500, max_video_rate: 500, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.80, rank_boost: 5 },
  },
];

/**
 * Build a sensible default LevelDef for a rung that has no entry in
 * {@link DEFAULT_LEVEL_CONFIG}. Used when admins extend the ladder past the
 * five seeded tiers and the saved/posted config omits some fields.
 *
 * The values scale linearly off the last seeded rung (level 5) so call/rating
 * thresholds, rewards and rate caps keep climbing — but everything is also
 * clamped to safe bounds (min_rating <= 5, max_rate <= ABSOLUTE_MAX_RATE).
 */
function generateLevelDefault(level: number): LevelDef {
  const base = DEFAULT_LEVEL_CONFIG[DEFAULT_LEVEL_CONFIG.length - 1];
  const overflow = Math.max(0, level - DEFAULT_LEVEL_CONFIG.length);
  // Ascending thresholds — never below the last default rung.
  const min_calls = base.min_calls + overflow * 1000;
  // Cap min_rating at 5.0 — the score is a 1-5 scale, asking for >5 stars
  // would make the rung permanently unreachable.
  const min_rating = Math.min(5, base.min_rating + overflow * 0.05);
  const min_minutes = base.min_minutes + overflow * 2500;
  const min_earnings = base.min_earnings + overflow * 50000;
  const coin_reward = base.coin_reward + overflow * 500;
  const earning_share = Math.min(0.95, base.perks.earning_share + overflow * 0.02);
  // Rate caps already at the absolute ceiling for level 5 — staying there is
  // the safest default; admins can lower it explicitly if they want.
  const max_audio_rate = ABSOLUTE_MAX_RATE;
  const max_video_rate = ABSOLUTE_MAX_RATE;
  // Random rates also scale up so a freshly-added top tier isn't
  // accidentally cheaper than the previous one.
  const random_audio_rate = Math.min(
    ABSOLUTE_MAX_RATE,
    base.perks.random_audio_rate + overflow * 10,
  );
  const random_video_rate = Math.min(
    ABSOLUTE_MAX_RATE,
    base.perks.random_video_rate + overflow * 15,
  );
  return {
    level,
    name: `Tier ${level}`,
    badge: '🏆',
    color: base.color,
    min_calls,
    min_rating,
    min_minutes,
    min_earnings,
    criteria: classicCriteria(min_calls, min_rating, min_minutes, min_earnings),
    coin_reward,
    description: 'Custom tier — configure in admin panel',
    perks: {
      max_rate: Math.max(max_audio_rate, max_video_rate),
      max_audio_rate,
      max_video_rate,
      random_audio_rate,
      random_video_rate,
      earning_share,
      rank_boost: base.perks.rank_boost + overflow,
    },
  };
}

/**
 * Resolve the fallback LevelDef for slot `i` (0-indexed). Uses the seeded
 * defaults for slots covered by {@link DEFAULT_LEVEL_CONFIG} and a generated
 * tier for any slot beyond that.
 */
function fallbackForSlot(i: number): LevelDef {
  return DEFAULT_LEVEL_CONFIG[i] ?? generateLevelDefault(i + 1);
}

function normalizePerks(input: any, fallback: LevelPerks): LevelPerks {
  const p = input ?? {};
  // Legacy combined cap — used as the fallback for the new channel-specific
  // caps when an older saved config predates them.
  const legacyMax = Math.min(ABSOLUTE_MAX_RATE, Math.max(1, parseInt(String(p.max_rate)) || fallback.max_rate));
  const max_audio_rate = Math.min(
    ABSOLUTE_MAX_RATE,
    Math.max(1, parseInt(String(p.max_audio_rate)) || legacyMax),
  );
  const max_video_rate = Math.min(
    ABSOLUTE_MAX_RATE,
    Math.max(1, parseInt(String(p.max_video_rate)) || legacyMax),
  );
  // Keep legacy `max_rate` in sync (= max of the two channel caps) so any
  // old reader still gets a sensible upper bound.
  const max_rate = Math.max(max_audio_rate, max_video_rate);
  // Per-level random call rates. Older configs (pre-migration) didn't have
  // them — fall back to the seeded defaults so existing data keeps charging
  // the same flat rate everyone is used to.
  const random_audio_rate = Math.min(
    ABSOLUTE_MAX_RATE,
    Math.max(1, parseInt(String(p.random_audio_rate)) || fallback.random_audio_rate),
  );
  const random_video_rate = Math.min(
    ABSOLUTE_MAX_RATE,
    Math.max(1, parseInt(String(p.random_video_rate)) || fallback.random_video_rate),
  );
  // earning_share clamped to a sane 0.1–0.95 band; platform always keeps ≥5%.
  let share = parseFloat(String(p.earning_share));
  if (!isFinite(share) || share <= 0) share = fallback.earning_share;
  const earning_share = Math.min(0.95, Math.max(0.1, share));
  const rank_boost = Math.max(0, parseInt(String(p.rank_boost)) || fallback.rank_boost);
  return {
    max_rate,
    max_audio_rate,
    max_video_rate,
    random_audio_rate,
    random_video_rate,
    earning_share,
    rank_boost,
  };
}

/** Clamp a single criterion value into the safe band for its metric kind. */
function clampCriterionValue(kind: MetricKind, raw: number): number {
  if (!isFinite(raw)) return 0;
  switch (kind) {
    case 'rating':
      return Math.min(5, Math.max(0, Math.round(raw * 10) / 10));
    case 'percent':
      // Accept either a 0–1 fraction or a 0–100 percentage typed by an admin.
      return Math.min(1, Math.max(0, raw > 1 ? raw / 100 : raw));
    case 'bool':
      return raw >= 1 ? 1 : 0;
    case 'int':
    default:
      return Math.max(0, Math.floor(raw));
  }
}

/**
 * Validate + clamp an arbitrary `criteria` array. Drops entries referencing
 * unknown metrics, coerces the operator, clamps the value to the metric's kind,
 * and de-duplicates by metric (last one wins) so a rung can't gate on the same
 * metric twice.
 */
function normalizeCriteria(input: any): Criterion[] {
  if (!Array.isArray(input)) return [];
  const byMetric = new Map<MetricKey, Criterion>();
  for (const raw of input) {
    const key = String(raw?.metric) as MetricKey;
    const def = METRIC_BY_KEY[key];
    if (!def) continue; // unknown metric — ignore
    const op: CriterionOp = raw?.op === '==' ? '==' : '>=';
    const value = clampCriterionValue(def.kind, Number(raw?.value));
    byMetric.set(key, { metric: key, op, value });
  }
  return Array.from(byMetric.values());
}

/** Read a legacy min_* mirror value off a criteria list (0 when absent). */
function legacyMirror(criteria: Criterion[], metric: MetricKey): number {
  const c = criteria.find((x) => x.metric === metric);
  return c ? c.value : 0;
}

/**
 * Resolve the effective criteria for a rung. Prefers an explicit `criteria`
 * array; otherwise synthesizes the classic four from the legacy min_* fields.
 * Used everywhere a rung is evaluated so both v2 and pre-v2 configs work — even
 * when passed straight to evaluateLevel without going through
 * normalizeLevelConfig (e.g. DEFAULT_LEVEL_CONFIG in unit tests).
 */
function criteriaForLevel(l: LevelDef | any): Criterion[] {
  if (Array.isArray(l?.criteria) && l.criteria.length > 0) {
    return normalizeCriteria(l.criteria);
  }
  return classicCriteria(
    Math.max(0, parseInt(String(l?.min_calls)) || 0),
    Math.min(5, Math.max(0, parseFloat(String(l?.min_rating)) || 0)),
    Math.max(0, parseInt(String(l?.min_minutes)) || 0),
    Math.max(0, parseInt(String(l?.min_earnings)) || 0),
  );
}

/**
 * Normalize an arbitrary saved/posted config into a strict ascending ladder
 * of {@link MIN_LEVELS}..{@link MAX_LEVELS} entries. `level` is always
 * renumbered to match position (1..N) so admin-side reorders or deletions
 * never produce gaps. Missing/invalid fields fall back to the seeded default
 * for that slot — or a generated default for slots above the seeded length —
 * so a partially corrupted row can never crash a read path.
 *
 * Criteria handling:
 *   • If a rung supplies a `criteria` array, it is validated/clamped and used
 *     verbatim; the legacy min_* fields are re-derived from it.
 *   • If it has no `criteria` (a pre-v2 saved config), criteria are synthesized
 *     from the legacy min_* fields — transparently upgrading old data.
 *
 * Inputs that are not arrays, are empty, or exceed {@link MAX_LEVELS} fall
 * back to the full {@link DEFAULT_LEVEL_CONFIG}.
 */
export function normalizeLevelConfig(input: unknown): LevelDef[] {
  if (!Array.isArray(input)) return DEFAULT_LEVEL_CONFIG;
  if (input.length < MIN_LEVELS || input.length > MAX_LEVELS) return DEFAULT_LEVEL_CONFIG;
  return input.map((l: any, i: number) => {
    const fallback = fallbackForSlot(i);
    // New multi-metric thresholds. Missing on older saved configs → fall back
    // to the seeded default for that slot, so the feature is active with
    // sensible values without a data migration.
    const legacyCalls = Math.max(0, parseInt(String(l?.min_calls)) || 0);
    const legacyRating = Math.min(5, Math.max(0, parseFloat(String(l?.min_rating)) || 0));
    const legacyMinutes = Math.max(0, parseInt(String(l?.min_minutes)) || (l?.min_minutes === 0 ? 0 : fallback.min_minutes));
    const legacyEarnings = Math.max(0, parseInt(String(l?.min_earnings)) || (l?.min_earnings === 0 ? 0 : fallback.min_earnings));

    // Explicit criteria win; otherwise synthesize from the (possibly
    // backfilled) legacy thresholds so pre-v2 ladders keep their exact gating.
    const criteria = Array.isArray(l?.criteria) && l.criteria.length > 0
      ? normalizeCriteria(l.criteria)
      : classicCriteria(legacyCalls, legacyRating, legacyMinutes, legacyEarnings);

    return {
      // Always renumber sequentially so add/remove operations on the admin
      // side don't leak gaps or duplicates into stored data.
      level: i + 1,
      name: String(l?.name || fallback.name),
      badge: String(l?.badge || fallback.badge),
      color: String(l?.color || fallback.color),
      criteria,
      // Legacy mirrors — derived from the effective criteria so old readers and
      // the classic progress keys stay in sync with the source of truth.
      min_calls: legacyMirror(criteria, 'review_count'),
      min_rating: legacyMirror(criteria, 'rating'),
      min_minutes: legacyMirror(criteria, 'total_minutes'),
      min_earnings: legacyMirror(criteria, 'total_earnings'),
      coin_reward: Math.max(0, parseInt(String(l?.coin_reward)) || 0),
      description: String(l?.description ?? ''),
      perks: normalizePerks(l?.perks, fallback.perks),
    };
  });
}

// ── Config cache ──────────────────────────────────────────────────────────
// getLevelConfig is called many times per request across routes (host listing,
// matchmaking, rating, billing). Reading + parsing app_settings every time is
// wasteful, so we cache the parsed ladder per worker isolate for a short TTL.
// The cache is invalidated explicitly whenever an admin writes a new config
// (see clearLevelConfigCache), and the short TTL bounds staleness for any
// out-of-band write. This is the hot-path scalability win for the level system.
const LEVEL_CONFIG_CACHE_TTL_MS = 30_000;
let levelConfigCache: { at: number; cfg: LevelDef[] } | null = null;

/** Drop the cached level config so the next read reloads from app_settings. */
export function clearLevelConfigCache(): void {
  levelConfigCache = null;
}

/** Load the saved level config from app_settings, or the default ladder. */
export async function getLevelConfig(d: D1Database): Promise<LevelDef[]> {
  const now = Date.now();
  if (levelConfigCache && now - levelConfigCache.at < LEVEL_CONFIG_CACHE_TTL_MS) {
    return levelConfigCache.cfg;
  }
  let cfg: LevelDef[] = DEFAULT_LEVEL_CONFIG;
  try {
    const row = await d.prepare("SELECT value FROM app_settings WHERE key = 'level_config'").first<any>();
    if (row?.value) cfg = normalizeLevelConfig(JSON.parse(row.value));
  } catch (err) {
    console.error('[getLevelConfig] Error fetching or parsing level_config:', err);
    cfg = DEFAULT_LEVEL_CONFIG;
  }
  levelConfigCache = { at: now, cfg };
  return cfg;
}

/**
 * Admin-controlled DEFAULT per-minute call rates (coins) for the calling
 * system. Read from app_settings.default_audio_rate / default_video_rate
 * (set in the admin panel → App Config → Calling System). These are the rates
 * used whenever a host has no explicit per-channel rate set. Falls back to the
 * hardcoded DEFAULT_AUDIO_RATE / DEFAULT_VIDEO_RATE constants when the keys are
 * missing or malformed, so the calling system never bills 0 coins/min.
 */
export async function getDefaultCallRates(
  d: D1Database,
): Promise<{ audio: number; video: number; videoFhd: number }> {
  let audio = DEFAULT_AUDIO_RATE;
  let video = DEFAULT_VIDEO_RATE;
  let videoFhd = DEFAULT_VIDEO_FHD_RATE;
  try {
    const rows = await d
      .prepare("SELECT key, value FROM app_settings WHERE key IN ('default_audio_rate','default_video_rate','default_video_fhd_rate')")
      .all<{ key: string; value: string }>();
    for (const r of rows.results || []) {
      const n = parseInt(r.value, 10);
      if (Number.isFinite(n) && n >= 1) {
        if (r.key === 'default_audio_rate') audio = Math.min(ABSOLUTE_MAX_RATE, n);
        else if (r.key === 'default_video_rate') video = Math.min(ABSOLUTE_MAX_RATE, n);
        else if (r.key === 'default_video_fhd_rate') videoFhd = Math.min(ABSOLUTE_MAX_RATE, n);
      }
    }
  } catch (err) {
    console.error('[getDefaultCallRates] Error fetching default call rates:', err);
  }
  return { audio, video, videoFhd };
}

/**
 * Sort + sanity-check a config into an ascending ladder of length
 * {@link MIN_LEVELS}..{@link MAX_LEVELS}. Falls back to the seeded default
 * ladder only when the input is missing or out of bounds — every function
 * that consumes the ladder otherwise works for any number of rungs.
 */
function asLadder(config: LevelDef[]): LevelDef[] {
  const valid = Array.isArray(config) && config.length >= MIN_LEVELS && config.length <= MAX_LEVELS;
  return (valid ? config : DEFAULT_LEVEL_CONFIG).slice().sort((a, b) => a.level - b.level);
}

export interface HostLevelStats {
  /** Number of rated calls — matches the metric used by the level engine. */
  review_count: number;
  /** Average host rating (0–5). */
  rating: number;
  /** Total talk-time in minutes (hosts.total_minutes). Optional for back-compat. */
  total_minutes?: number;
  /** Total coins earned (hosts.total_earnings — calls + tips + chat). Optional. */
  total_earnings?: number;
  /** Distinct callers who reached an answered/completed call (hosts.unique_callers). */
  unique_callers?: number;
  /** Calls the host actually answered (hosts.answered_calls). */
  answered_calls?: number;
  /** Calls that ever reached the host (hosts.incoming_calls). */
  incoming_calls?: number;
  /** Current follower/favorite count (hosts.favorite_count). */
  favorite_count?: number;
  /** Best consecutive-active-day streak (hosts.streak_max). */
  streak_max?: number;
  /** Unix seconds — host account creation time, for tenure_days. */
  created_at?: number;
  /** Identity verified flag (hosts.identity_verified, 0/1). */
  identity_verified?: number;
  /** Cumulative online/available time in minutes (hosts.online_minutes). */
  online_minutes?: number;
  /** Lifetime distinct active days (hosts.active_days). */
  active_days?: number;
  /** Optional "now" override (unix seconds) for deterministic tenure tests. */
  now?: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolve the current value of a metric for a host, including derived metrics
 * (answer_rate from answered/incoming, tenure_days from created_at, kyc from
 * identity_verified). This is the single place that maps a MetricKey to a
 * number, shared by evaluation and progress display.
 */
export function resolveMetricValue(stats: HostLevelStats, metric: MetricKey): number {
  switch (metric) {
    case 'review_count': return num(stats.review_count);
    case 'rating': return num(stats.rating);
    case 'total_minutes': return num(stats.total_minutes);
    case 'total_earnings': return num(stats.total_earnings);
    case 'unique_callers': return num(stats.unique_callers);
    case 'favorite_count': return num(stats.favorite_count);
    case 'streak_max': return num(stats.streak_max);
    case 'online_minutes': return num(stats.online_minutes);
    case 'active_days': return num(stats.active_days);
    case 'kyc_verified': return num(stats.identity_verified) >= 1 ? 1 : 0;
    case 'avg_call_minutes': {
      // Average talk-time per answered call — an engagement-quality signal.
      // No answered calls yet → 0 (won't satisfy any positive threshold).
      const answered = num(stats.answered_calls);
      if (answered <= 0) return 0;
      return num(stats.total_minutes) / answered;
    }
    case 'repeat_callers': {
      // Repeat calls = answered calls beyond the count of distinct callers.
      // A pure loyalty signal (high when the same fans keep coming back).
      return Math.max(0, num(stats.answered_calls) - num(stats.unique_callers));
    }
    case 'answer_rate': {
      const inc = num(stats.incoming_calls);
      const ans = num(stats.answered_calls);
      // No incoming calls yet → don't block a brand-new host on a ratio that
      // has no denominator; other criteria (min calls) gate them instead.
      if (inc <= 0) return 1;
      return Math.min(1, ans / inc);
    }
    case 'tenure_days': {
      if (!stats.created_at) return 0;
      const nowSec = stats.now ?? Math.floor(Date.now() / 1000);
      return Math.max(0, Math.floor((nowSec - stats.created_at) / 86400));
    }
    default:
      return 0;
  }
}

/** Whether a single criterion is satisfied by the host's stats. */
function criterionMet(stats: HostLevelStats, c: Criterion): boolean {
  const v = resolveMetricValue(stats, c.metric);
  return c.op === '==' ? v === c.value : v >= c.value;
}

/**
 * The level a host has EARNED purely from their stats — the highest rung whose
 * criteria are ALL satisfied. Level 1 is the floor. This is the authoritative
 * promotion check used by the auto level-up engine, so it must exactly match
 * computeLevelProgress's gating below. Works with both v2 (criteria) and pre-v2
 * (legacy min_*) configs via {@link criteriaForLevel}.
 */
export function evaluateLevel(stats: HostLevelStats, config: LevelDef[]): number {
  const ladder = asLadder(config);
  let earned = 1;
  for (const lvl of ladder) {
    if (lvl.level === 1) continue;
    const criteria = criteriaForLevel(lvl);
    if (criteria.every((c) => criterionMet(stats, c))) {
      earned = lvl.level;
    }
  }
  return earned;
}

/** Resolve the perks for a given level number (defaults if out of range). */
export function getLevelPerks(level: number, config: LevelDef[]): LevelPerks {
  const ladder = asLadder(config);
  const def = ladder.find((l) => l.level === level) ?? ladder[0];
  return def.perks;
}

/** Host earning share (0–1) for a level — defaults to the baseline share. */
export function getEarningShare(level: number, config: LevelDef[]): number {
  const share = getLevelPerks(level, config).earning_share;
  return isFinite(share) && share > 0 ? share : BASE_EARNING_SHARE;
}

/** Max coins/min a host at this level may charge (legacy combined cap). */
export function getMaxRate(level: number, config: LevelDef[]): number {
  return getLevelPerks(level, config).max_rate;
}

/** Max coins/min a host at this level may charge for AUDIO calls (admin-set). */
export function getMaxAudioRate(level: number, config: LevelDef[]): number {
  const perks = getLevelPerks(level, config);
  return perks.max_audio_rate ?? perks.max_rate;
}

/** Max coins/min a host at this level may charge for VIDEO calls (admin-set). */
export function getMaxVideoRate(level: number, config: LevelDef[]): number {
  const perks = getLevelPerks(level, config);
  return perks.max_video_rate ?? perks.max_rate;
}

/**
 * Effective AUDIO rate ceiling a host is allowed to set on themselves —
 * admin level cap + HOST_RATE_BONUS, clamped to ABSOLUTE_MAX_RATE.
 */
export function getHostAudioRateCeiling(level: number, config: LevelDef[]): number {
  return Math.min(ABSOLUTE_MAX_RATE, getMaxAudioRate(level, config) + HOST_RATE_BONUS);
}

/**
 * Effective VIDEO rate ceiling a host is allowed to set on themselves —
 * admin level cap + HOST_RATE_BONUS, clamped to ABSOLUTE_MAX_RATE.
 */
export function getHostVideoRateCeiling(level: number, config: LevelDef[]): number {
  return Math.min(ABSOLUTE_MAX_RATE, getMaxVideoRate(level, config) + HOST_RATE_BONUS);
}

/**
 * Per-level random AUDIO rate (admin-set). What a caller who hits
 * /match/find and is matched to a host at this level will be charged per
 * minute. Falls back to the seeded default for the level if the field is
 * missing on a stored perk blob.
 */
export function getRandomAudioRate(level: number, config: LevelDef[]): number {
  const perks = getLevelPerks(level, config);
  const fallback = (DEFAULT_LEVEL_CONFIG[Math.max(0, Math.min(DEFAULT_LEVEL_CONFIG.length - 1, level - 1))]?.perks.random_audio_rate) ?? DEFAULT_AUDIO_RATE;
  return perks.random_audio_rate ?? fallback;
}

/** Same as {@link getRandomAudioRate} but for video random calls. */
export function getRandomVideoRate(level: number, config: LevelDef[]): number {
  const perks = getLevelPerks(level, config);
  const fallback = (DEFAULT_LEVEL_CONFIG[Math.max(0, Math.min(DEFAULT_LEVEL_CONFIG.length - 1, level - 1))]?.perks.random_video_rate) ?? DEFAULT_VIDEO_RATE;
  return perks.random_video_rate ?? fallback;
}

/** Search/discovery ranking weight for a level — higher = shown earlier. */
export function getRankBoost(level: number, config: LevelDef[]): number {
  return getLevelPerks(level, config).rank_boost;
}

/** Compact level descriptor attached to public host payloads. */
export interface LevelInfo {
  level: number;
  name: string;
  badge: string;
  color: string;
}

/**
 * Build the {level,name,badge,color} blob for a host from the admin-configured
 * ladder. Single source of truth — replaces the hardcoded LEVELS maps that
 * previously lived (and silently diverged) in host.ts and match.ts, so changing
 * a badge/name/color in the admin panel now reflects everywhere.
 */
export function buildLevelInfo(config: LevelDef[], level: number | null | undefined): LevelInfo {
  const ladder = asLadder(config);
  const lvl = level && level >= 1 && level <= ladder.length ? level : 1;
  const def = ladder.find((l) => l.level === lvl) ?? ladder[0];
  return { level: def.level, name: def.name, badge: def.badge, color: def.color };
}

/**
 * Build a SQL CASE expression mapping a `hosts.level` column to its configured
 * rank_boost perk, so listings/matchmaking can ORDER BY the perk. The values
 * come from the normalized config (guaranteed integers via normalizePerks), so
 * inlining them is injection-safe.
 */
export function rankBoostCaseSql(config: LevelDef[], levelCol = 'h.level'): string {
  const whens = asLadder(config)
    .map((l) => `WHEN ${Math.trunc(l.level)} THEN ${Math.trunc(l.perks.rank_boost)}`)
    .join(' ');
  return `CASE COALESCE(${levelCol},1) ${whens} ELSE 0 END`;
}

/** Per-criterion progress detail for the generic (N-metric) view. */
export interface CriterionProgress {
  metric: MetricKey;
  label: string;
  kind: MetricKind;
  op: CriterionOp;
  required: number;
  current: number;
  pct: number;
  met: boolean;
}

export interface LevelProgress {
  /** The host's current level number. */
  level: number;
  /** Config entry for the current level. */
  current: LevelDef;
  /** Config entry for the next level, or null when already at max. */
  next: LevelDef | null;
  /** True when the host is at the top of the ladder. */
  is_max_level: boolean;
  /** 0–100 progress towards the next level (min of all requirement %s). */
  progress_pct: number;
  /**
   * Classic per-requirement breakdown (calls/rating/minutes/earnings) — kept
   * for backward compatibility with existing clients. Derived from the next
   * rung's criteria; a metric the next rung doesn't gate on reports met=true.
   */
  requirements: {
    calls: { current: number; required: number; pct: number; met: boolean };
    rating: { current: number; required: number; pct: number; met: boolean };
    minutes: { current: number; required: number; pct: number; met: boolean };
    earnings: { current: number; required: number; pct: number; met: boolean };
  };
  /** Generic per-criterion breakdown for the next level (all N metrics). */
  criteria: CriterionProgress[];
  /** Perks unlocked at the current level. */
  perks: LevelPerks;
}

function clampPct(n: number): number {
  if (!isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

/** Progress % of a single criterion (== criteria are all-or-nothing). */
function criterionPct(current: number, c: Criterion): number {
  if (c.op === '==') return current === c.value ? 100 : 0;
  if (c.value <= 0) return 100;
  return clampPct((current / c.value) * 100);
}

/** Build the classic 4-key requirements block from a criteria list. */
function classicRequirements(stats: HostLevelStats, criteria: Criterion[]) {
  const build = (metric: MetricKey) => {
    const c = criteria.find((x) => x.metric === metric);
    const current = resolveMetricValue(stats, metric);
    if (!c) return { current, required: 0, pct: 100, met: true };
    return { current, required: c.value, pct: criterionPct(current, c), met: criterionMet(stats, c) };
  };
  return {
    calls: build('review_count'),
    rating: build('rating'),
    minutes: build('total_minutes'),
    earnings: build('total_earnings'),
  };
}

/**
 * Resolve the host's *displayed* current level from their stats. We trust the
 * stored `hosts.level` (set by the auto engine / admin override) when provided,
 * but never show below the level their stats have earned. Progress is then
 * computed against the next rung of the ladder.
 */
export function computeLevelProgress(
  stats: HostLevelStats,
  config: LevelDef[],
  storedLevel?: number | null,
): LevelProgress {
  const ladder = asLadder(config);

  const earned = evaluateLevel(stats, ladder);
  // Prefer the stored level when it is a valid rung; never show below earned.
  const stored = storedLevel && storedLevel >= 1 && storedLevel <= ladder.length ? storedLevel : earned;
  const levelNum = Math.max(stored, earned);

  const current = ladder.find((l) => l.level === levelNum) ?? ladder[0];
  const next = ladder.find((l) => l.level === levelNum + 1) ?? null;
  const is_max_level = next === null;

  if (!next) {
    const criteria = criteriaForLevel(current);
    return {
      level: levelNum,
      current,
      next: null,
      is_max_level: true,
      progress_pct: 100,
      requirements: {
        calls: { current: resolveMetricValue(stats, 'review_count'), required: current.min_calls, pct: 100, met: true },
        rating: { current: resolveMetricValue(stats, 'rating'), required: current.min_rating, pct: 100, met: true },
        minutes: { current: resolveMetricValue(stats, 'total_minutes'), required: current.min_minutes, pct: 100, met: true },
        earnings: { current: resolveMetricValue(stats, 'total_earnings'), required: current.min_earnings, pct: 100, met: true },
      },
      criteria: criteria.map((c) => {
        const def = METRIC_BY_KEY[c.metric];
        const cur = resolveMetricValue(stats, c.metric);
        return { metric: c.metric, label: def?.label ?? c.metric, kind: def?.kind ?? 'int', op: c.op, required: c.value, current: cur, pct: 100, met: true };
      }),
      perks: current.perks,
    };
  }

  const nextCriteria = criteriaForLevel(next);
  const criteriaProgress: CriterionProgress[] = nextCriteria.map((c) => {
    const def = METRIC_BY_KEY[c.metric];
    const cur = resolveMetricValue(stats, c.metric);
    return {
      metric: c.metric,
      label: def?.label ?? c.metric,
      kind: def?.kind ?? 'int',
      op: c.op,
      required: c.value,
      current: cur,
      pct: criterionPct(cur, c),
      met: criterionMet(stats, c),
    };
  });

  // Overall progress is gated by the slowest requirement — ALL must be met.
  const progress_pct = criteriaProgress.length
    ? Math.min(...criteriaProgress.map((c) => c.pct))
    : 100;

  return {
    level: levelNum,
    current,
    next,
    is_max_level,
    progress_pct,
    requirements: classicRequirements(stats, nextCriteria),
    criteria: criteriaProgress,
    perks: current.perks,
  };
}
