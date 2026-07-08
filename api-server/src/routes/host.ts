import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getLevelConfig, computeLevelProgress, getHostAudioRateCeiling, getHostVideoRateCeiling, getRankBoost, buildLevelInfo, rankBoostCaseSql, ABSOLUTE_MAX_RATE, DEFAULT_AUDIO_RATE, DEFAULT_VIDEO_RATE, type LevelDef } from '../lib/levels';
import { scoreHosts, normalizeWeights, type CandidateHost, type UserAffinity } from '../lib/recommend';
import type { Env, JWTPayload } from '../types';

const host = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

const updateProfileSchema = z.object({
  display_name: z.string().min(2).max(60).optional(),
  specialties: z.array(z.string().max(50)).max(10).optional(),
  languages: z.array(z.string().max(30)).max(10).optional(),
  coins_per_minute: z.number().int().min(1).max(500).optional(),
  audio_coins_per_minute: z.number().int().min(1).max(500).optional(),
  video_coins_per_minute: z.number().int().min(1).max(500).optional(),
  // Random-call opt-in toggles (migration 0026). `accepts_random_calls`
  // controls whether the host appears in the /match/find pool;
  // `allows_video` lets a host stay available for audio random calls but
  // opt out of video-only matches.
  accepts_random_calls: z.boolean().optional(),
  allows_video: z.boolean().optional(),
  // FIX: payout method storage so the Settings > Payout Method screen has a
  // real persistence layer instead of the previous "Coming Soon" alert.
  // Validation lives here in zod (rather than a CHECK constraint on the column)
  // so future channels can be added without a migration.
  payout_method: z.enum(['bank', 'upi', 'paytm', 'phonepe']).optional(),
  // Channel-specific fields are stored as a free-form record; the route
  // serializes to JSON before writing to the TEXT column. Length-capped to
  // keep abusive payloads from blowing up the row size.
  payout_details: z.record(z.string(), z.string().max(200)).optional(),
}).strict();

const statusSchema = z.object({
  is_online: z.boolean(),
});

/* ─── Level helpers ─── */
// Badge/name/color now come from the admin-configured ladder (single source of
// truth via buildLevelInfo) instead of a hardcoded map that silently diverged
// from the admin panel. `rankBoostCase()` builds a SQL CASE expression mapping
// each level to its configured rank_boost perk so listings can rank by it.

function safeParse(json: string | null | undefined, fallback: any = []) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function enrichHost(h: any, config: LevelDef[]) {
  return {
    ...h,
    specialties: safeParse(h.specialties, []),
    languages: safeParse(h.languages, []),
    level: h.level ?? 1,
    level_info: buildLevelInfo(config, h.level ?? 1),
    audio_coins_per_minute: h.audio_coins_per_minute ?? h.coins_per_minute ?? DEFAULT_AUDIO_RATE,
    video_coins_per_minute: h.video_coins_per_minute ?? (h.coins_per_minute ? h.coins_per_minute + 5 : DEFAULT_VIDEO_RATE),
  };
}

// Map hosts.level → its configured rank_boost perk for ORDER BY (see levels.ts).
const rankBoostCase = (config: LevelDef[]) => rankBoostCaseSql(config);

// GET /api/hosts/featured — top-rated/featured hosts (must be before /:id)
// OPTIMIZATION #3: Cache-Control lets Cloudflare CDN cache this for 2 min (featured rarely changes)
host.get('/featured', async (c) => {
  const config = await getLevelConfig(c.env.DB);
  // LEVEL PERK: rank_boost ranks higher-level hosts earlier (after the
  // top-rated flag), making the perk actually visible on the featured rail.
  const result = await c.env.DB.prepare(
    `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
     JOIN users u ON u.id = h.user_id
     WHERE h.is_active = 1 AND h.rating >= 4.0
     ORDER BY h.is_top_rated DESC, ${rankBoostCase(config)} DESC, h.rating DESC, h.total_minutes DESC LIMIT 10`
  ).all();
  return new Response(JSON.stringify(result.results.map((h) => enrichHost(h, config))), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
    },
  });
});

