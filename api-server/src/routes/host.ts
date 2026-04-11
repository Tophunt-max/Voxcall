import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const host = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

/* ─── Level helpers ─── */
const LEVELS: Record<number, { name: string; badge: string; color: string }> = {
  1: { name: 'Newcomer', badge: '🌱', color: '#6B7280' },
  2: { name: 'Rising',   badge: '⭐', color: '#F59E0B' },
  3: { name: 'Expert',   badge: '🔥', color: '#EF4444' },
  4: { name: 'Pro',      badge: '💎', color: '#8B5CF6' },
  5: { name: 'Elite',    badge: '👑', color: '#D97706' },
};

function safeParse(json: string | null | undefined, fallback: any = []) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function enrichHost(h: any) {
  const lvl = h.level ?? 1;
  return {
    ...h,
    specialties: safeParse(h.specialties, []),
    languages: safeParse(h.languages, []),
    level_info: LEVELS[lvl] ?? LEVELS[1],
    audio_coins_per_minute: h.audio_coins_per_minute ?? h.coins_per_minute ?? 5,
    video_coins_per_minute: h.video_coins_per_minute ?? (h.coins_per_minute ?? 5) + 5,
  };
}

// GET /api/hosts/featured — top-rated/featured hosts (must be before /:id)
// OPTIMIZATION #3: Cache-Control lets Cloudflare CDN cache this for 2 min (featured rarely changes)
host.get('/featured', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
     JOIN users u ON u.id = h.user_id
     WHERE h.is_active = 1 AND h.rating >= 4.0
     ORDER BY h.is_top_rated DESC, h.rating DESC, h.total_minutes DESC LIMIT 10`
  ).all();
  return new Response(JSON.stringify(result.results.map(enrichHost)), {
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

  let query = `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
    JOIN users u ON u.id = h.user_id WHERE h.is_active = 1`;
  const params: any[] = [];

  if (online === '1') { query += ' AND h.is_online = 1'; }
  if (search) { query += ' AND (u.name LIKE ? OR h.display_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (topic) { query += ' AND h.specialties LIKE ?'; params.push(`%${topic}%`); }

  // Keyset cursor: encoded as base64(JSON({is_online,rating,total_minutes,id}))
  if (cursor) {
    try {
      const prev = JSON.parse(atob(cursor)) as {
        is_online: number; rating: number; total_minutes: number; id: string;
      };
      query += ` AND (
        h.is_online < ? OR
        (h.is_online = ? AND h.rating < ?) OR
        (h.is_online = ? AND h.rating = ? AND h.total_minutes < ?) OR
        (h.is_online = ? AND h.rating = ? AND h.total_minutes = ? AND h.id > ?)
      )`;
      params.push(
        prev.is_online,
        prev.is_online, prev.rating,
        prev.is_online, prev.rating, prev.total_minutes,
        prev.is_online, prev.rating, prev.total_minutes, prev.id,
      );
    } catch {
      // Invalid cursor — ignore and return first page
    }
  }

  query += ' ORDER BY h.is_online DESC, h.rating DESC, h.total_minutes DESC, h.id ASC LIMIT ?';
  params.push(lim);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const rows = result.results.map(enrichHost);

  // Build next cursor from last row
  let nextCursor: string | null = null;
  if (rows.length === lim) {
    const last = result.results[result.results.length - 1] as any;
    nextCursor = btoa(JSON.stringify({
      is_online: last.is_online,
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
  const h = await c.env.DB.prepare(
    `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
     JOIN users u ON u.id = h.user_id WHERE h.id = ?`
  ).bind(c.req.param('id')).first<any>();
  if (!h) return c.json({ error: 'Host not found' }, 404);
  return c.json(enrichHost(h));
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
hostProtected.patch('/me', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json();
  const MAX_RATE = 500; // coins per minute cap to prevent hosts from setting abusive rates
  const allowed = ['display_name', 'specialties', 'languages', 'coins_per_minute', 'audio_coins_per_minute', 'video_coins_per_minute'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      let val = Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key];
      // Cap rate fields to prevent abuse
      if (['coins_per_minute', 'audio_coins_per_minute', 'video_coins_per_minute'].includes(key)) {
        const num = Number(val);
        if (isNaN(num) || num < 1) return c.json({ error: `${key} must be at least 1` }, 400);
        val = Math.min(num, MAX_RATE);
      }
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(sub);
  await c.env.DB.prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE user_id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// PATCH /api/host/status — go online/offline
hostProtected.patch('/status', async (c) => {
  const { sub } = c.get('user');
  const { is_online } = await c.req.json();

  // 1. DB update
  await c.env.DB.prepare('UPDATE hosts SET is_online = ?, updated_at = unixepoch() WHERE user_id = ?')
    .bind(is_online ? 1 : 0, sub).run();

  // 2. Host ke apne NotificationHub ko notify karo — host app ka UI sync rahega
  try {
    const hostNotifId = c.env.NOTIFICATION_HUB.idFromName(sub);
    const hostNotifStub = c.env.NOTIFICATION_HUB.get(hostNotifId);
    await hostNotifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'presence', user_id: sub, is_online }),
    });
  } catch {}

  // 3. Active users (last 100 user-role accounts) ko broadcast karo
  // taaki unka host list instantly refresh ho — presence event pe queryClient invalidate hoga
  try {
    const recentUsers = await c.env.DB.prepare(
      `SELECT id FROM users WHERE role = 'user' ORDER BY updated_at DESC LIMIT 100`
    ).all<{ id: string }>();

    const presenceMsg = JSON.stringify({ type: 'presence', user_id: sub, is_online });
    await Promise.allSettled(
      (recentUsers.results ?? []).map(async (u) => {
        try {
          const notifId = c.env.NOTIFICATION_HUB.idFromName(u.id);
          const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
          await notifStub.fetch('https://dummy/notify', {
            method: 'POST',
            body: presenceMsg,
          });
        } catch {}
      })
    );
  } catch {}

  return c.json({ success: true, is_online });
});

// GET /api/host/earnings
hostProtected.get('/earnings', async (c) => {
  const { sub } = c.get('user');
  const h = await c.env.DB.prepare(
    'SELECT id, total_earnings, total_minutes, rating, review_count FROM hosts WHERE user_id = ?'
  ).bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host' }, 403);
  // Bug 2 fix: use 'bonus' type (matches what call.ts inserts) and join for caller_name + call metadata
  const txs = await c.env.DB.prepare(
    `SELECT ct.id, ct.amount, ct.description, ct.created_at,
            cs.type as call_type, cs.duration_seconds, u.name as caller_name
     FROM coin_transactions ct
     JOIN call_sessions cs ON cs.id = ct.ref_id
     JOIN users u ON u.id = cs.caller_id
     WHERE cs.host_id = ? AND ct.type = 'bonus'
     ORDER BY ct.created_at DESC LIMIT 50`
  ).bind(h.id).all();
  // Withdrawal requests
  const withdrawals = await c.env.DB.prepare(
    'SELECT * FROM withdrawal_requests WHERE host_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(h.id).all();
  return c.json({ host: h, transactions: txs.results, withdrawals: withdrawals.results });
});

// GET /api/host/me — host profile for current user
hostProtected.get('/me', async (c) => {
  const { sub } = c.get('user');
  const h = await c.env.DB.prepare(
    `SELECT h.*, u.name, u.avatar_url, u.bio, u.email FROM hosts h
     JOIN users u ON u.id = h.user_id WHERE h.user_id = ?`
  ).bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host' }, 403);
  return c.json({ ...h, specialties: JSON.parse(h.specialties || '[]'), languages: JSON.parse(h.languages || '[]') });
});

export { host as hostsRouter, hostProtected as hostRouter };
