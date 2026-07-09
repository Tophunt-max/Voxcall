import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { sendFCMPush } from '../lib/fcm';
import { checkRateLimit } from '../lib/rateLimit';
import { getVipStatus } from '../lib/vip';
import type { Env, JWTPayload } from '../types';

// Fire-and-forget relay of a real-time event to a user's NotificationHub.
// Used for live message delivery + read receipts (mirrors the typing relay).
async function relayToUser(env: Env, userId: string, payload: Record<string, unknown>): Promise<void> {
  if (!userId) return;
  try {
    const stub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(userId));
    await stub.fetch('https://dummy/notify', { method: 'POST', body: JSON.stringify(payload) });
  } catch (e) {
    console.warn('[chat] hub relay failed:', e);
  }
}

const chat = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
chat.use('*', authMiddleware);

// GET /api/chat/rooms
//
// Returns the user's chat rooms with the OTHER participant's display name,
// avatar, online status and user_id. The presence flag (`other_is_online`)
// is the source of truth for the chat header status pill — previously the
// client hardcoded "Online" because this endpoint did not expose it, which
// caused the fake "Online" bug for offline hosts.
chat.get('/rooms', async (c) => {
  const { sub } = c.get('user');
  // Cursor pagination: ?before=<last_message_at> returns older rooms; ?limit caps size.
  const { before, limit } = c.req.query();
  const lim = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 100);
  const cursorClause = before ? ' AND cr.last_message_at < ?' : '';
  const params: any[] = [sub, sub, sub, sub, sub, sub, sub];
  if (before) params.push(parseInt(before, 10) || 0);
  params.push(lim);
  const result = await c.env.DB.prepare(
    `SELECT cr.*,
      CASE WHEN cr.user_id = ? THEN hu.name ELSE cu.name END as other_name,
      CASE WHEN cr.user_id = ? THEN hu.avatar_url ELSE cu.avatar_url END as other_avatar,
      -- The "other" party's user_id (users.id). Used by the chat header to
      -- match presence:update events from the WebSocket. Only hosts have an
      -- is_online column; for host-side rows (caller is the host) the other
      -- party is a regular user and we surface 0 since users don't track it.
      CASE WHEN cr.user_id = ? THEN h.user_id ELSE cr.user_id END as other_user_id,
      CASE WHEN cr.user_id = ? THEN COALESCE(h.is_online, 0) ELSE 0 END as other_is_online,
      h.user_id as host_user_id,
      COALESCE(h.is_online, 0) as host_is_online,
      -- Unread = messages in this room NOT sent by the caller and not yet read.
      -- Drives the conversation-list badge + app icon count (source of truth =
      -- messages.is_read, so it can't drift from a separate counter).
      (SELECT COUNT(*) FROM messages m
        WHERE m.room_id = cr.id AND m.sender_id != ? AND m.is_read = 0) as unread_count
     FROM chat_rooms cr
     JOIN users cu ON cu.id = cr.user_id
     JOIN hosts h ON h.id = cr.host_id
     JOIN users hu ON hu.id = h.user_id
     WHERE (cr.user_id = ? OR h.user_id = ?)${cursorClause}
     ORDER BY cr.last_message_at DESC LIMIT ?`
  ).bind(...params).all();
  return c.json(result.results);
});

