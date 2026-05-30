// ============================================================================
// Host Level System — single source of truth
// ============================================================================
//
// Host levels (1–5) are stored in `hosts.level`. The thresholds, names, badges,
// colors, coin rewards and PERKS are configurable by admins and persisted as
// JSON in `app_settings.level_config`. This module centralizes:
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
  /** Max coins/min a host at this level may charge (rate cap). */
  max_rate: number;
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
 * Fallback ladder — must always be exactly 5 entries (level 1..5).
 *
 * Perk tiers are intentionally conservative so existing low-level hosts see NO
 * regression: level 1 keeps the historical 70% share, and the level-1 rate cap
 * (100) is far above what new hosts realistically charge. Higher levels earn a
 * larger share, may charge more, and rank higher — the tangible reward ladder.
 */
export const DEFAULT_LEVEL_CONFIG: LevelDef[] = [
  { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0.0, coin_reward: 0,    description: 'New to the platform',  perks: { max_rate: 100, earning_share: 0.70, rank_boost: 0 } },
  { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, coin_reward: 100,  description: 'Getting established',   perks: { max_rate: 150, earning_share: 0.70, rank_boost: 1 } },
  { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, coin_reward: 300,  description: 'Proven expertise',     perks: { max_rate: 250, earning_share: 0.72, rank_boost: 2 } },
  { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, coin_reward: 500,  description: 'Professional tier',    perks: { max_rate: 400, earning_share: 0.75, rank_boost: 3 } },
  { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, coin_reward: 1000, description: 'Top performer',        perks: { max_rate: 500, earning_share: 0.80, rank_boost: 5 } },
];

function normalizePerks(input: any, fallback: LevelPerks): LevelPerks {
  const p = input ?? {};
  const max_rate = Math.min(ABSOLUTE_MAX_RATE, Math.max(1, parseInt(String(p.max_rate)) || fallback.max_rate));
  // earning_share clamped to a sane 0.1–0.95 band; platform always keeps ≥5%.
  let share = parseFloat(String(p.earning_share));
  if (!isFinite(share) || share <= 0) share = fallback.earning_share;
  const earning_share = Math.min(0.95, Math.max(0.1, share));
  const rank_boost = Math.max(0, parseInt(String(p.rank_boost)) || fallback.rank_boost);
  return { max_rate, earning_share, rank_boost };
}

/**
 * Normalize an arbitrary saved/posted config into a strict 5-entry ladder.
 * Missing/invalid fields fall back to the default for that slot so a partially
 * corrupted row can never crash a read path. Perks are backfilled from the
 * defaults when older saved configs predate the perks field.
 */
export function normalizeLevelConfig(input: unknown): LevelDef[] {
  if (!Array.isArray(input) || input.length !== 5) return DEFAULT_LEVEL_CONFIG;
  return input.map((l: any, i: number) => ({
    level: i + 1,
    name: String(l?.name || DEFAULT_LEVEL_CONFIG[i].name),
    badge: String(l?.badge || DEFAULT_LEVEL_CONFIG[i].badge),
    color: String(l?.color || DEFAULT_LEVEL_CONFIG[i].color),
    min_calls: Math.max(0, parseInt(String(l?.min_calls)) || 0),
    min_rating: Math.min(5, Math.max(0, parseFloat(String(l?.min_rating)) || 0)),
    coin_reward: Math.max(0, parseInt(String(l?.coin_reward)) || 0),
    description: String(l?.description ?? ''),
    perks: normalizePerks(l?.perks, DEFAULT_LEVEL_CONFIG[i].perks),
  }));
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

/** Sort + sanity-check a config into an ascending 5-rung ladder. */
function asLadder(config: LevelDef[]): LevelDef[] {
  return (config && config.length === 5 ? config : DEFAULT_LEVEL_CONFIG)
    .slice()
    .sort((a, b) => a.level - b.level);
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

/** Max coins/min a host at this level may charge. */
export function getMaxRate(level: number, config: LevelDef[]): number {
  return getLevelPerks(level, config).max_rate;
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
  const lvl = level && level >= 1 && level <= 5 ? level : 1;
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
  const stored = storedLevel && storedLevel >= 1 && storedLevel <= 5 ? storedLevel : earned;
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
