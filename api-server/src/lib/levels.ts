// ============================================================================
// Host Level System — single source of truth
// ============================================================================
//
// Host levels (1–5) are stored in `hosts.level`. The thresholds, names, badges,
// colors and coin rewards are configurable by admins and persisted as JSON in
// `app_settings.level_config`. This module centralizes:
//
//   • DEFAULT_LEVEL_CONFIG — the fallback ladder used when nothing is saved
//   • getLevelConfig(db)   — loads (and validates) the saved config or default
//   • computeLevelProgress — derives a host's current/next level + progress %,
//                            using the SAME metric the admin recalculation uses
//                            (review_count vs min_calls, rating vs min_rating)
//
// Both the admin routes (config + recalculation) and the host-facing
// "my level" endpoint import from here so the two can never drift apart.
// ============================================================================

export interface LevelDef {
  level: number;
  name: string;
  badge: string;
  color: string;
  min_calls: number;
  min_rating: number;
  coin_reward: number;
  description: string;
}

/** Fallback ladder — must always be exactly 5 entries (level 1..5). */
export const DEFAULT_LEVEL_CONFIG: LevelDef[] = [
  { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0.0, coin_reward: 0,    description: 'New to the platform' },
  { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, coin_reward: 100,  description: 'Getting established' },
  { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, coin_reward: 300,  description: 'Proven expertise' },
  { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, coin_reward: 500,  description: 'Professional tier' },
  { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, coin_reward: 1000, description: 'Top performer' },
];

/**
 * Normalize an arbitrary saved/posted config into a strict 5-entry ladder.
 * Missing/invalid fields fall back to the default for that slot so a partially
 * corrupted row can never crash a read path.
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

export interface HostLevelStats {
  /** Number of rated calls — matches the metric used by recalculate-levels. */
  review_count: number;
  /** Average host rating (0–5). */
  rating: number;
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
}

function clampPct(n: number): number {
  if (!isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

/**
 * Resolve the host's *displayed* current level from their stats. We trust the
 * stored `hosts.level` (set by the admin recalculation / manual override) when
 * provided, otherwise we derive the highest level whose thresholds are met.
 * Progress is then computed against the next rung of the ladder.
 */
export function computeLevelProgress(
  stats: HostLevelStats,
  config: LevelDef[],
  storedLevel?: number | null,
): LevelProgress {
  const ladder = (config && config.length === 5 ? config : DEFAULT_LEVEL_CONFIG)
    .slice()
    .sort((a, b) => a.level - b.level);

  const calls = Math.max(0, Number(stats.review_count) || 0);
  const rating = Math.max(0, Number(stats.rating) || 0);

  // Derive the level earned purely from thresholds (highest level satisfied).
  let earned = 1;
  for (const lvl of ladder) {
    if (lvl.level === 1) continue;
    if (calls >= lvl.min_calls && rating >= lvl.min_rating) earned = lvl.level;
  }

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
  };
}