// POST /api/chat/rooms — create or get existing room (enforces call_first unlock)
chat.post('/rooms', async (c) => {
  const { sub } = c.get('user');
  const { host_id } = await c.req.json();
  const db = c.env.DB;

  // Check unlock policy
  const hostRow = await db.prepare('SELECT chat_unlock_policy FROM hosts WHERE id = ?').bind(host_id).first<any>();
  // FIX #17: previously a missing host_id silently fell through to INSERT,
  // creating an orphan chat_room with no actual host. Reject early.
  if (!hostRow) return c.json({ error: 'Host not found' }, 404);
  if (hostRow?.chat_unlock_policy === 'call_first') {
    const prevCall = await db.prepare(
      `SELECT id FROM call_sessions WHERE caller_id = ? AND host_id = ? AND status = 'ended' LIMIT 1`
    ).bind(sub, host_id).first<any>();
    if (!prevCall) {
      // VIP perk: active VIPs with chat_unlock can DM any host without calling first.
      const vip = await getVipStatus(db, sub);
      if (!vip.chatUnlock) {
        return c.json({ error: 'Chat locked. Call this host first to unlock chat.', code: 'CHAT_LOCKED' }, 403);
      }
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
  const { sub } = c.get('user');
  const { id } = c.req.param();
  const { before, limit = '50' } = c.req.query();
  const room = await c.env.DB.prepare(
    `SELECT cr.id FROM chat_rooms cr
     JOIN hosts h ON h.id = cr.host_id
     WHERE cr.id = ? AND (cr.user_id = ? OR h.user_id = ?)`
  ).bind(id, sub, sub).first<any>();
  if (!room) return c.json({ error: 'Access denied or room not found' }, 403);
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
  const { sub, name: senderName } = c.get('user');
  const { id } = c.req.param();
  const { content, media_url, media_type } = await c.req.json();
  const db = c.env.DB;

  // Anti-spam: cap message sends per user (fail-open if rate_limits is missing).
  const rl = await checkRateLimit(db, `chat-send:${sub}`, 20, 10);
  if (rl.limited) {
    return c.json({ error: 'Too many messages. Please slow down.', code: 'RATE_LIMITED' }, 429);
  }

  // SECURITY FIX: Verify the authenticated user is a participant of this room
  // Without this check, any user can send messages to any room by guessing the ID
  const roomAccess = await db.prepare(
    'SELECT cr.id FROM chat_rooms cr JOIN hosts h ON h.id = cr.host_id WHERE cr.id = ? AND (cr.user_id = ? OR h.user_id = ?)'
  ).bind(id, sub, sub).first<any>();
  if (!roomAccess) return c.json({ error: 'Room not found or access denied' }, 403);

  // Block check — if either party has blocked the other, deny the message.
  // Best-effort: table missing (migration 0036 not applied) → skip.
  try {
    const room = await db.prepare(
      'SELECT cr.user_id, h.user_id as host_user_id FROM chat_rooms cr JOIN hosts h ON h.id = cr.host_id WHERE cr.id = ?'
    ).bind(id).first<{ user_id: string; host_user_id: string }>();
    if (room) {
      const otherId = room.user_id === sub ? room.host_user_id : room.user_id;
      const blocked = await db.prepare(
        'SELECT 1 as ok FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1'
      ).bind(otherId, sub, sub, otherId).first<{ ok: number }>();
      if (blocked) return c.json({ error: 'Unable to send message' }, 403);
    }
  } catch (e: any) {
    if (!/no such table/i.test(String(e?.message || ''))) {
      console.warn('[chat/messages] block check failed:', e);
    }
  }

  // Validate message content
  if (!content && !media_url) return c.json({ error: 'Message content or media is required' }, 400);
  if (content && content.length > 5000) return c.json({ error: 'Message too long (max 5000 chars)' }, 400);

  const msgId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db.prepare('INSERT INTO messages (id, room_id, sender_id, content, media_url, media_type) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(msgId, id, sub, content ?? null, media_url ?? null, media_type ?? null),
    db.prepare('UPDATE chat_rooms SET last_message = ?, last_message_at = ? WHERE id = ?')
      .bind(content ?? '[media]', now, id),
  ]);

  // Push notification to the other party in the room
  try {
    const room = await db
      .prepare('SELECT cr.user_id, h.user_id as host_user_id FROM chat_rooms cr JOIN hosts h ON h.id = cr.host_id WHERE cr.id = ?')
      .bind(id)
      .first<{ user_id: string; host_user_id: string }>();
    if (room) {
      const recipientId = room.user_id === sub ? room.host_user_id : room.user_id;

      // LIVE in-app delivery: push the full message to the recipient's
      // NotificationHub so an open chat thread renders it instantly (the
      // client maps type 'chat_message' -> MESSAGE_RECEIVED). This is what
      // makes the chat real-time instead of "push + reload".
      await relayToUser(c.env, recipientId, {
        type: 'chat_message',
        room_id: id,
        id: msgId,
        sender_id: sub,
        sender_name: senderName || 'User',
        content: content ?? null,
        media_url: media_url ?? null,
        media_type: media_type ?? null,
        created_at: now,
      });

      const recipient = await db
        .prepare('SELECT fcm_token FROM users WHERE id = ?')
        .bind(recipientId)
        .first<{ fcm_token: string }>();
      if (recipient?.fcm_token) {
        const pushBody = media_url ? '[Media]' : (content ?? '');
        await sendFCMPush(
          c.env.FIREBASE_SERVICE_ACCOUNT,
          recipient.fcm_token,
          senderName || 'New Message',
          pushBody,
          { type: 'chat_message', room_id: id }
        );
      }
    }
  } catch (e) {
    // Push delivery is best-effort: a push failure must never fail the
    // message send (the message is already persisted via db.batch above).
    // We do log so production FCM credential / token issues are visible.
    console.warn('[chat/messages] FCM push notify failed:', e);
  }

  return c.json({ id: msgId, room_id: id, sender_id: sub, content, created_at: now });
});

// POST /api/chat/rooms/:id/typing — typing indicator relay
//
// Broadcasts an ephemeral typing event to the OTHER participant via their
// NotificationHub so the chat header can show "typing…". The signal is
// fire-and-forget — never persisted, never queued, never pushed to FCM.
// The client is expected to debounce: emit `is_typing=true` on first
// keystroke and `is_typing=false` on idle (stop typing) or message send.
chat.post('/rooms/:id/typing', async (c) => {
  const { sub, name: senderName } = c.get('user');
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({})) as { is_typing?: boolean };
  const isTyping = !!body.is_typing;
  const db = c.env.DB;

  // Same access check as send-message — never relay typing for a room the
  // caller doesn't belong to.
  const room = await db
    .prepare(
      `SELECT cr.user_id as user_id, h.user_id as host_user_id
       FROM chat_rooms cr JOIN hosts h ON h.id = cr.host_id
       WHERE cr.id = ? AND (cr.user_id = ? OR h.user_id = ?)`
    )
    .bind(id, sub, sub)
    .first<{ user_id: string; host_user_id: string }>();
  if (!room) return c.json({ error: 'Room not found or access denied' }, 403);

  const recipientId = room.user_id === sub ? room.host_user_id : room.user_id;
  // No self-notify — typing events go to the OTHER party only.
  if (recipientId && recipientId !== sub) {
    try {
      const stub = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(recipientId));
      await stub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({
          type: 'chat_typing',
          room_id: id,
          user_id: sub,
          sender_name: senderName ?? 'User',
          is_typing: isTyping,
        }),
      });
    } catch (e) {
      // Typing is best-effort; don't fail the call if the hub is unreachable.
      console.warn('[chat/typing] relay failed:', e);
    }
  }

  return c.json({ success: true });
});

