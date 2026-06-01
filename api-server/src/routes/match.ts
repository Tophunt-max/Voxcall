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
  type LevelDef,
} from '../lib/levels';
import { checkRateLimit } from '../lib/rateLimit';
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
    audio_coins_per_minute: h.audio_coins_per_minute ?? h.coins_per_minute ?? 5,
    video_coins_per_minute: h.video_coins_per_minute ?? (h.coins_per_minute ?? 5) + 5,
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
 * Resolve the random per-minute rate for a host based on their level. Honours
 * the per-level `random_audio_rate` / `random_video_rate` set by the admin
 * in Level System Configuration, falling back to the global
 * `random_call_audio_rate` / `random_call_video_rate` settings (and finally
 * to 5 / 8) for older configs / fresh deploys.
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
  return readIntSetting(db, fallbackKey, callType === 'video' ? 8 : 5);
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
): { where: string; params: any[] } {
  const where: string[] = [
    'h.is_active = 1',
    'h.is_online = 1',
    'h.user_id != ?',
    // accepts_random_calls is added by migration 0026 with DEFAULT 1.
    // COALESCE makes the filter safe even if the migration hasn't run yet.
    'COALESCE(h.accepts_random_calls, 1) = 1',
  ];
  const params: any[] = [callerId];

  if (filters.callType === 'video') {
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
 */
async function pickRandomHost(
  db: D1Database,
  filter: { where: string; params: any[] },
): Promise<{ host: any | null; totalOnline: number }> {
  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM hosts h JOIN users u ON u.id = h.user_id WHERE ${filter.where}`)
    .bind(...filter.params)
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
         WHERE ${filter.where}
         LIMIT 1 OFFSET ?`,
      )
      .bind(...filter.params, offset)
      .first<any>();
    if (host) return { host, totalOnline };
  }
  return { host: null, totalOnline };
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
  const rows = await db
    .prepare(
      `SELECT DISTINCT host_id FROM random_match_history
       WHERE user_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(userId, since)
    .all<{ host_id: string }>();
  return (rows.results ?? []).map((r) => r.host_id);
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

  // 5. Build pool filter (incl. no-repeat exclusion)
  const repeatBlockMin = await readIntSetting(db, 'random_match_repeat_block_min', 30);
  const excludeHostIds = await recentlyMatchedHostIds(db, sub, repeatBlockMin);
  const filters: MatchFilters = {
    callType,
    gender,
    languages,
    minRating,
    excludeHostIds,
  };
  const filter = buildPoolFilter(sub, filters);

  // 6. Pick a host (with race retry) — we ALSO want a count for the UI,
  //    so report the size of the un-filtered online pool separately.
  const [pick, totalOnlineRow] = await Promise.all([
    pickRandomHost(db, filter),
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM hosts h JOIN users u ON u.id = h.user_id
         WHERE h.is_active = 1 AND h.is_online = 1 AND h.user_id != ?
           AND COALESCE(h.accepts_random_calls, 1) = 1`,
      )
      .bind(sub)
      .first<{ cnt: number }>(),
  ]);
  const onlineCount = totalOnlineRow?.cnt ?? 0;

  if (!pick.host) {
    return c.json({
      matched: false,
      code: pick.totalOnline === 0 ? 'NO_HOST_AVAILABLE' : 'NO_MATCH_WITH_FILTERS',
      online_count: onlineCount,
      filtered_count: pick.totalOnline,
    });
  }

  // 7. Resolve per-level random rate
  const levelCfg = await getLevelConfig(db);
  const rate = await resolveRandomRate(db, pick.host.level ?? 1, callType, levelCfg);
  const enriched = enrichHost(pick.host, levelCfg);

  // 8. Record the match (no-repeat / cooldown / daily-cap source of truth).
  //    Done synchronously so a fast follow-up /find can't double-match.
  await db
    .prepare(
      `INSERT INTO random_match_history (user_id, host_id, call_type, outcome)
       VALUES (?, ?, ?, 'matched')`,
    )
    .bind(sub, enriched.id, callType)
    .run();

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
  // accidentally rewriting an older accepted call.
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
  return c.json({ success: true });
});

// ─── GET /api/match/host-status/:id — live availability re-check ────────────

/**
 * Used by the client right before the user hits "Accept" on the Match Found
 * overlay. The host may have gone offline or jumped into another call in
 * the few seconds since /match/find returned — calling this and gating
 * Accept on the response avoids dropping the user into a doomed call.
 */
match.get('/host-status/:id', async (c) => {
  const { sub } = c.get('user');
  const hostId = c.req.param('id');
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT h.id, h.is_online, h.is_active, h.user_id,
              COALESCE(h.accepts_random_calls, 1) as accepts_random_calls,
              COALESCE(h.allows_video, 1) as allows_video,
              EXISTS (
                SELECT 1 FROM call_sessions cs
                WHERE cs.host_id = h.id AND cs.status IN ('pending','active')
              ) as in_call
       FROM hosts h WHERE h.id = ?`,
    )
    .bind(hostId)
    .first<{
      id: string;
      is_online: number;
      is_active: number;
      user_id: string;
      accepts_random_calls: number;
      allows_video: number;
      in_call: number;
    }>();
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
  // host the matcher would actually skip.
  const result = await db
    .prepare(
      `SELECT h.id, h.display_name, h.specialties, h.rating, h.level,
              h.audio_coins_per_minute, h.allows_video,
              u.name, u.avatar_url, u.gender
       FROM hosts h
       JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND h.is_online = 1 AND h.user_id != ?
         AND COALESCE(h.accepts_random_calls, 1) = 1
       ORDER BY ${rankBoostCaseSql(config)} DESC, h.rating DESC, h.review_count DESC
       LIMIT 12`,
    )
    .bind(sub)
    .all<any>();

  const hosts = result.results.map((h) => ({
    id: h.id,
    name: h.display_name || h.name,
    avatar_url: h.avatar_url,
    rating: h.rating ?? 0,
    coins_per_minute: h.audio_coins_per_minute ?? 5,
    specialties: safeJson(h.specialties, []),
    level: h.level ?? 1,
    level_info: buildLevelInfo(config, h.level ?? 1),
    gender: h.gender ?? null,
    allows_video: h.allows_video !== 0,
  }));

  return c.json({ hosts, online_count: hosts.length });
});

export default match;
