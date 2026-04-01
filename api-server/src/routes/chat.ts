import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const chat = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
chat.use('*', authMiddleware);

// GET /api/chat/rooms
chat.get('/rooms', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    `SELECT cr.*, 
      CASE WHEN cr.user_id = ? THEN hu.name ELSE cu.name END as other_name,
      CASE WHEN cr.user_id = ? THEN hu.avatar_url ELSE cu.avatar_url END as other_avatar
     FROM chat_rooms cr
     JOIN users cu ON cu.id = cr.user_id
     JOIN hosts h ON h.id = cr.host_id
     JOIN users hu ON hu.id = h.user_id
     WHERE cr.user_id = ? OR h.user_id = ?
     ORDER BY cr.last_message_at DESC LIMIT 50`
  ).bind(sub, sub, sub, sub).all();
  return c.json(result.results);
});

// POST /api/chat/rooms — create or get existing room (enforces call_first unlock)
chat.post('/rooms', async (c) => {
  const { sub } = c.get('user');
  const { host_id } = await c.req.json();
  const db = c.env.DB;

  // Check unlock policy
  const hostRow = await db.prepare('SELECT chat_unlock_policy FROM hosts WHERE id = ?').bind(host_id).first<any>();
  if (hostRow?.chat_unlock_policy === 'call_first') {
    const prevCall = await db.prepare(
      `SELECT id FROM call_sessions WHERE caller_id = ? AND host_id = ? AND status = 'ended' LIMIT 1`
    ).bind(sub, host_id).first<any>();
    if (!prevCall) {
      return c.json({ error: 'Chat locked. Call this host first to unlock chat.', code: 'CHAT_LOCKED' }, 403);
    }
  }

  let room = await db.prepare('SELECT * FROM chat_rooms WHERE user_id = ? AND host_id = ?').bind(sub, host_id).first<any>();
  if (!room) {
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO chat_rooms (id, user_id, host_id) VALUES (?, ?, ?)').bind(id, sub, host_id).run();
    room = { id, user_id: sub, host_id };
  }
  return c.json(room);
});

// GET /api/chat/rooms/:id/messages
chat.get('/rooms/:id/messages', async (c) => {
  const { id } = c.req.param();
  const { before, limit = '50' } = c.req.query();
  let query = 'SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.room_id = ?';
  const params: any[] = [id];
  if (before) { query += ' AND m.created_at < ?'; params.push(parseInt(before)); }
  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(result.results.reverse());
});

// POST /api/chat/rooms/:id/messages — send message (REST fallback)
chat.post('/rooms/:id/messages', async (c) => {
  const { sub } = c.get('user');
  const { id } = c.req.param();
  const { content, media_url, media_type } = await c.req.json();
  const db = c.env.DB;
  const msgId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.prepare('INSERT INTO messages (id, room_id, sender_id, content, media_url, media_type) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(msgId, id, sub, content ?? null, media_url ?? null, media_type ?? null),
    db.prepare('UPDATE chat_rooms SET last_message = ?, last_message_at = ? WHERE id = ?')
      .bind(content ?? '[media]', now, id),
  ]);
  return c.json({ id: msgId, room_id: id, sender_id: sub, content, created_at: now });
});

// WebSocket for chat — proxies to ChatRoom Durable Object
chat.get('/ws/:roomId', async (c) => {
  const { roomId } = c.req.param();
  const id = c.env.CHAT_ROOM.idFromName(roomId);
  const stub = c.env.CHAT_ROOM.get(id);
  return stub.fetch(c.req.raw);
});

export default chat;
