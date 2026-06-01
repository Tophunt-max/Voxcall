import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getLevelConfig, computeLevelProgress, getHostAudioRateCeiling, getHostVideoRateCeiling, getRankBoost, buildLevelInfo, rankBoostCaseSql, ABSOLUTE_MAX_RATE, type LevelDef } from '../lib/levels';
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
    audio_coins_per_minute: h.audio_coins_per_minute ?? h.coins_per_minute ?? 5,
    video_coins_per_minute: h.video_coins_per_minute ?? (h.coins_per_minute ?? 5) + 5,
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

  let query = `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
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
      // legacy combined column share the audio cap; video uses its own.
      if (rateKeys.includes(key)) {
        const num = Number(val);
        if (isNaN(num) || num < 1) return c.json({ error: `${key} must be at least 1` }, 400);
        const cap = key === 'video_coins_per_minute' ? MAX_VIDEO : MAX_AUDIO;
        val = Math.min(num, cap);
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

export { host as hostsRouter, hostProtected as hostRouter };
