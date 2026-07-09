// ============================================================================
// Random matchmaker — POST /api/match/find + GET /api/match/online-hosts
// ============================================================================
//
// The user app's "Random Match" screen calls /match/find every couple of
// seconds while the user is searching. This module is therefore on a HOT
// path and has to deal with several layered concerns:
//
//   • Per-user rate limiting (1 RPS burst 5) so a stuck client can't DoS us.
//   • Coin balance pre-check so we never hand the user a host they can't
//     afford to call.
//   • Server-side filters (gender, languages, min_rating, audio/video
//     capability) so the user actually gets the kind of host they asked for.
//   • Host opt-in respect (`hosts.accepts_random_calls`) and video-capable
//     filter (`hosts.allows_video`) so hosts can stay online for direct
//     calls without being randomly assigned.
//   • No-repeat exclusion via `random_match_history` so the same caller +
//     host pair can't keep getting matched within a short window.
//   • Daily cap + post-decline cooldown (admin-tuned via app_settings) so
//     no one user can spam matchmaking or grief hosts with serial declines.
//   • Per-level random rates from the configured ladder (`level_config`),
//     with a global app_settings fallback so old configs keep working.
//   • COUNT/SELECT race tolerance — the host pool can change between the
//     count and the offset SELECT; we retry up to a small bound before
//     surfacing "no host available".
//
// Every error path returns a stable English `code` so the client can
// localize the message without parsing strings.
// ============================================================================

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import {
  getLevelConfig,
  buildLevelInfo,
  rankBoostCaseSql,
  getRandomAudioRate,
  getRandomVideoRate,
  getRankBoost,
  DEFAULT_AUDIO_RATE,
  DEFAULT_VIDEO_RATE,
  type LevelDef,
} from '../lib/levels';
import { checkRateLimit } from '../lib/rateLimit';
import { isWithinAvailability } from '../lib/availability';
import {
  computeMatchWeight,
  weightedSample,
  normalizeMatchWeights,
  type MatchWeights,
} from '../lib/matchWeight';
import type { Env, JWTPayload } from '../types';