// GET /api/hosts/recommended — PERSONALIZED "For You" rail (Priority 1).
//
// Unlike GET /api/hosts (same order for everyone, CDN-cached), this is a
// per-user ranking that blends quality (rating/level/popularity), availability
// (online now), affinity (favorites, prior calls, inferred language/specialty/
// gender preferences) and exploration (cold-start boost for new hosts + a
// small jitter). Authenticated so we can read the caller's affinity signals.
// Scoring weights + on/off flag live in app_settings (reco_weights/reco_enabled)
// so admins can retune without a deploy. See lib/recommend.ts.
//
// Must be declared BEFORE GET /:id so "recommended" isn't captured as an id.
host.get('/recommended', authMiddleware, async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '20') || 20, 40);
  const config = await getLevelConfig(db);
  const rb = rankBoostCase(config);

  // Feature flag + weights — both best-effort with safe fallbacks.
  const [enabledRow, weightsRow] = await Promise.all([
    db.prepare("SELECT value FROM app_settings WHERE key = 'reco_enabled'").first<{ value: string }>().catch(() => null),
    db.prepare("SELECT value FROM app_settings WHERE key = 'reco_weights'").first<{ value: string }>().catch(() => null),
  ]);
  const enabled = enabledRow?.value == null ? true : enabledRow.value !== '0';

  // Kill-switch path: fall back to the public-list ordering (still no PII /
  // affinity used), so the rail keeps working if admins disable personalization.
  if (!enabled) {
    const fb = await db.prepare(
      `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
       JOIN users u ON u.id = h.user_id WHERE h.is_active = 1
       ORDER BY h.is_online DESC, ${rb} DESC, h.rating DESC, h.total_minutes DESC LIMIT ?`
    ).bind(limit).all();
    return c.json({
      personalized: false,
      hosts: fb.results.map((h) => ({ ...enrichHost(h, config), reason: 'Recommended for you' })),
    });
  }

  let weights;
  try {
    weights = normalizeWeights(weightsRow?.value ? JSON.parse(weightsRow.value) : undefined);
  } catch {
    weights = normalizeWeights(undefined);
  }

  // 1. Candidate pool (bounded): top hosts by availability/level/rating, the
  //    newest hosts (freshness/exploration), and the caller's affinity history.
  const [topPool, freshPool, favRows, callRows] = await Promise.all([
    db.prepare(
      `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
       JOIN users u ON u.id = h.user_id WHERE h.is_active = 1
       ORDER BY h.is_online DESC, ${rb} DESC, h.rating DESC, h.review_count DESC LIMIT 70`
    ).all(),
    db.prepare(
      `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
       JOIN users u ON u.id = h.user_id WHERE h.is_active = 1
       ORDER BY h.created_at DESC LIMIT 20`
    ).all(),
    db.prepare('SELECT host_id FROM user_favorites WHERE user_id = ?').bind(sub).all<{ host_id: string }>(),
    db.prepare(
      `SELECT cs.host_id AS host_id, COUNT(*) AS cnt,
              h.languages AS languages, h.specialties AS specialties, u.gender AS gender
       FROM call_sessions cs
       JOIN hosts h ON h.id = cs.host_id
       JOIN users u ON u.id = h.user_id
       WHERE cs.caller_id = ? AND cs.status = 'ended'
       GROUP BY cs.host_id ORDER BY cnt DESC LIMIT 100`
    ).bind(sub).all<any>(),
  ]);

  // Merge pools into a unique id → raw-row map.
  const rawById = new Map<string, any>();
  for (const h of [...(topPool.results ?? []), ...(freshPool.results ?? [])]) {
    if (!rawById.has((h as any).id)) rawById.set((h as any).id, h);
  }

  // Pull in favorited / previously-called hosts that didn't make the pools so
  // strong affinity signals are never missed (capped to keep it bounded).
  const favoriteHostIds = new Set<string>((favRows.results ?? []).map((r) => r.host_id));
  const callCountByHost = new Map<string, number>();
  for (const r of callRows.results ?? []) callCountByHost.set(r.host_id, Number(r.cnt) || 0);

  const missingIds = [...new Set<string>([...favoriteHostIds, ...callCountByHost.keys()])]
    .filter((id) => !rawById.has(id))
    .slice(0, 40);
  if (missingIds.length) {
    const placeholders = missingIds.map(() => '?').join(',');
    const extra = await db.prepare(
      `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
       JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND h.id IN (${placeholders})`
    ).bind(...missingIds).all();
    for (const h of extra.results ?? []) {
      if (!rawById.has((h as any).id)) rawById.set((h as any).id, h);
    }
  }

  // 2. Derive the caller's inferred preferences from who they've called.
  const langCounts = new Map<string, number>();
  const specCounts = new Map<string, number>();
  const genderCounts = new Map<string, number>();
  for (const r of callRows.results ?? []) {
    const cnt = Number(r.cnt) || 1;
    for (const l of safeParse(r.languages, []) as string[]) {
      const k = String(l).trim().toLowerCase();
      if (k) langCounts.set(k, (langCounts.get(k) ?? 0) + cnt);
    }
    for (const s of safeParse(r.specialties, []) as string[]) {
      const k = String(s).trim().toLowerCase();
      if (k) specCounts.set(k, (specCounts.get(k) ?? 0) + cnt);
    }
    const g = String(r.gender ?? '').trim().toLowerCase();
    if (g) genderCounts.set(g, (genderCounts.get(g) ?? 0) + cnt);
  }
  const topGender = [...genderCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const affinity: UserAffinity = {
    favoriteHostIds,
    callCountByHost,
    preferredLanguages: new Set(langCounts.keys()),
    preferredSpecialties: new Set(specCounts.keys()),
    preferredGender: topGender,
  };

  // 3. Score + rank. Build CandidateHost shapes with parsed arrays.
  const candidates: CandidateHost[] = [...rawById.values()].map((h) => ({
    id: h.id,
    user_id: h.user_id,
    level: h.level ?? 1,
    rating: Number(h.rating) || 0,
    review_count: Number(h.review_count) || 0,
    is_online: h.is_online ? 1 : 0,
    created_at: Number(h.created_at) || 0,
    gender: h.gender ?? null,
    languages: safeParse(h.languages, []),
    specialties: safeParse(h.specialties, []),
  }));

  // Seed the exploration jitter with the current 6-hour bucket so the rail
  // shuffles a little between sessions but stays stable within one.
  const seed = Math.floor(Date.now() / (6 * 3600 * 1000));
  const ranked = scoreHosts(candidates, affinity, weights, config, { limit, seed });

  const hosts = ranked.map((r) => ({
    ...enrichHost(rawById.get(r.host.id), config),
    reason: r.reason,
    // Rounded score for client-side debugging / sorting transparency.
    reco_score: Math.round(r.score * 1000) / 1000,
  }));

  return c.json({ personalized: true, hosts });
});

