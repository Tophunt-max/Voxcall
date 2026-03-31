import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const host = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// GET /api/hosts/featured — top-rated/featured hosts (must be before /:id)
host.get('/featured', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
     JOIN users u ON u.id = h.user_id
     WHERE h.is_active = 1 AND h.rating >= 4.0
     ORDER BY h.is_top_rated DESC, h.rating DESC, h.total_minutes DESC LIMIT 10`
  ).all();
  return c.json(result.results.map((h: any) => ({
    ...h,
    specialties: JSON.parse(h.specialties || '[]'),
    languages: JSON.parse(h.languages || '[]'),
  })));
});

// GET /api/hosts — public list
host.get('/', async (c) => {
  const { search, topic, online, page = '1', limit = '20' } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let query = `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
    JOIN users u ON u.id = h.user_id WHERE h.is_active = 1`;
  const params: any[] = [];
  if (online === '1') { query += ' AND h.is_online = 1'; }
  if (search) { query += ' AND (u.name LIKE ? OR h.display_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY h.is_online DESC, h.rating DESC, h.total_minutes DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(result.results.map((h: any) => ({ ...h, specialties: JSON.parse(h.specialties || '[]'), languages: JSON.parse(h.languages || '[]') })));
});

// GET /api/hosts/:id — single host
host.get('/:id', async (c) => {
  const h = await c.env.DB.prepare(
    `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio FROM hosts h
     JOIN users u ON u.id = h.user_id WHERE h.id = ?`
  ).bind(c.req.param('id')).first<any>();
  if (!h) return c.json({ error: 'Host not found' }, 404);
  return c.json({ ...h, specialties: JSON.parse(h.specialties || '[]'), languages: JSON.parse(h.languages || '[]') });
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
  const allowed = ['display_name', 'specialties', 'languages', 'coins_per_minute'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key]);
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
  await c.env.DB.prepare('UPDATE hosts SET is_online = ?, updated_at = unixepoch() WHERE user_id = ?')
    .bind(is_online ? 1 : 0, sub).run();
  return c.json({ success: true, is_online });
});

// GET /api/host/earnings
hostProtected.get('/earnings', async (c) => {
  const { sub } = c.get('user');
  const h = await c.env.DB.prepare(
    'SELECT id, total_earnings, total_minutes, rating, review_count FROM hosts WHERE user_id = ?'
  ).bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host' }, 403);
  const txs = await c.env.DB.prepare(
    `SELECT ct.* FROM coin_transactions ct
     JOIN call_sessions cs ON cs.id = ct.ref_id
     WHERE cs.host_id = ? AND ct.type = 'earn'
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
