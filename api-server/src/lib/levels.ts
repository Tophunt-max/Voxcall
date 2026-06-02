// ============================================================================
// Host Level System — single source of truth
// ============================================================================
//
// Host levels start at 1 (the floor every new host begins at) and run up to
// the length of the admin-configured ladder. The thresholds, names, badges,
// colors, coin rewards and PERKS are configurable by admins and persisted as
// JSON in `app_settings.level_config`. Admins may add or remove rungs (within
// MIN_LEVELS..MAX_LEVELS) — see the admin panel and `normalizeLevelConfig`.
// This module centralizes:
//
//   • DEFAULT_LEVEL_CONFIG — the fallback ladder used when nothing is saved
//   • getLevelConfig(db)   — loads (and validates) the saved config or default
//   • evaluateLevel()      — the level a host has EARNED from their stats
//   • computeLevelProgress — current/next level + progress % for the UI
//   • perk helpers         — getLevelPerks / getEarningShare / getMaxRate
//
// The criteria a host must satisfy for a level (review_count >= min_calls AND
// rating >= min_rating) is intentionally identical to the metric used by the
// auto level-up engine (lib/levelService.ts) and the admin recalculation, so a
// host's displayed progress bar always predicts exactly when they'll be
// promoted. `min_calls` doubles as an anti-abuse sample-size guard — a host
// can't reach a high level off a single 5★ review.
// ============================================================================

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
  min_calls: number;
  min_rating: number;
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
 * Tied to the production coin economy (migration 0030): coins are bought at
 * ≈ ₹0.20/coin, so:
 *   DEFAULT_AUDIO_RATE 25 coins/min ≈ ₹5/min   (the standard voice-call price)
 *   DEFAULT_VIDEO_RATE 40 coins/min ≈ ₹8/min   (video priced higher)
 * A host can still change these within their level cap; these are only the
 * starting values seeded when no explicit rate was chosen.
 */
export const DEFAULT_AUDIO_RATE = 25;
export const DEFAULT_VIDEO_RATE = 40;
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

/**
 * Fallback ladder — the seed shipped before admins could add/remove rungs.
 *
 * Perk tiers are intentionally conservative so existing low-level hosts see NO
 * regression: level 1 keeps the historical 70% share, and the level-1 rate cap
 * (100) is far above what new hosts realistically charge. Higher levels earn a
 * larger share, may charge more, and rank higher — the tangible reward ladder.
 *
 * Admins may now grow this ladder (up to {@link MAX_LEVELS}); rungs above the
 * default length are seeded by {@link generateLevelDefault} when missing.
 */
export const DEFAULT_LEVEL_CONFIG: LevelDef[] = [
  { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0.0, coin_reward: 0,    description: 'New to the platform',  perks: { max_rate: 100, max_audio_rate: 100, max_video_rate: 100, random_audio_rate: 5,  random_video_rate: 8,  earning_share: 0.70, rank_boost: 0 } },
  { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, coin_reward: 100,  description: 'Getting established',   perks: { max_rate: 150, max_audio_rate: 150, max_video_rate: 150, random_audio_rate: 8,  random_video_rate: 12, earning_share: 0.70, rank_boost: 1 } },
  { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, coin_reward: 300,  description: 'Proven expertise',     perks: { max_rate: 250, max_audio_rate: 250, max_video_rate: 250, random_audio_rate: 12, random_video_rate: 18, earning_share: 0.72, rank_boost: 2 } },
  { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, coin_reward: 500,  description: 'Professional tier',    perks: { max_rate: 400, max_audio_rate: 400, max_video_rate: 400, random_audio_rate: 18, random_video_rate: 28, earning_share: 0.75, rank_boost: 3 } },
  { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, coin_reward: 1000, description: 'Top performer',        perks: { max_rate: 500, max_audio_rate: 500, max_video_rate: 500, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.80, rank_boost: 5 } },
];

/**
 * Build a sensible default LevelDef for a rung that has no entry in
 * {@link DEFAULT_LEVEL_CONFIG}. Used when admins extend the ladder past the
 * five seeded tiers and the saved/posted config omits some fields.
 *
 * The values scale linearly off the last seeded rung (level 5) so call/rating
 * thresholds, rewards and rate caps keep climbing — but everything is also
 * clamped to safe bounds (max_rating <= 5, max_rate <= ABSOLUTE_MAX_RATE).
 */