// GET /api/hosts — public list with cursor-based pagination
// OPTIMIZATION #2: Cursor pagination — avoids expensive OFFSET scan on large datasets.
//   - First page: no cursor → ORDER BY ... LIMIT n
//   - Next pages:  ?cursor=<opaque> → keyset WHERE clause → no OFFSET needed
//   Response includes `nextCursor` field; null means no more results.
// OPTIMIZATION #3: Cache-Control 30 s + stale-while-revalidate 60 s for unfiltered listing.
host.get('/', async (c) => {
  const { search, topic, online, cursor, limit = '20' } = c.req.query();
  const lim = Math.min(parseInt(limit) || 20, 100);

  // LEVEL PERK: rank_boost is the top ranking signal after online status, so
  // listings surface higher-level hosts first. The CASE maps level → configured
  // rank_boost; it is part of both the ORDER BY and the keyset for stable paging.
  const config = await getLevelConfig(c.env.DB);
  const rb = rankBoostCase(config);

  // FIX (search screen): also select u.country so the client can show the
  // host's country flag + name on the grid cards. It lives on the users table
  // (populated from CF-IPCountry), so h.* does not include it — add it explicitly.
  let query = `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio, u.country FROM hosts h
    JOIN users u ON u.id = h.user_id WHERE h.is_active = 1`;
  const params: any[] = [];

  if (online === '1') { query += ' AND h.is_online = 1'; }
  // FIX #26: Strip LIKE meta-characters and clamp length so a malicious search
  // term like `%%%%%...%%%` can't trigger a worst-case full-table LIKE scan.
  if (search) {
    const safeSearch = String(search).replace(/[%_\\]/g, '').slice(0, 50);
    if (safeSearch) {
      query += ' AND (u.name LIKE ? OR h.display_name LIKE ?)';
      params.push(`%${safeSearch}%`, `%${safeSearch}%`);
    }
  }
  if (topic) {
    const safeTopic = String(topic).replace(/[%_\\]/g, '').slice(0, 50);
    if (safeTopic) {
      query += ' AND h.specialties LIKE ?';
      params.push(`%${safeTopic}%`);
    }
  }

  // Keyset cursor: base64(JSON({is_online,rank,rating,total_minutes,id})).
  // `rank` is the configured rank_boost of the row's level. Old cursors that
  // predate this default rank to 0 so paging degrades gracefully.
  if (cursor) {
    try {
      const prev = JSON.parse(atob(cursor)) as {
        is_online: number; rank?: number; rating: number; total_minutes: number; id: string;
      };
      const prevRank = prev.rank ?? 0;
      query += ` AND (
        h.is_online < ? OR
        (h.is_online = ? AND ${rb} < ?) OR
        (h.is_online = ? AND ${rb} = ? AND h.rating < ?) OR
        (h.is_online = ? AND ${rb} = ? AND h.rating = ? AND h.total_minutes < ?) OR
        (h.is_online = ? AND ${rb} = ? AND h.rating = ? AND h.total_minutes = ? AND h.id > ?)
      )`;
      params.push(
        prev.is_online,
        prev.is_online, prevRank,
        prev.is_online, prevRank, prev.rating,
        prev.is_online, prevRank, prev.rating, prev.total_minutes,
        prev.is_online, prevRank, prev.rating, prev.total_minutes, prev.id,
      );
    } catch {
      // Invalid cursor — ignore and return first page
    }
  }

  query += ` ORDER BY h.is_online DESC, ${rb} DESC, h.rating DESC, h.total_minutes DESC, h.id ASC LIMIT ?`;
  params.push(lim);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const rows = result.results.map((h) => enrichHost(h, config));

  // Build next cursor from last row
  let nextCursor: string | null = null;
  if (rows.length === lim) {
    const last = result.results[result.results.length - 1] as any;
    nextCursor = btoa(JSON.stringify({
      is_online: last.is_online,
      rank: getRankBoost(last.level ?? 1, config),
      rating: last.rating,
      total_minutes: last.total_minutes,
      id: last.id,
    }));
  }

  const body = JSON.stringify({ hosts: rows, nextCursor });
  const isFiltered = !!(search || topic || online);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      // Filtered queries are not cached (dynamic); unfiltered get 30s CDN cache
      'Cache-Control': isFiltered
        ? 'no-store'
        : 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
});