const match = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
match.use('*', authMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function enrichHost(h: any, config: LevelDef[]) {
  return {
    ...h,
    specialties: safeJson(h.specialties, []),
    languages: safeJson(h.languages, []),
    level: h.level ?? 1,
    level_info: buildLevelInfo(config, h.level ?? 1),
    audio_coins_per_minute: h.audio_coins_per_minute ?? h.coins_per_minute ?? DEFAULT_AUDIO_RATE,
    video_coins_per_minute: h.video_coins_per_minute ?? (h.coins_per_minute ? h.coins_per_minute + 5 : DEFAULT_VIDEO_RATE),
  };
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/**
 * Read a positive integer setting from `app_settings`, falling back when the
 * row is missing or the stored value is malformed. Used for the random-call
 * anti-abuse knobs (daily cap, decline cooldown, no-repeat window) so an
 * un-configured deployment behaves like the historical "no limits" build.
 */
async function readIntSetting(
  db: D1Database,
  key: string,
  fallback: number,
): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    const n = parseInt(row?.value ?? '');
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read a boolean feature flag from `app_settings`. Any value other than the
 * string '0' counts as enabled; a missing row falls back to `fallbackEnabled`.
 */
async function readBoolSetting(
  db: D1Database,
  key: string,
  fallbackEnabled: boolean,
): Promise<boolean> {
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    if (row?.value == null) return fallbackEnabled;
    return row.value !== '0';
  } catch {
    return fallbackEnabled;
  }
}

/**
 * Resolve the random per-minute rate for a host based on their level. Honours
 * the per-level `random_audio_rate` / `random_video_rate` set by the admin
 * in Level System Configuration, falling back to the global
 * `random_call_audio_rate` / `random_call_video_rate` settings (and finally
 * to the standard DEFAULT_AUDIO_RATE / DEFAULT_VIDEO_RATE, 25 / 40) for older
 * configs / fresh deploys — so random calls are billed at the SAME advertised
 * rate as direct calls unless an admin explicitly sets a different one.
 */
async function resolveRandomRate(
  db: D1Database,
  hostLevel: number,
  callType: 'audio' | 'video',
  config: LevelDef[],
): Promise<number> {
  const fromLadder = callType === 'video'
    ? getRandomVideoRate(hostLevel, config)
    : getRandomAudioRate(hostLevel, config);
  if (Number.isFinite(fromLadder) && fromLadder > 0) return fromLadder;
  const fallbackKey = callType === 'video' ? 'random_call_video_rate' : 'random_call_audio_rate';
  return readIntSetting(db, fallbackKey, callType === 'video' ? DEFAULT_VIDEO_RATE : DEFAULT_AUDIO_RATE);
}

// ─── Rate limit (1 RPS, burst 5) ────────────────────────────────────────────
async function rateLimitMatchFind(
  db: D1Database,
  userId: string,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  // 5 hits/sec window — enough for the client's 2.5s polling cadence to
  // burst a little, far below the threshold a manual abuser would need to
  // be effective.
  const key = `rl:match-find:${userId}:${Math.floor(Date.now() / 1000)}`;
  const r = await checkRateLimit(db, key, 5, 1);
  return r.limited ? { ok: false, retryAfterSec: r.retryAfterSec } : { ok: true };
}

// ─── Daily cap + decline cooldown ───────────────────────────────────────────

interface AbuseCheckResult {
  ok: boolean;
  code?: 'DAILY_LIMIT_REACHED' | 'DECLINE_COOLDOWN';
  retryAfterSec?: number;
  meta?: Record<string, number>;
}

async function checkAbuseGuards(
  db: D1Database,
  userId: string,
): Promise<AbuseCheckResult> {
  try {
    const [dailyLimit, cooldownCount, cooldownMin] = await Promise.all([
      readIntSetting(db, 'random_calls_per_day_limit', 0),
      readIntSetting(db, 'random_decline_cooldown_count', 0),
      readIntSetting(db, 'random_decline_cooldown_min', 5),
    ]);

    // Daily cap — count successful matches (matched/accepted) in the last 24h.
    if (dailyLimit > 0) {
      const since = Math.floor(Date.now() / 1000) - 24 * 3600;
      const row = await db
        .prepare(
          `SELECT COUNT(*) as cnt FROM random_match_history
           WHERE user_id = ? AND outcome IN ('matched','accepted') AND created_at >= ?`,
        )
        .bind(userId, since)
        .first<{ cnt: number }>();
      if ((row?.cnt ?? 0) >= dailyLimit) {
        return {
          ok: false,
          code: 'DAILY_LIMIT_REACHED',
          meta: { daily_limit: dailyLimit, used: row?.cnt ?? 0 },
        };
      }
    }

    // Decline cooldown — if the user's last N entries are all declined/timeout
    // AND the most recent one is within `cooldownMin` minutes, block.
    if (cooldownCount > 0) {
      const recent = await db
        .prepare(
          `SELECT outcome, created_at FROM random_match_history
           WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(userId, cooldownCount)
        .all<{ outcome: string; created_at: number }>();
      const rows = recent.results ?? [];
      if (
        rows.length >= cooldownCount &&
        rows.every((r) => r.outcome === 'declined' || r.outcome === 'timeout')
      ) {
        const lastAt = rows[0].created_at;
        const cooldownEnd = lastAt + cooldownMin * 60;
        const now = Math.floor(Date.now() / 1000);
        if (now < cooldownEnd) {
          return {
            ok: false,
            code: 'DECLINE_COOLDOWN',
            retryAfterSec: cooldownEnd - now,
            meta: { cooldown_min: cooldownMin, threshold: cooldownCount },
          };
        }
      }
    }

    return { ok: true };
  } catch (err) {
    // Schema not yet healed (migration 0026) or transient D1 issue — fail
    // open. The anti-abuse guards are a polish feature, not a hard
    // requirement, so a brief healer race window must not break matching.
    console.warn('[match] checkAbuseGuards failed, allowing through:', err);
    return { ok: true };
  }
}

// ─── Host pool query ────────────────────────────────────────────────────────

interface MatchFilters {
  callType: 'audio' | 'video';
  gender?: 'male' | 'female';
  languages?: string[];
  minRating?: number;
  /** Hosts already matched in the recent no-repeat window — to be excluded. */
  excludeHostIds: string[];
}

/**
 * Build the base WHERE for the random pool. `accepts_random_calls = 1` and
 * `allows_video = 1 (if video)` are handled with COALESCE so existing rows
 * (where these columns are NULL) stay in the pool — preserving historical
 * behaviour after the migration runs.
 */
function buildPoolFilter(
  callerId: string,
  filters: MatchFilters,
  /**
   * When true the WHERE drops the migration-0026 columns (`accepts_random_calls`,
   * `allows_video`). pickRandomHost calls back into this on a "no such column"
   * error so a worker that hit production seconds before the schema heal
   * landed still hands out random matches.
   */
  legacyMode = false,
): { where: string; params: any[] } {
  const where: string[] = [
    'h.is_active = 1',
    'h.is_online = 1',
    'h.user_id != ?',
  ];
  const params: any[] = [callerId];

  if (!legacyMode) {
    // accepts_random_calls is added by migration 0026 with DEFAULT 1.
    // COALESCE makes the filter safe even if the migration hasn't run yet.
    where.push('COALESCE(h.accepts_random_calls, 1) = 1');
  }

  if (!legacyMode && filters.callType === 'video') {
    where.push('COALESCE(h.allows_video, 1) = 1');
  }
  if (filters.gender === 'male' || filters.gender === 'female') {
    where.push('LOWER(u.gender) = ?');
    params.push(filters.gender);
  }
  if (Number.isFinite(filters.minRating ?? NaN) && (filters.minRating ?? 0) > 0) {
    where.push('h.rating >= ?');
    params.push(filters.minRating);
  }
  if (filters.languages && filters.languages.length > 0) {
    // Languages are stored as JSON-encoded TEXT — use LIKE on each candidate
    // language. SQLite has no JSON1 functions guaranteed across D1 versions,
    // so this is the portable approach.
    const ors = filters.languages
      .slice(0, 5) // hard cap to bound the OR list length
      .map(() => 'h.languages LIKE ?');
    where.push(`(${ors.join(' OR ')})`);
    for (const lang of filters.languages.slice(0, 5)) {
      const safe = String(lang).replace(/[%_\\]/g, '').slice(0, 30);
      params.push(`%"${safe}"%`);
    }
  }
  if (filters.excludeHostIds.length > 0) {
    const placeholders = filters.excludeHostIds.map(() => '?').join(',');
    where.push(`h.id NOT IN (${placeholders})`);
    params.push(...filters.excludeHostIds);
  }

  return { where: where.join(' AND '), params };
}

/**
 * Pick a random host from the filtered pool. Uses COUNT-then-OFFSET (much
 * cheaper than ORDER BY RANDOM()) with a small retry loop to swallow the
 * race where a host goes offline between the COUNT and the SELECT.
 *
 * Falls back to a "legacy" filter (drops the migration 0026 columns) if the
 * primary query throws "no such column" — keeps random matching alive while
 * the schema healer races to add them.
 */
async function pickRandomHost(
  db: D1Database,
  filter: { where: string; params: any[] },
  legacyFallback: () => { where: string; params: any[] },
): Promise<{ host: any | null; totalOnline: number }> {
  const runWith = async (f: { where: string; params: any[] }) => {
    const countRow = await db
      .prepare(`SELECT COUNT(*) as cnt FROM hosts h JOIN users u ON u.id = h.user_id WHERE ${f.where}`)
      .bind(...f.params)
      .first<{ cnt: number }>();
    const totalOnline = countRow?.cnt ?? 0;
    if (totalOnline === 0) return { host: null, totalOnline: 0 };
    // 3 attempts is enough to absorb a couple of concurrent presence flips
    // without spending too long on this hot endpoint.
    for (let attempt = 0; attempt < 3; attempt++) {
      const offset = Math.floor(Math.random() * totalOnline);
      const host = await db
        .prepare(
          `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio
           FROM hosts h JOIN users u ON u.id = h.user_id
           WHERE ${f.where}
           LIMIT 1 OFFSET ?`,
        )
        .bind(...f.params, offset)
        .first<any>();
      // Skip hosts currently outside their availability window. The host row
      // is `h.*` so it carries the schedule columns when they exist; when they
      // don't, isWithinAvailability defaults to "available" (safe no-op).
      if (host && !isWithinAvailability(host)) continue;
      if (host) return { host, totalOnline };
    }
    return { host: null, totalOnline };
  };

  try {
    return await runWith(filter);
  } catch (err) {
    const msg = String((err as any)?.message || err);
    // SQLite "no such column" / "no such table" — schema not yet healed.
    // Try the legacy filter (no opt-in/video columns) once before bailing.
    if (/no such (column|table)/i.test(msg)) {
      console.warn('[match] pool query failed on missing schema, falling back:', msg);
      try {
        return await runWith(legacyFallback());
      } catch (legacyErr) {
        console.warn('[match] legacy pool query also failed:', legacyErr);
        return { host: null, totalOnline: 0 };
      }
    }
    throw err;
  }
}

// Recent demand window (minutes) for the demand-balancing penalty. Hosts who
// were matched a lot inside this window get a dampened selection weight so
// demand spreads across the roster instead of piling onto a few hosts.
const MATCH_DEMAND_WINDOW_MIN = 60;

/**
 * Quality-weighted host pick (Priority 3). Fetches a bounded random candidate
 * window from the filtered pool, computes a selection weight per host
 * (quality + freshness − recent-demand), and samples one. Falls back to the
 * legacy filter on a missing-schema error, same as pickRandomHost.
 *
 * Returns `totalOnline` = the full filtered count (for the UI's
 * filtered_count), independent of the bounded candidate window.
 */
async function pickWeightedHost(
  db: D1Database,
  filter: { where: string; params: any[] },
  legacyFallback: () => { where: string; params: any[] },
  config: LevelDef[],
  weights: MatchWeights,
): Promise<{ host: any | null; totalOnline: number }> {
  const now = Math.floor(Date.now() / 1000);
  const maxRankBoost = Math.max(1, ...config.map((l) => getRankBoost(l.level, config)));

  const runWith = async (f: { where: string; params: any[] }) => {
    const countRow = await db
      .prepare(`SELECT COUNT(*) as cnt FROM hosts h JOIN users u ON u.id = h.user_id WHERE ${f.where}`)
      .bind(...f.params)
      .first<{ cnt: number }>();
    const totalOnline = countRow?.cnt ?? 0;
    if (totalOnline === 0) return { host: null, totalOnline: 0 };

    // Bounded random candidate window. ORDER BY RANDOM() is fine here because
    // the *online + filtered* pool is small relative to the whole hosts table.
    const poolSize = Math.min(40, totalOnline);
    const pool = await db
      .prepare(
        `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio
         FROM hosts h JOIN users u ON u.id = h.user_id
         WHERE ${f.where}
         ORDER BY RANDOM() LIMIT ?`,
      )
      .bind(...f.params, poolSize)
      .all<any>();
    // Drop hosts outside their availability window before weighting. Safe
    // no-op when the schedule columns are absent (defaults to "available").
    const rows = (pool.results ?? []).filter((r) => isWithinAvailability(r));
    if (!rows.length) return { host: null, totalOnline };

    // Recent-match counts for demand balancing — best-effort.
    const recentByHost = new Map<string, number>();
    try {
      const ids = rows.map((r) => r.id);
      const ph = ids.map(() => '?').join(',');
      const since = now - MATCH_DEMAND_WINDOW_MIN * 60;
      const rc = await db
        .prepare(
          `SELECT host_id, COUNT(*) as cnt FROM random_match_history
           WHERE created_at >= ? AND host_id IN (${ph}) GROUP BY host_id`,
        )
        .bind(since, ...ids)
        .all<{ host_id: string; cnt: number }>();
      for (const r of rc.results ?? []) recentByHost.set(r.host_id, Number(r.cnt) || 0);
    } catch (err) {
      console.warn('[match] demand-window query failed (non-fatal):', err);
    }

    const picked = weightedSample(
      rows,
      (r) =>
        computeMatchWeight(
          {
            rating: Number(r.rating) || 0,
            review_count: Number(r.review_count) || 0,
            created_at: Number(r.created_at) || 0,
            rank_boost_norm: getRankBoost(r.level ?? 1, config) / maxRankBoost,
            recent_matches: recentByHost.get(r.id) ?? 0,
          },
          weights,
          { now },
        ),
      Math.random,
    );
    return { host: picked ?? rows[0], totalOnline };
  };

  try {
    return await runWith(filter);
  } catch (err) {
    const msg = String((err as any)?.message || err);
    if (/no such (column|table)/i.test(msg)) {
      console.warn('[match] weighted pool query failed on missing schema, falling back:', msg);
      try {
        return await runWith(legacyFallback());
      } catch (legacyErr) {
        console.warn('[match] legacy weighted pool query also failed:', legacyErr);
        return { host: null, totalOnline: 0 };
      }
    }
    throw err;
  }
}

/**
 * Hosts the caller has matched with within the no-repeat window — passed
 * into the pool filter as a NOT IN clause. Capped to a sensible list
 * length so the IN list never explodes.
 */
async function recentlyMatchedHostIds(
  db: D1Database,
  userId: string,
  blockMinutes: number,
): Promise<string[]> {
  if (blockMinutes <= 0) return [];
  const since = Math.floor(Date.now() / 1000) - blockMinutes * 60;
  try {
    const rows = await db
      .prepare(
        `SELECT DISTINCT host_id FROM random_match_history
         WHERE user_id = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(userId, since)
      .all<{ host_id: string }>();
    return (rows.results ?? []).map((r) => r.host_id);
  } catch (err) {
    // Schema not yet healed (migration 0026) or transient D1 hiccup —
    // fall back to "no exclusions" so matching still works.
    console.warn('[match] recentlyMatchedHostIds failed, falling back to empty list:', err);
    return [];
  }
}

// ─── POST /api/match/find ───────────────────────────────────────────────────

match.post('/find', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  // 1. Rate limit
  const rl = await rateLimitMatchFind(db, sub);
  if (!rl.ok) {
    return c.json(
      { matched: false, code: 'RATE_LIMITED', retry_after_sec: rl.retryAfterSec },
      429,
    );
  }

  // 2. Parse + sanitize body
  const body = await c.req.json<{
    call_type?: string;
    gender?: string;
    languages?: string[];
    min_rating?: number;
    exclude_host_id?: string;
  }>().catch(() => ({} as any));
  const callType: 'audio' | 'video' = body.call_type === 'video' ? 'video' : 'audio';
  const gender = body.gender === 'male' || body.gender === 'female' ? body.gender : undefined;
  const languages = Array.isArray(body.languages)
    ? (body.languages as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 5)
    : undefined;
  const minRating =
    typeof body.min_rating === 'number' && body.min_rating > 0
      ? Math.min(5, body.min_rating)
      : undefined;

  // 3. Anti-abuse guards (daily cap + decline cooldown)
  const abuse = await checkAbuseGuards(db, sub);
  if (!abuse.ok) {
    return c.json(
      {
        matched: false,
        code: abuse.code,
        retry_after_sec: abuse.retryAfterSec,
        ...abuse.meta,
      },
      429,
    );
  }

  // 4. Coin balance pre-check
  const caller = await db
    .prepare('SELECT coins FROM users WHERE id = ?')
    .bind(sub)
    .first<{ coins: number }>();
  const callerCoins = Number(caller?.coins) || 0;
  // We require at least the level-1 random rate × 2 minutes — enough to
  // cover the fast-disconnect grace + a bit of buffer. Per-level rate may
  // be higher; the actual call route will re-check at /call/start time.
  const minNeeded = (callType === 'video' ? 8 : 5) * 2;
  if (callerCoins < minNeeded) {
    return c.json(
      {
        matched: false,
        code: 'INSUFFICIENT_COINS',
        coins: callerCoins,
        min_needed: minNeeded,
      },
      402,
    );
  }

  // 5. Build pool filter. The hard no-repeat exclusion is OFF by default
  //    (`random_match_repeat_block_min` = 0) so the SAME host can be matched
  //    again — important for small rosters where blocking a just-matched host
  //    for 30 min would leave the user with "no hosts available". Demand is
  //    still spread softly via the weighted-pick recent-match penalty
  //    (MATCH_DEMAND_WINDOW_MIN), and admins can re-enable a hard block by
  //    setting the app_setting to a positive number of minutes.
  const repeatBlockMin = await readIntSetting(db, 'random_match_repeat_block_min', 0);
  const excludeHostIds = await recentlyMatchedHostIds(db, sub, repeatBlockMin);

  // Also exclude hosts who have blocked this caller (migration 0036).
  try {
    const blockedRows = await db
      .prepare('SELECT blocker_id FROM user_blocks WHERE blocked_id = ? LIMIT 50')
      .bind(sub)
      .all<{ blocker_id: string }>();
    if (blockedRows.results?.length) {
      // Map blocker user_ids to host_ids
      const blockerIds = blockedRows.results.map(r => r.blocker_id);
      const ph = blockerIds.map(() => '?').join(',');
      const hostRows = await db
        .prepare(`SELECT id FROM hosts WHERE user_id IN (${ph})`)
        .bind(...blockerIds)
        .all<{ id: string }>();
      for (const h of (hostRows.results ?? [])) {
        if (!excludeHostIds.includes(h.id)) excludeHostIds.push(h.id);
      }
    }
  } catch (e: any) {
    if (!/no such table/i.test(String(e?.message || ''))) {
      console.warn('[match/find] block exclusion failed:', e);
    }
  }

  // Random auto-dialer: the caller can ask to skip a specific host (the one
  // that just didn't answer / was skipped) so we don't immediately re-ring
  // them. Added to the exclusion set here; the pick below falls back to
  // ignoring it when it's the only online host, so a solo host stays reachable.
  const excludeHostId = typeof body.exclude_host_id === 'string' && body.exclude_host_id
    ? body.exclude_host_id
    : undefined;
  if (excludeHostId && !excludeHostIds.includes(excludeHostId)) excludeHostIds.push(excludeHostId);

  const filters: MatchFilters = {
    callType,
    gender,
    languages,
    minRating,
    excludeHostIds,
  };
  const filter = buildPoolFilter(sub, filters);

  // 6. Resolve discovery strategy + pick a host. Quality-weighted selection
  //    (Priority 3) is the default; admins can revert to uniform random via
  //    `match_weighting_enabled = 0`. Weights live in `match_weights` (JSON)
  //    and fall back to DEFAULT_MATCH_WEIGHTS when missing/malformed.
  //    We ALSO want a count for the UI, so report the size of the un-filtered
  //    online pool separately. Every query is wrapped so a missing
  //    migration-0026 column never crashes the route.
  const [levelCfg, weightingEnabled, matchWeightsRaw] = await Promise.all([
    getLevelConfig(db),
    readBoolSetting(db, 'match_weighting_enabled', true),
    (async () => {
      try {
        const row = await db
          .prepare("SELECT value FROM app_settings WHERE key = 'match_weights'")
          .first<{ value: string }>();
        return row?.value ?? null;
      } catch {
        return null;
      }
    })(),
  ]);
  let matchWeights: MatchWeights;
  try {
    matchWeights = normalizeMatchWeights(matchWeightsRaw ? JSON.parse(matchWeightsRaw) : undefined);
  } catch {
    matchWeights = normalizeMatchWeights(undefined);
  }

  // Kick off the online-count query concurrently with the host pick.
  const onlineCountPromise = (async () => {
    try {
      return await db
        .prepare(
          `SELECT COUNT(*) as cnt FROM hosts h JOIN users u ON u.id = h.user_id
           WHERE h.is_active = 1 AND h.is_online = 1 AND h.user_id != ?
             AND COALESCE(h.accepts_random_calls, 1) = 1`,
        )
        .bind(sub)
        .first<{ cnt: number }>();
    } catch {
      // Fall back without the new column for the brief healer race window.
      return await db
        .prepare(
          `SELECT COUNT(*) as cnt FROM hosts h JOIN users u ON u.id = h.user_id
           WHERE h.is_active = 1 AND h.is_online = 1 AND h.user_id != ?`,
        )
        .bind(sub)
        .first<{ cnt: number }>()
        .catch(() => null);
    }
  })();

  let pick = weightingEnabled
    ? await pickWeightedHost(db, filter, () => buildPoolFilter(sub, filters, true), levelCfg, matchWeights)
    : await pickRandomHost(db, filter, () => buildPoolFilter(sub, filters, true));

  // Fallback: if the caller's skip-host exclusion emptied the pool (that host
  // was the only one online), retry without it so a solo host stays reachable.
  if (!pick.host && excludeHostId) {
    const relaxed: MatchFilters = {
      ...filters,
      excludeHostIds: filters.excludeHostIds.filter((id) => id !== excludeHostId),
    };
    const relaxedFilter = buildPoolFilter(sub, relaxed);
    pick = weightingEnabled
      ? await pickWeightedHost(db, relaxedFilter, () => buildPoolFilter(sub, relaxed, true), levelCfg, matchWeights)
      : await pickRandomHost(db, relaxedFilter, () => buildPoolFilter(sub, relaxed, true));
  }

  const totalOnlineRow = await onlineCountPromise;
  const onlineCount = totalOnlineRow?.cnt ?? 0;

  if (!pick.host) {
    return c.json({
      matched: false,
      code: pick.totalOnline === 0 ? 'NO_HOST_AVAILABLE' : 'NO_MATCH_WITH_FILTERS',
      online_count: onlineCount,
      filtered_count: pick.totalOnline,
    });
  }

  // 7. Resolve per-level random rate (levelCfg already loaded in step 6).
  const rate = await resolveRandomRate(db, pick.host.level ?? 1, callType, levelCfg);
  const enriched = enrichHost(pick.host, levelCfg);

  // 8. Record the match (no-repeat / cooldown / daily-cap source of truth).
  //    Done synchronously so a fast follow-up /find can't double-match.
  //    Best-effort: a healer race or transient D1 error must not break the
  //    user's experience — they still get the match, the cooldown guard
  //    just won't see this entry.
  try {
    await db
      .prepare(
        `INSERT INTO random_match_history (user_id, host_id, call_type, outcome)
         VALUES (?, ?, ?, 'matched')`,
      )
      .bind(sub, enriched.id, callType)
      .run();
  } catch (err) {
    console.warn('[match/find] history insert failed (non-fatal):', err);
  }

  return c.json({
    matched: true,
    online_count: onlineCount,
    coins_per_minute: rate,
    host: {
      id: enriched.id,
      user_id: enriched.user_id,
      name: enriched.display_name || enriched.name,
      avatar_url: enriched.avatar_url,
      rating: enriched.rating ?? 0,
      review_count: enriched.review_count ?? 0,
      specialties: enriched.specialties,
      languages: enriched.languages,
      bio: enriched.bio,
      level: enriched.level ?? 1,
      level_info: enriched.level_info,
      audio_coins_per_minute: rate,
      video_coins_per_minute: rate,
      coins_per_minute: rate,
      allows_video: pick.host.allows_video !== 0,
    },
  });
});

// ─── POST /api/match/decline — mark the previous match as declined/skipped ──

/**
 * Called by the client when the user hits Decline (or "Skip / Next match")
 * on the Match Found overlay. Updates the most recent 'matched' row for
 * this caller-host pair to 'declined' so the decline-cooldown guard can
 * count it. Idempotent and best-effort — failure never blocks the UI.
 */
match.post('/decline', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json<{ host_id?: string }>().catch(() => ({} as any));
  if (!body.host_id) return c.json({ success: false, error: 'host_id required' }, 400);
  // Update only the most recent 'matched' row for this pair to avoid
  // accidentally rewriting an older accepted call. Best-effort — the table
  // may not exist yet during the brief schema-healer window.
  try {
    await c.env.DB
      .prepare(
        `UPDATE random_match_history SET outcome = 'declined'
         WHERE id = (
           SELECT id FROM random_match_history
           WHERE user_id = ? AND host_id = ? AND outcome = 'matched'
           ORDER BY created_at DESC LIMIT 1
         )`,
      )
      .bind(sub, body.host_id)
      .run();
  } catch (err) {
    console.warn('[match/decline] update failed (non-fatal):', err);
  }
  return c.json({ success: true });
});

// ─── GET /api/match/host-status/:id — live availability re-check ────────────

/**
 * Used by the client right before the user hits "Accept" on the Match Found
 * overlay. The host may have gone offline or jumped into another call in
 * the few seconds since /match/find returned — calling this and gating
 * Accept on the response avoids dropping the user into a doomed call.
 */
interface HostStatusRow {
  id: string;
  is_online: number;
  is_active: number;
  user_id: string;
  accepts_random_calls: number;
  allows_video: number;
  in_call: number;
}

match.get('/host-status/:id', async (c) => {
  const { sub } = c.get('user');
  const hostId = c.req.param('id');
  const db = c.env.DB;
  // Try the rich query first (with migration 0026 columns + live in-call
  // existence sub-select); fall back to a minimal version on missing-column
  // / missing-table errors so a healer race never breaks the Accept flow.
  const queryWithOptIns = `SELECT h.id, h.is_online, h.is_active, h.user_id,
              COALESCE(h.accepts_random_calls, 1) as accepts_random_calls,
              COALESCE(h.allows_video, 1) as allows_video,
              EXISTS (
                SELECT 1 FROM call_sessions cs
                WHERE cs.host_id = h.id AND cs.status IN ('pending','active')
              ) as in_call
       FROM hosts h WHERE h.id = ?`;
  const queryLegacy = `SELECT h.id, h.is_online, h.is_active, h.user_id,
              1 as accepts_random_calls, 1 as allows_video,
              EXISTS (
                SELECT 1 FROM call_sessions cs
                WHERE cs.host_id = h.id AND cs.status IN ('pending','active')
              ) as in_call
       FROM hosts h WHERE h.id = ?`;
  let row: HostStatusRow | null = null;
  try {
    row = await db.prepare(queryWithOptIns).bind(hostId).first<HostStatusRow>();
  } catch (err) {
    console.warn('[match/host-status] primary query failed, trying legacy:', err);
    try {
      row = await db.prepare(queryLegacy).bind(hostId).first<HostStatusRow>();
    } catch (legacyErr) {
      console.warn('[match/host-status] legacy query also failed:', legacyErr);
      return c.json({ available: false, code: 'HOST_LOOKUP_FAILED' }, 500);
    }
  }
  if (!row) return c.json({ available: false, code: 'HOST_NOT_FOUND' }, 404);
  if (row.user_id === sub) {
    // self-match guard — should never reach here, but cheap to enforce.
    return c.json({ available: false, code: 'SELF_MATCH' });
  }
  const available =
    row.is_active === 1 && row.is_online === 1 && row.accepts_random_calls === 1 && row.in_call === 0;
  return c.json({
    available,
    is_online: row.is_online === 1,
    in_call: row.in_call === 1,
    accepts_random_calls: row.accepts_random_calls === 1,
    allows_video: row.allows_video === 1,
    code: available
      ? 'AVAILABLE'
      : row.is_online !== 1
        ? 'HOST_OFFLINE'
        : row.in_call === 1
          ? 'HOST_BUSY'
          : 'HOST_UNAVAILABLE',
  });
});

// ─── GET /api/match/online-hosts — featured cards on the Random screen ──────

match.get('/online-hosts', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const config = await getLevelConfig(db);
  // Higher-level hosts surface first (rank_boost), then by rating + review
  // count. The opt-in filter mirrors /match/find so the cards never show a
  // host the matcher would actually skip. Falls back without the opt-in
  // columns if the schema healer hasn't run yet.
  const queryWithOptIns = `SELECT h.id, h.display_name, h.specialties, h.rating, h.level,
              h.audio_coins_per_minute, h.allows_video,
              u.name, u.avatar_url, u.gender
       FROM hosts h
       JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND h.is_online = 1 AND h.user_id != ?
         AND COALESCE(h.accepts_random_calls, 1) = 1
       ORDER BY ${rankBoostCaseSql(config)} DESC, h.rating DESC, h.review_count DESC
       LIMIT 12`;
  const queryLegacy = `SELECT h.id, h.display_name, h.specialties, h.rating, h.level,
              h.audio_coins_per_minute,
              u.name, u.avatar_url, u.gender
       FROM hosts h
       JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND h.is_online = 1 AND h.user_id != ?
       ORDER BY ${rankBoostCaseSql(config)} DESC, h.rating DESC, h.review_count DESC
       LIMIT 12`;
  let result;
  try {
    result = await db.prepare(queryWithOptIns).bind(sub).all<any>();
  } catch (err) {
    console.warn('[match/online-hosts] primary query failed, falling back:', err);
    try {
      result = await db.prepare(queryLegacy).bind(sub).all<any>();
    } catch (legacyErr) {
      console.warn('[match/online-hosts] legacy query also failed:', legacyErr);
      return c.json({ hosts: [], online_count: 0 });
    }
  }

  const hosts = result.results.map((h) => ({
    id: h.id,
    name: h.display_name || h.name,
    avatar_url: h.avatar_url,
    rating: h.rating ?? 0,
    coins_per_minute: h.audio_coins_per_minute ?? DEFAULT_AUDIO_RATE,
    specialties: safeJson(h.specialties, []),
    level: h.level ?? 1,
    level_info: buildLevelInfo(config, h.level ?? 1),
    gender: h.gender ?? null,
    // legacy fallback returns no `allows_video` column — default to true.
    allows_video: h.allows_video === undefined ? true : h.allows_video !== 0,
  }));

  return c.json({ hosts, online_count: hosts.length });
});

export default match;
