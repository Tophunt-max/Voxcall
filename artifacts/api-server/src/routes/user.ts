import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const user = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
user.use('*', authMiddleware);

// GET /api/user/me
user.get('/me', async (c) => {
  const { sub } = c.get('user');
  const me = await c.env.DB.prepare(
    'SELECT id, name, email, phone, avatar_url, gender, bio, coins, role, is_verified, created_at FROM users WHERE id = ?'
  ).bind(sub).first();
  if (!me) return c.json({ error: 'User not found' }, 404);
  return c.json(me);
});

// PATCH /api/user/me
user.patch('/me', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json();
  const allowed = ['name', 'phone', 'bio', 'gender', 'avatar_url', 'fcm_token'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const key of allowed) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(body[key]); }
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(sub);
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// GET /api/user/notifications
user.get('/notifications', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(sub).all();
  return c.json(result.results);
});

// PATCH /api/user/notifications/read
user.patch('/notifications/read', async (c) => {
  const { sub } = c.get('user');
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(sub).run();
  return c.json({ success: true });
});

// GET /api/user/coin-history
user.get('/coin-history', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(sub).all();
  return c.json(result.results);
});

// GET /api/user/favorites — get favorite hosts
user.get('/favorites', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    `SELECT uf.*, h.id as host_id, h.display_name, h.rating, h.coins_per_minute, h.is_online, h.specialties, h.languages,
            u.name, u.avatar_url, u.gender
     FROM user_favorites uf
     JOIN hosts h ON h.id = uf.host_id
     JOIN users u ON u.id = h.user_id
     WHERE uf.user_id = ? ORDER BY uf.created_at DESC`
  ).bind(sub).all();
  return c.json(result.results.map((r: any) => ({
    ...r,
    specialties: JSON.parse(r.specialties || '[]'),
    languages: JSON.parse(r.languages || '[]'),
  })));
});

// POST /api/user/favorites/:hostId — add favorite
user.post('/favorites/:hostId', async (c) => {
  const { sub } = c.get('user');
  const { hostId } = c.req.param();
  const db = c.env.DB;
  const host = await db.prepare('SELECT id FROM hosts WHERE id = ?').bind(hostId).first();
  if (!host) return c.json({ error: 'Host not found' }, 404);
  await db.prepare('INSERT OR IGNORE INTO user_favorites (id, user_id, host_id) VALUES (?, ?, ?)')
    .bind(crypto.randomUUID(), sub, hostId).run();
  return c.json({ success: true });
});

// DELETE /api/user/favorites/:hostId — remove favorite
user.delete('/favorites/:hostId', async (c) => {
  const { sub } = c.get('user');
  const { hostId } = c.req.param();
  await c.env.DB.prepare('DELETE FROM user_favorites WHERE user_id = ? AND host_id = ?').bind(sub, hostId).run();
  return c.json({ success: true });
});

// PATCH /api/user/notifications/:id/read — mark single notification read
user.patch('/notifications/:id/read', async (c) => {
  const { sub } = c.get('user');
  const { id } = c.req.param();
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(id, sub).run();
  return c.json({ success: true });
});

// GET /api/user/referral — get (or auto-generate) user's referral code + stats
user.get('/referral', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  let ref = await db.prepare('SELECT * FROM referral_codes WHERE user_id = ?').bind(sub).first<any>();
  if (!ref) {
    const code = sub.slice(0, 4).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO referral_codes (id, user_id, code) VALUES (?, ?, ?)').bind(id, sub, code).run();
    ref = { id, user_id: sub, code, created_at: Date.now() };
  }
  const stats = await db.prepare(
    'SELECT COUNT(*) as referred, COALESCE(SUM(coins_given),0) as coins_earned FROM referral_uses WHERE referrer_id = ?'
  ).bind(sub).first<any>();
  return c.json({ code: ref.code, referred: Number(stats?.referred ?? 0), coins_earned: Number(stats?.coins_earned ?? 0) });
});

// POST /api/user/report — submit a content/user report
user.post('/report', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const { reported_user_id, reported_user, reason, category, reported_type } = await c.req.json();
  if (!reason) return c.json({ error: 'reason is required' }, 400);
  if (!reported_user_id) return c.json({ error: 'reported_user_id is required' }, 400);
  const reporter = await db.prepare('SELECT name, phone, email FROM users WHERE id = ?').bind(sub).first<any>();
  const existing = await db.prepare(
    'SELECT id FROM content_reports WHERE reporter_id = ? AND reported_user_id = ? AND status = ? AND created_at > unixepoch() - 86400'
  ).bind(sub, reported_user_id, 'pending').first<any>();
  if (existing) return c.json({ error: 'You have already reported this user. Please wait for review.' }, 429);
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO content_reports (id, reporter_id, reporter_name, reported_user_id, reported_user, reported_type, reason, category, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(id, sub, reporter?.name ?? '', reported_user_id, reported_user ?? '', reported_type ?? 'user', reason, category ?? 'other').run();
  return c.json({ success: true, id });
});

// POST /api/user/become-host
user.post('/become-host', async (c) => {
  const { sub, name } = c.get('user');
  const { specialties, languages, bio } = await c.req.json();
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first();
  if (existing) return c.json({ error: 'Already a host' }, 409);
  const hostId = `host_${sub}`;
  await db.batch([
    db.prepare('INSERT INTO hosts (id, user_id, display_name, specialties, languages) VALUES (?, ?, ?, ?, ?)')
      .bind(hostId, sub, name, JSON.stringify(specialties ?? []), JSON.stringify(languages ?? ['English'])),
    db.prepare('UPDATE users SET role = ?, bio = ?, updated_at = unixepoch() WHERE id = ?')
      .bind('host', bio ?? '', sub),
  ]);
  return c.json({ success: true, host_id: hostId }, 201);
});

export default user;