// GET /api/hosts/:id — single host
host.get('/:id', async (c) => {
  const [h, config] = await Promise.all([
    c.env.DB.prepare(
      `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
       JOIN users u ON u.id = h.user_id WHERE h.id = ?`
    ).bind(c.req.param('id')).first<any>(),
    getLevelConfig(c.env.DB),
  ]);
  if (!h) return c.json({ error: 'Host not found' }, 404);
  return c.json(enrichHost(h, config));
});

// GET /api/hosts/:id/chat-status — check if caller has called this host (chat unlock)
host.get('/:id/chat-status', authMiddleware, async (c) => {
  const { sub } = c.get('user');
  const hostId = c.req.param('id');
  const db = c.env.DB;
  const hostRow = await db.prepare('SELECT chat_unlock_policy FROM hosts WHERE id = ?').bind(hostId).first<any>();
  if (!hostRow) return c.json({ unlocked: false, reason: 'host_not_found' }, 404);
  if (hostRow.chat_unlock_policy !== 'call_first') return c.json({ unlocked: true, reason: 'free_chat' });
  const prevCall = await db.prepare(
    `SELECT id FROM call_sessions WHERE caller_id = ? AND host_id = ? AND status = 'ended' LIMIT 1`
  ).bind(sub, hostId).first<any>();
  return c.json({ unlocked: !!prevCall, reason: prevCall ? 'call_done' : 'no_call_yet' });
});