// POST /api/chat/rooms/:id/read — mark the OTHER party's messages as read.
//
// Sets messages.is_read=1 for every message in the room NOT sent by the
// caller, then relays a `chat_read` receipt to the other party so their sent
// bubbles flip to "Seen" in real time. Read state is the single source of
// truth for the conversation unread badge.
chat.post('/rooms/:id/read', async (c) => {
  const { sub } = c.get('user');
  const { id } = c.req.param();
  const db = c.env.DB;

  const room = await db.prepare(
    `SELECT cr.user_id as user_id, h.user_id as host_user_id
     FROM chat_rooms cr JOIN hosts h ON h.id = cr.host_id
     WHERE cr.id = ? AND (cr.user_id = ? OR h.user_id = ?)`
  ).bind(id, sub, sub).first<{ user_id: string; host_user_id: string }>();
  if (!room) return c.json({ error: 'Room not found or access denied' }, 403);

  const res = await db.prepare(
    'UPDATE messages SET is_read = 1 WHERE room_id = ? AND sender_id != ? AND is_read = 0'
  ).bind(id, sub).run();
  const marked = res.meta?.changes ?? 0;

  if (marked > 0) {
    const otherId = room.user_id === sub ? room.host_user_id : room.user_id;
    if (otherId && otherId !== sub) {
      await relayToUser(c.env, otherId, { type: 'chat_read', room_id: id, reader_id: sub });
    }
  }
  return c.json({ success: true, marked });
});