function generateLevelDefault(level: number): LevelDef {
  const base = DEFAULT_LEVEL_CONFIG[DEFAULT_LEVEL_CONFIG.length - 1];
  const overflow = Math.max(0, level - DEFAULT_LEVEL_CONFIG.length);
  // Ascending thresholds — never below the last default rung.
  const min_calls = base.min_calls + overflow * 1000;
  // Cap min_rating at 5.0 — the score is a 1-5 scale, asking for >5 stars
  // would make the rung permanently unreachable.
  const min_rating = Math.min(5, base.min_rating + overflow * 0.05);
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

/**
 * Normalize an arbitrary saved/posted config into a strict ascending ladder
 * of {@link MIN_LEVELS}..{@link MAX_LEVELS} entries. `level` is always
 * renumbered to match position (1..N) so admin-side reorders or deletions
 * never produce gaps. Missing/invalid fields fall back to the seeded default
 * for that slot — or a generated default for slots above the seeded length —
 * so a partially corrupted row can never crash a read path. Perks are
 * backfilled from the defaults when older saved configs predate the perks
 * field.
 *
 * Inputs that are not arrays, are empty, or exceed {@link MAX_LEVELS} fall
 * back to the full {@link DEFAULT_LEVEL_CONFIG}.
 */
export function normalizeLevelConfig(input: unknown): LevelDef[] {
  if (!Array.isArray(input)) return DEFAULT_LEVEL_CONFIG;
  if (input.length < MIN_LEVELS || input.length > MAX_LEVELS) return DEFAULT_LEVEL_CONFIG;
  return input.map((l: any, i: number) => {
    const fallback = fallbackForSlot(i);
    return {
      // Always renumber sequentially so add/remove operations on the admin
      // side don't leak gaps or duplicates into stored data.
      level: i + 1,
      name: String(l?.name || fallback.name),
      badge: String(l?.badge || fallback.badge),
      color: String(l?.color || fallback.color),
      min_calls: Math.max(0, parseInt(String(l?.min_calls)) || 0),
      min_rating: Math.min(5, Math.max(0, parseFloat(String(l?.min_rating)) || 0)),
      coin_reward: Math.max(0, parseInt(String(l?.coin_reward)) || 0),
      description: String(l?.description ?? ''),
      perks: normalizePerks(l?.perks, fallback.perks),
    };
  });
}

/** Load the saved level config from app_settings, or the default ladder. */
export async function getLevelConfig(d: D1Database): Promise<LevelDef[]> {
  try {
    const row = await d.prepare("SELECT value FROM app_settings WHERE key = 'level_config'").first<any>();
    if (row?.value) return normalizeLevelConfig(JSON.parse(row.value));
  } catch (err) {
    console.error('[getLevelConfig] Error fetching or parsing level_config:', err);
  }
  return DEFAULT_LEVEL_CONFIG;
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
}

/**
 * The level a host has EARNED purely from their stats — the highest rung whose
 * thresholds (min_calls + min_rating) are both satisfied. Level 1 is the floor.
 * This is the authoritative promotion check used by the auto level-up engine.
 */
export function evaluateLevel(stats: HostLevelStats, config: LevelDef[]): number {
  const ladder = asLadder(config);
  const calls = Math.max(0, Number(stats.review_count) || 0);
  const rating = Math.max(0, Number(stats.rating) || 0);
  let earned = 1;
  for (const lvl of ladder) {
    if (lvl.level === 1) continue;
    if (calls >= lvl.min_calls && rating >= lvl.min_rating) earned = lvl.level;
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
  const fallback = (DEFAULT_LEVEL_CONFIG[Math.max(0, Math.min(DEFAULT_LEVEL_CONFIG.length - 1, level - 1))]?.perks.random_audio_rate) ?? 5;
  return perks.random_audio_rate ?? fallback;
}

/** Same as {@link getRandomAudioRate} but for video random calls. */
export function getRandomVideoRate(level: number, config: LevelDef[]): number {
  const perks = getLevelPerks(level, config);
  const fallback = (DEFAULT_LEVEL_CONFIG[Math.max(0, Math.min(DEFAULT_LEVEL_CONFIG.length - 1, level - 1))]?.perks.random_video_rate) ?? 8;
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

export interface LevelProgress {
  /** The host's current level number (1–5). */
  level: number;
  /** Config entry for the current level. */
  current: LevelDef;
  /** Config entry for the next level, or null when already at max. */
  next: LevelDef | null;
  /** True when the host is at the top of the ladder. */
  is_max_level: boolean;
  /** 0–100 progress towards the next level (min of calls% and rating%). */
  progress_pct: number;
  /** Per-requirement breakdown towards the next level. */
  requirements: {
    calls: { current: number; required: number; pct: number; met: boolean };
    rating: { current: number; required: number; pct: number; met: boolean };
  };
  /** Perks unlocked at the current level. */
  perks: LevelPerks;
}

function clampPct(n: number): number {
  if (!isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
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

  const calls = Math.max(0, Number(stats.review_count) || 0);
  const rating = Math.max(0, Number(stats.rating) || 0);

  const earned = evaluateLevel(stats, ladder);
  // Prefer the stored level when it is a valid rung; never show below earned.
  const stored = storedLevel && storedLevel >= 1 && storedLevel <= ladder.length ? storedLevel : earned;
  const levelNum = Math.max(stored, earned);

  const current = ladder.find((l) => l.level === levelNum) ?? ladder[0];
  const next = ladder.find((l) => l.level === levelNum + 1) ?? null;
  const is_max_level = next === null;

  if (!next) {
    return {
      level: levelNum,
      current,
      next: null,
      is_max_level: true,
      progress_pct: 100,
      requirements: {
        calls: { current: calls, required: current.min_calls, pct: 100, met: true },
        rating: { current: rating, required: current.min_rating, pct: 100, met: true },
      },
      perks: current.perks,
    };
  }

  const callsPct = next.min_calls > 0 ? clampPct((calls / next.min_calls) * 100) : 100;
  const ratingPct = next.min_rating > 0 ? clampPct((rating / next.min_rating) * 100) : 100;
  // Overall progress is gated by the slowest requirement — both must be met.
  const progress_pct = Math.min(callsPct, ratingPct);

  return {
    level: levelNum,
    current,
    next,
    is_max_level,
    progress_pct,
    requirements: {
      calls: { current: calls, required: next.min_calls, pct: callsPct, met: calls >= next.min_calls },
      rating: { current: rating, required: next.min_rating, pct: ratingPct, met: rating >= next.min_rating },
    },
    perks: current.perks,
  };
}