// GET /api/hosts/:id/reviews
host.get('/:id/reviews', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT r.*, u.name, u.avatar_url FROM ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.host_id = ? ORDER BY r.created_at DESC LIMIT 20`
  ).bind(c.req.param('id')).all();
  return c.json(result.results);
});

// GET /api/hosts/:id/gallery — public gallery for a host (viewer-facing)
host.get('/:id/gallery', async (c) => {
  const hostId = c.req.param('id');
  try {
    const result = await c.env.DB.prepare(
      'SELECT id, media_url, media_type, caption, sort_order FROM host_gallery WHERE host_id = ? ORDER BY sort_order ASC, created_at ASC'
    ).bind(hostId).all();
    return c.json(result.results ?? []);
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) return c.json([]);
    throw e;
  }
});

// Protected host routes
const hostProtected = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
hostProtected.use('*', authMiddleware);

// PATCH /api/host/me — update host profile
hostProtected.patch('/me', zValidator('json', updateProfileSchema), async (c) => {
  const { sub } = c.get('user');
  // FIX: Use validated body from zValidator, not raw c.req.json() which bypasses validation
  const body = c.req.valid('json') as Record<string, any>;
  const rateKeys = ['coins_per_minute', 'audio_coins_per_minute', 'video_coins_per_minute'];
  // Level-based rate caps: a host may charge up to their level's audio/video
  // ceiling (admin-set max + HOST_RATE_BONUS headroom). Resolved only when a
  // rate field is actually being changed. The legacy `coins_per_minute` column
  // is treated as an audio fallback so it shares the audio ceiling.
  let MAX_AUDIO = ABSOLUTE_MAX_RATE;
  let MAX_VIDEO = ABSOLUTE_MAX_RATE;
  if (rateKeys.some((k) => body[k] !== undefined)) {
    const hostRow = await c.env.DB.prepare('SELECT level FROM hosts WHERE user_id = ?').bind(sub).first<{ level: number }>();
    const cfg = await getLevelConfig(c.env.DB);
    const lvl = hostRow?.level ?? 1;
    MAX_AUDIO = getHostAudioRateCeiling(lvl, cfg);
    MAX_VIDEO = getHostVideoRateCeiling(lvl, cfg);
  }
  const allowed = ['display_name', 'specialties', 'languages', 'coins_per_minute', 'audio_coins_per_minute', 'video_coins_per_minute', 'accepts_random_calls', 'allows_video', 'payout_method', 'payout_details'];
  const sets: string[] = [];
  const vals: any[] = [];
  // Track the actually-stored (clamped) rate values so the response can echo
  // the truth back — the client then reflects the enforced cap instead of the
  // (possibly higher) number the host typed.
  const storedRates: Record<string, number> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      // FIX: payout_details is a JSON object on the wire; the column is TEXT.
      // Same convention as specialties/languages — Array.isArray(payload)
      // serializes those, but payout_details is an object so we handle it
      // explicitly here.
      let val: any;
      if (key === 'payout_details') {
        val = JSON.stringify(body[key] ?? {});
      } else if (Array.isArray(body[key])) {
        val = JSON.stringify(body[key]);
      } else if (key === 'accepts_random_calls' || key === 'allows_video') {
        // Stored as INTEGER 0/1 to match the migration default.
        val = body[key] ? 1 : 0;
      } else {
        val = body[key];
      }
      // Cap rate fields to the host's per-channel level ceiling. Audio and the
      // legacy combined column share the audio cap; video uses its own. This is
      // the AUTHORITATIVE limit — the host can never persist a rate above their
      // admin-configured level cap (+HOST_RATE_BONUS), regardless of client.
      if (rateKeys.includes(key)) {
        const num = Number(val);
        if (isNaN(num) || num < 1) return c.json({ error: `${key} must be at least 1` }, 400);
        const cap = key === 'video_coins_per_minute' ? MAX_VIDEO : MAX_AUDIO;
        val = Math.min(num, cap);
        storedRates[key] = val;
      }
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(sub);
  await c.env.DB.prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE user_id = ?`).bind(...vals).run();
  return c.json({
    success: true,
    // Legacy field — kept for older clients reading `max_rate` off the
    // response. New clients should use the channel-specific values.
    max_rate: Math.max(MAX_AUDIO, MAX_VIDEO),
    max_audio_rate: MAX_AUDIO,
    max_video_rate: MAX_VIDEO,
    // Echo the actually-stored (clamped) rates so the client reflects the
    // enforced cap rather than whatever the host typed.
    ...storedRates,
  });
});