// POST /api/chat/rooms/:id/messages/:msgId/report — report an abusive message.
//
// Files into the shared content_reports queue (same one the admin panel's
// Content Moderation page + pending-count badge read), so chat abuse is
// actioned through the existing moderation workflow.
chat.post('/rooms/:id/messages/:msgId/report', async (c) => {
  const { sub, name: reporterName } = c.get('user');
  const { id, msgId } = c.req.param();
  const body = await c.req.json().catch(() => ({})) as { reason?: string; category?: string };
  const db = c.env.DB;

  const room = await db.prepare(
    `SELECT cr.id FROM chat_rooms cr JOIN hosts h ON h.id = cr.host_id
     WHERE cr.id = ? AND (cr.user_id = ? OR h.user_id = ?)`
  ).bind(id, sub, sub).first<any>();
  if (!room) return c.json({ error: 'Room not found or access denied' }, 403);

  const msg = await db.prepare(
    'SELECT id, sender_id, content, media_url FROM messages WHERE id = ? AND room_id = ?'
  ).bind(msgId, id).first<{ id: string; sender_id: string; content: string | null; media_url: string | null }>();
  if (!msg) return c.json({ error: 'Message not found' }, 404);
  if (msg.sender_id === sub) return c.json({ error: 'You cannot report your own message' }, 400);

  const evidence = JSON.stringify({
    room_id: id, message_id: msgId, content: msg.content ?? null, media_url: msg.media_url ?? null,
  });
  await db.prepare(
    `INSERT INTO content_reports (id, reporter_id, reporter_name, reported_user_id, reported_type, reason, category, evidence)
     VALUES (?, ?, ?, ?, 'chat_message', ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), sub, reporterName ?? null, msg.sender_id,
    (body.reason ?? 'Inappropriate message').slice(0, 500),
    (body.category ?? 'harassment').slice(0, 50),
    evidence,
  ).run();

  return c.json({ success: true });
});

// PATCH /api/chat/rooms/:id/messages/:msgId — edit your own text message.
// Allowed within a 15-minute window, text only (media can't be edited).
chat.patch('/rooms/:id/messages/:msgId', async (c) => {
  const { sub } = c.get('user');
  const { id, msgId } = c.req.param();
  const body = await c.req.json().catch(() => ({})) as { content?: string };
  const content = (body.content ?? '').trim();
  const db = c.env.DB;

  if (!content) return c.json({ error: 'Message content is required' }, 400);
  if (content.length > 5000) return c.json({ error: 'Message too long (max 5000 chars)' }, 400);

  const msg = await db.prepare(
    `SELECT m.sender_id, m.media_url, m.is_deleted, m.created_at, cr.user_id, h.user_id as host_user_id
     FROM messages m JOIN chat_rooms cr ON cr.id = m.room_id JOIN hosts h ON h.id = cr.host_id
     WHERE m.id = ? AND m.room_id = ?`
  ).bind(msgId, id).first<any>();
  if (!msg) return c.json({ error: 'Message not found' }, 404);
  if (msg.sender_id !== sub) return c.json({ error: 'You can only edit your own messages' }, 403);
  if (msg.is_deleted) return c.json({ error: 'Cannot edit a deleted message' }, 400);
  if (msg.media_url) return c.json({ error: 'Media messages cannot be edited' }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (now - (Number(msg.created_at) || now) > 15 * 60) {
    return c.json({ error: 'Edit window has passed', code: 'EDIT_WINDOW' }, 400);
  }

  await db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?')
    .bind(content, now, msgId).run();

  const otherId = msg.user_id === sub ? msg.host_user_id : msg.user_id;
  await relayToUser(c.env, otherId, {
    type: 'chat_message_edited', room_id: id, id: msgId, content, edited_at: now,
  });
  return c.json({ success: true, edited_at: now });
});

// DELETE /api/chat/rooms/:id/messages/:msgId — soft-delete your own message
// ("delete for everyone"). The row is kept (content blanked) so the client can
// render a "This message was deleted" placeholder in both threads.
chat.delete('/rooms/:id/messages/:msgId', async (c) => {
  const { sub } = c.get('user');
  const { id, msgId } = c.req.param();
  const db = c.env.DB;

  const msg = await db.prepare(
    `SELECT m.sender_id, cr.user_id, h.user_id as host_user_id
     FROM messages m JOIN chat_rooms cr ON cr.id = m.room_id JOIN hosts h ON h.id = cr.host_id
     WHERE m.id = ? AND m.room_id = ?`
  ).bind(msgId, id).first<any>();
  if (!msg) return c.json({ error: 'Message not found' }, 404);
  if (msg.sender_id !== sub) return c.json({ error: 'You can only delete your own messages' }, 403);

  await db.prepare(
    "UPDATE messages SET is_deleted = 1, content = '', media_url = NULL, media_type = NULL WHERE id = ?"
  ).bind(msgId).run();

  const otherId = msg.user_id === sub ? msg.host_user_id : msg.user_id;
  await relayToUser(c.env, otherId, { type: 'chat_message_deleted', room_id: id, id: msgId });
  return c.json({ success: true });
});

// WebSocket for chat — proxies to ChatRoom Durable Object
chat.get('/ws/:roomId', async (c) => {
  const { sub: userId, name: userName } = c.get('user');
  const { roomId } = c.req.param();

  // Bug 4 Fix: verify room access before connecting
  const db = c.env.DB;
  const room = await db.prepare(
    `SELECT cr.id FROM chat_rooms cr
     JOIN hosts h ON h.id = cr.host_id
     WHERE cr.id = ? AND (cr.user_id = ? OR h.user_id = ?)`
  ).bind(roomId, userId, userId).first<any>();
  if (!room) return c.json({ error: 'Access denied or room not found' }, 403);

  const id = c.env.CHAT_ROOM.idFromName(roomId);
  const stub = c.env.CHAT_ROOM.get(id);

  // Pass verified user identity via trusted Worker headers (cannot be spoofed by client)
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-CF-User-Id', userId);
  headers.set('X-CF-User-Name', userName || 'User');
  const proxied = new Request(c.req.raw.url, { ...c.req.raw, headers });
  return stub.fetch(proxied);
});

export default chat;