// PATCH /api/host/status — go online/offline
hostProtected.patch('/status', zValidator('json', statusSchema), async (c) => {
  const { sub } = c.get('user');
  // FIX: c.req.valid('json') use karo — zValidator ke baad c.req.json() body stream consume kar leta hai
  // is_online value lost ho jaata tha, DB mein undefined/falsy store hota tha
  const { is_online } = c.req.valid('json');

  // host.id (hosts table PK) fetch karo — presence broadcast mein dono IDs chahiye
  const hostRow = await c.env.DB.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<{ id: string }>();

  // FIX: previously the UPDATE was issued unconditionally and silently affected
  // 0 rows when the user had no hosts row (data inconsistency: role='host' but
  // hosts row missing). The host UI optimistically showed "Online" while
  // server state never changed → users saw the host as offline forever.
  // Now we fail fast with a clear error so the client can surface it.
  if (!hostRow) {
    console.warn('[host/status] No host row for user', sub, '— rejecting toggle');
    return c.json(
      { error: 'Host profile not found. Please complete your KYC application.', code: 'HOST_NOT_FOUND' },
      404
    );
  }

  // 1. DB update with atomic guard. Use the result.changes to confirm the row
  //    actually flipped — surfaces any future schema/permissions regression.
  const updateResult = await c.env.DB
    .prepare('UPDATE hosts SET is_online = ?, updated_at = unixepoch() WHERE user_id = ?')
    .bind(is_online ? 1 : 0, sub)
    .run();
  if (!updateResult.meta?.changes) {
    console.warn('[host/status] UPDATE affected 0 rows for user', sub);
    return c.json({ error: 'Failed to update status. Please try again.', code: 'UPDATE_FAILED' }, 500);
  }

  // FIX: presence broadcast moved to ctx.waitUntil() — was blocking the
  // response while up to 100 NotificationHub fetches resolved sequentially
  // through Promise.allSettled, adding 100-500 ms+ latency on every toggle.
  // Fire-and-forget pattern: client gets 200 immediately, broadcast happens
  // in the background. Workers keep the request alive until waitUntil resolves.
  const presenceMsg = JSON.stringify({ type: 'presence', user_id: sub, host_id: hostRow.id, is_online });
  c.executionCtx.waitUntil(broadcastPresence(c.env, sub, presenceMsg));

  return c.json({ success: true, is_online });
});

// FIX: extracted to a function so it can run via ctx.waitUntil() without
// blocking the toggle response. Errors are logged, never propagated — a failed
// broadcast must not flip the host's status back to offline on the client.
async function broadcastPresence(env: Env, hostUserId: string, presenceMsg: string): Promise<void> {
  // 1. Notify the host's own NotificationHub (so other tabs/devices update)
  try {
    const hostNotifStub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(hostUserId));
    await hostNotifStub.fetch('https://dummy/notify', { method: 'POST', body: presenceMsg });
  } catch (e) {
    console.warn('[host/status] self-notify failed:', e);
  }

  // 2. Broadcast to recently-active users so their host list updates live.
  //    NOTE: ORDER BY users.updated_at — relies on the index added below.
  try {
    const recentUsers = await env.DB
      .prepare("SELECT id FROM users WHERE role = 'user' ORDER BY updated_at DESC LIMIT 100")
      .all<{ id: string }>();

    await Promise.allSettled(
      (recentUsers.results ?? []).map(async (u) => {
        try {
          const stub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(u.id));
          await stub.fetch('https://dummy/notify', { method: 'POST', body: presenceMsg });
        } catch {
          /* one user's hub failure must not abort the rest of the broadcast */
        }
      })
    );
  } catch (e) {
    console.warn('[host/status] broadcast failed:', e);
  }
}

// GET /api/host/earnings
hostProtected.get('/earnings', async (c) => {
  const { sub } = c.get('user');
  const h = await c.env.DB.prepare(
    `SELECT h.id, h.total_earnings, h.total_minutes, h.rating, h.review_count,
            COUNT(cs.id) as total_calls
     FROM hosts h
     LEFT JOIN call_sessions cs ON cs.host_id = h.id AND cs.status = 'ended'
     WHERE h.user_id = ?
     GROUP BY h.id`
  ).bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host' }, 403);
  const txs = await c.env.DB.prepare(
    `SELECT ct.id, ct.amount, ct.description, ct.created_at,
            cs.type as call_type, cs.duration_seconds, u.name as caller_name
     FROM coin_transactions ct
     JOIN call_sessions cs ON cs.id = ct.ref_id
     JOIN users u ON u.id = cs.caller_id
     WHERE cs.host_id = ? AND ct.type = 'bonus'
     ORDER BY ct.created_at DESC LIMIT 50`
  ).bind(h.id).all();
  const withdrawals = await c.env.DB.prepare(
    'SELECT * FROM withdrawal_requests WHERE host_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(h.id).all();
  return c.json({ host: h, transactions: txs.results, withdrawals: withdrawals.results });
});

// GET /api/host/level — host's own level + progress towards the next level.
// Powers the Level card on the host dashboard. Uses the SAME admin-configured
// ladder (app_settings.level_config) and the SAME metric the recalculation job
// uses (review_count vs min_calls, rating vs min_rating) so the progress bar
// accurately predicts when the host will be promoted.
hostProtected.get('/level', async (c) => {
  const { sub } = c.get('user');
  const h = await c.env.DB.prepare(
    `SELECT h.id, h.level, h.rating, h.review_count, h.total_minutes, h.total_earnings,
            COUNT(cs.id) AS total_calls
     FROM hosts h
     LEFT JOIN call_sessions cs ON cs.host_id = h.id AND cs.status = 'ended'
     WHERE h.user_id = ?
     GROUP BY h.id`
  ).bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host' }, 403);

  const config = await getLevelConfig(c.env.DB);
  const progress = computeLevelProgress(
    { review_count: Number(h.review_count) || 0, rating: Number(h.rating) || 0 },
    config,
    h.level,
  );

  return c.json({
    ...progress,
    // Full ladder so the client can render every rung if it wants to.
    levels: config,
    stats: {
      total_calls: Number(h.total_calls) || 0,
      total_minutes: Number(h.total_minutes) || 0,
      total_earnings: Number(h.total_earnings) || 0,
      rating: Number(h.rating) || 0,
      review_count: Number(h.review_count) || 0,
    },
  });
});

// GET /api/host/me — host profile for current user
hostProtected.get('/me', async (c) => {
  const { sub } = c.get('user');
  const h = await c.env.DB.prepare(
    `SELECT h.*, u.name, u.avatar_url, u.bio, u.email FROM hosts h
     JOIN users u ON u.id = h.user_id WHERE h.user_id = ?`
  ).bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host' }, 403);
  // FIX: parse JSON-encoded TEXT columns. payout_details is the new addition;
  // a missing/null/malformed value collapses to {} so the client can read it
  // unconditionally without a try/catch.
  let payoutDetails: Record<string, string> = {};
  if (h.payout_details) {
    try { payoutDetails = JSON.parse(h.payout_details); } catch { payoutDetails = {}; }
  }
  return c.json({
    ...h,
    specialties: JSON.parse(h.specialties || '[]'),
    languages: JSON.parse(h.languages || '[]'),
    payout_details: payoutDetails,
  });
});

// ─── Host Gallery ────────────────────────────────────────────────────────────
// GET /api/host/gallery — get current host's gallery items
hostProtected.get('/gallery', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const host = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<{ id: string }>();
  if (!host) return c.json({ error: 'Not a host' }, 403);

  try {
    const result = await db.prepare(
      'SELECT * FROM host_gallery WHERE host_id = ? ORDER BY sort_order ASC, created_at ASC'
    ).bind(host.id).all();
    return c.json(result.results ?? []);
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) return c.json([]);
    throw e;
  }
});

// POST /api/host/gallery — add a gallery item (max 6)
hostProtected.post('/gallery', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const host = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<{ id: string }>();
  if (!host) return c.json({ error: 'Not a host' }, 403);

  const body = await c.req.json<{ media_url: string; media_type?: string; caption?: string }>();
  if (!body.media_url) return c.json({ error: 'media_url is required' }, 400);

  try {
    // Check limit
    const count = await db.prepare(
      'SELECT COUNT(*) as cnt FROM host_gallery WHERE host_id = ?'
    ).bind(host.id).first<{ cnt: number }>();
    if ((count?.cnt ?? 0) >= 6) {
      return c.json({ error: 'Maximum 6 gallery items allowed. Delete one first.' }, 400);
    }

    const id = crypto.randomUUID();
    await db.prepare(
      'INSERT INTO host_gallery (id, host_id, media_url, media_type, caption, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, host.id, body.media_url, body.media_type ?? 'image', body.caption ?? null, (count?.cnt ?? 0)).run();

    return c.json({ success: true, id });
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) {
      return c.json({ error: 'Gallery feature not yet available' }, 503);
    }
    throw e;
  }
});

// DELETE /api/host/gallery/:id — remove a gallery item
hostProtected.delete('/gallery/:id', async (c) => {
  const { sub } = c.get('user');
  const itemId = c.req.param('id');
  const db = c.env.DB;
  const host = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<{ id: string }>();
  if (!host) return c.json({ error: 'Not a host' }, 403);

  try {
    await db.prepare(
      'DELETE FROM host_gallery WHERE id = ? AND host_id = ?'
    ).bind(itemId, host.id).run();
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) return c.json({ success: true });
    throw e;
  }

  return c.json({ success: true });
});

// PATCH /api/host/intro-video — set/update intro video URL
hostProtected.patch('/intro-video', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<{ intro_video_url: string | null }>();

  try {
    await db.prepare('UPDATE hosts SET intro_video_url = ? WHERE user_id = ?')
      .bind(body.intro_video_url ?? null, sub).run();
    return c.json({ success: true });
  } catch (e: any) {
    if (/no such column/i.test(String(e?.message || ''))) {
      return c.json({ error: 'Intro video feature not yet available' }, 503);
    }
    throw e;
  }
});

// PATCH /api/host/schedule — set availability schedule
hostProtected.patch('/schedule', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<{ available_from?: string; available_to?: string; timezone?: string }>();

  try {
    const sets: string[] = [];
    const vals: any[] = [];
    if (body.available_from !== undefined) { sets.push('available_from = ?'); vals.push(body.available_from); }
    if (body.available_to !== undefined) { sets.push('available_to = ?'); vals.push(body.available_to); }
    if (body.timezone !== undefined) { sets.push('timezone = ?'); vals.push(body.timezone); }
    if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
    vals.push(sub);
    await db.prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE user_id = ?`).bind(...vals).run();
    return c.json({ success: true });
  } catch (e: any) {
    if (/no such column/i.test(String(e?.message || ''))) {
      return c.json({ error: 'Schedule feature not yet available' }, 503);
    }
    throw e;
  }
});

// ─── Host Earnings Analytics ─────────────────────────────────────────────────
// GET /api/host/earnings/analytics — daily earnings for graphs (last 30 days)
hostProtected.get('/earnings/analytics', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const host = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<{ id: string }>();
  if (!host) return c.json({ error: 'Not a host' }, 403);

  const days = Math.min(parseInt(c.req.query('days') || '30') || 30, 90);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  // Daily aggregation of earnings and call counts
  const dailyStats = await db.prepare(
    `SELECT
       DATE(cs.ended_at, 'unixepoch') as day,
       COUNT(*) as call_count,
       SUM(cs.duration_seconds) as total_seconds,
       SUM(CASE WHEN ct.amount > 0 THEN ct.amount ELSE 0 END) as earnings
     FROM call_sessions cs
     LEFT JOIN coin_transactions ct ON ct.ref_id = cs.id AND ct.user_id = ? AND ct.type = 'bonus'
     WHERE cs.host_id = ? AND cs.status = 'ended' AND cs.ended_at >= ?
     GROUP BY DATE(cs.ended_at, 'unixepoch')
     ORDER BY day ASC`
  ).bind(sub, host.id, since).all<any>();

  // Weekly summary
  const weeklyStats = await db.prepare(
    `SELECT
       strftime('%Y-W%W', cs.ended_at, 'unixepoch') as week,
       COUNT(*) as call_count,
       SUM(cs.duration_seconds) as total_seconds,
       SUM(CASE WHEN ct.amount > 0 THEN ct.amount ELSE 0 END) as earnings
     FROM call_sessions cs
     LEFT JOIN coin_transactions ct ON ct.ref_id = cs.id AND ct.user_id = ? AND ct.type = 'bonus'
     WHERE cs.host_id = ? AND cs.status = 'ended' AND cs.ended_at >= ?
     GROUP BY week
     ORDER BY week ASC`
  ).bind(sub, host.id, since).all<any>();

  // Peak hours (which hour of day gets most calls)
  const peakHours = await db.prepare(
    `SELECT
       CAST(strftime('%H', cs.created_at, 'unixepoch') AS INTEGER) as hour,
       COUNT(*) as call_count
     FROM call_sessions cs
     WHERE cs.host_id = ? AND cs.status = 'ended' AND cs.ended_at >= ?
     GROUP BY hour
     ORDER BY call_count DESC LIMIT 5`
  ).bind(host.id, since).all<any>();

  // Tips received
  let tipsTotal = 0;
  try {
    const tipRow = await db.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM tips WHERE host_id = ? AND created_at >= ?'
    ).bind(host.id, since).first<{ total: number }>();
    tipsTotal = tipRow?.total ?? 0;
  } catch { /* tips table may not exist */ }

  return c.json({
    daily: dailyStats.results ?? [],
    weekly: weeklyStats.results ?? [],
    peak_hours: peakHours.results ?? [],
    tips_total: tipsTotal,
    period_days: days,
  });
});

export { host as hostsRouter, hostProtected as hostRouter };
