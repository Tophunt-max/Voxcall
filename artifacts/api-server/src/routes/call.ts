import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createCFCalls } from '../lib/cf-calls';
import type { Env, JWTPayload } from '../types';

const call = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
call.use('*', authMiddleware);

// POST /api/calls/initiate — start a call session
call.post('/initiate', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json<{ host_id: string; type?: 'audio' | 'video'; call_type?: 'audio' | 'video' }>();
  const callType = body.type || body.call_type || 'audio';
  const db = c.env.DB;

  const host = await db.prepare('SELECT id, coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id FROM hosts WHERE id = ? AND is_online = 1 AND is_active = 1').bind(body.host_id).first<any>();
  if (!host) return c.json({ error: 'Host not available' }, 404);

  const ratePerMin = callType === 'video'
    ? (host.video_coins_per_minute ?? host.coins_per_minute ?? 5)
    : (host.audio_coins_per_minute ?? host.coins_per_minute ?? 5);

  const caller = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  if (!caller || caller.coins < ratePerMin) {
    return c.json({ error: 'Insufficient coins' }, 402);
  }

  const cfCalls = createCFCalls(c.env);
  let cfSessionId = null;
  if (cfCalls) {
    try {
      const session = await cfCalls.createSession();
      cfSessionId = session.sessionId;
    } catch (e) {
      console.error('CF Calls error:', e);
    }
  }

  const sessionId = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO call_sessions (id, caller_id, host_id, type, status, cf_session_id, rate_per_minute) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, sub, body.host_id, callType, 'pending', cfSessionId, ratePerMin).run();

  try {
    const notifId = c.env.NOTIFICATION_HUB.idFromName(host.user_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'incoming_call', session_id: sessionId, caller_id: sub, call_type: callType }),
    });
  } catch {}

  const maxSeconds = Math.floor((caller.coins / ratePerMin) * 60);
  return c.json({ session_id: sessionId, cf_session_id: cfSessionId, host_coins_per_minute: ratePerMin, rate_per_minute: ratePerMin, call_type: callType, max_seconds: maxSeconds });
});

// POST /api/calls/end — flat route (mobile sends session_id in body)
call.post('/end', async (c) => {
  const { sub } = c.get('user');
  const { session_id, duration_seconds } = await c.req.json<{ session_id: string; duration_seconds?: number }>();
  const db = c.env.DB;

  const session = await db.prepare(
    'SELECT * FROM call_sessions WHERE id = ? AND (caller_id = ? OR host_id IN (SELECT id FROM hosts WHERE user_id = ?))'
  ).bind(session_id, sub, sub).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  if (session.status !== 'active' && session.status !== 'pending') {
    return c.json({ error: 'Call already ended' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const durationSec = duration_seconds ?? (session.started_at ? now - session.started_at : 0);
  const durationMin = Math.max(1, Math.ceil(durationSec / 60));

  const hostRow = await db.prepare('SELECT coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id, total_minutes, total_earnings FROM hosts WHERE id = ?').bind(session.host_id).first<any>();
  const effectiveRate = session.rate_per_minute
    ?? (session.type === 'video'
        ? (hostRow?.video_coins_per_minute ?? hostRow?.coins_per_minute ?? 5)
        : (hostRow?.audio_coins_per_minute ?? hostRow?.coins_per_minute ?? 5));
  // Charge if call was active OR if it was pending but had actual duration (auto-accepted in demo)
  const coinsCharged = (session.status === 'active' || (session.status === 'pending' && durationSec > 0))
    ? durationMin * effectiveRate
    : 0;
  const hostShare = Math.floor(coinsCharged * 0.7);

  const txs: any[] = [
    db.prepare('UPDATE call_sessions SET status = ?, ended_at = ?, duration_seconds = ?, coins_charged = ? WHERE id = ?')
      .bind('ended', now, durationSec, coinsCharged, session_id),
  ];
  if (coinsCharged > 0) {
    txs.push(
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').bind(coinsCharged, session.caller_id, coinsCharged),
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), session.caller_id, 'spend', -coinsCharged, `${session.type || 'audio'} call — ${durationMin} min`, session_id),
      db.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
        .bind(durationMin, hostShare, session.host_id),
    );
  }
  await db.batch(txs);

  if (session.cf_session_id) {
    const cfCalls = createCFCalls(c.env);
    try { await cfCalls?.closeSession(session.cf_session_id); } catch {}
  }

  return c.json({ success: true, duration_seconds: durationSec, coins_charged: coinsCharged, host_earnings: hostShare });
});

// POST /api/calls/rate — flat route (mobile sends session_id + rating in body)
call.post('/rate', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json<{ session_id: string; rating?: number; stars?: number; comment?: string }>();
  const starsVal = body.stars ?? body.rating ?? 5;
  const sessionId = body.session_id;
  const db = c.env.DB;

  const session = await db.prepare('SELECT host_id FROM call_sessions WHERE id = ? AND caller_id = ?').bind(sessionId, sub).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  await db.prepare('INSERT OR IGNORE INTO ratings (id, host_id, user_id, call_session_id, stars, comment) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), session.host_id, sub, sessionId, starsVal, body.comment ?? null).run();

  const avg = await db.prepare('SELECT AVG(stars) as avg, COUNT(*) as cnt FROM ratings WHERE host_id = ?').bind(session.host_id).first<any>();
  await db.prepare('UPDATE hosts SET rating = ?, review_count = ? WHERE id = ?').bind(
    Math.round((avg?.avg ?? starsVal) * 10) / 10, avg?.cnt ?? 1, session.host_id
  ).run();

  return c.json({ success: true });
});

// POST /api/calls/:id/answer
call.post('/:id/answer', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const { accepted } = await c.req.json<{ accepted: boolean }>();
  const db = c.env.DB;

  const session = await db.prepare('SELECT * FROM call_sessions WHERE id = ?').bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  if (!accepted) {
    await db.prepare('UPDATE call_sessions SET status = ?, ended_at = unixepoch() WHERE id = ?').bind('declined', sessionId).run();
    return c.json({ success: true, status: 'declined' });
  }

  const now = Math.floor(Date.now() / 1000);
  await db.prepare('UPDATE call_sessions SET status = ?, started_at = ? WHERE id = ?').bind('active', now, sessionId).run();
  return c.json({ success: true, status: 'active', cf_session_id: session.cf_session_id });
});

// POST /api/calls/:id/end (parameterized — kept for backward compat)
call.post('/:id/end', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const db = c.env.DB;

  const session = await db.prepare('SELECT * FROM call_sessions WHERE id = ?').bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  if (session.status !== 'active') return c.json({ error: 'Call not active' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const durationSec = now - (session.started_at || now);
  const durationMin = Math.max(1, Math.ceil(durationSec / 60));
  const hostRow = await db.prepare('SELECT coins_per_minute, user_id, total_minutes, total_earnings FROM hosts WHERE id = ?').bind(session.host_id).first<any>();
  const coinsCharged = durationMin * (hostRow?.coins_per_minute || 5);
  const hostShare = Math.floor(coinsCharged * 0.7);

  await db.batch([
    db.prepare('UPDATE call_sessions SET status = ?, ended_at = ?, duration_seconds = ?, coins_charged = ? WHERE id = ?')
      .bind('ended', now, durationSec, coinsCharged, sessionId),
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').bind(coinsCharged, session.caller_id, coinsCharged),
    db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), session.caller_id, 'spend', -coinsCharged, `${session.type} call — ${durationMin} min`, sessionId),
    db.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
      .bind(durationMin, hostShare, session.host_id),
  ]);

  if (session.cf_session_id) {
    const cfCalls = createCFCalls(c.env);
    try { await cfCalls?.closeSession(session.cf_session_id); } catch {}
  }

  return c.json({ success: true, duration_seconds: durationSec, coins_charged: coinsCharged, host_earnings: hostShare });
});

// GET /api/calls/active
call.get('/active', async (c) => {
  const { sub } = c.get('user');
  const session = await c.env.DB.prepare(
    `SELECT cs.*, h.display_name as host_name, u.avatar_url as host_avatar, h.coins_per_minute
     FROM call_sessions cs
     JOIN hosts h ON h.id = cs.host_id
     JOIN users u ON u.id = h.user_id
     WHERE cs.caller_id = ? AND cs.status IN ('pending', 'active')
     ORDER BY cs.created_at DESC LIMIT 1`
  ).bind(sub).first<any>();
  return c.json(session ?? null);
});

// GET /api/calls/history
call.get('/history', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    `SELECT cs.*, h.display_name as host_name, u.avatar_url as host_avatar
     FROM call_sessions cs JOIN hosts h ON h.id = cs.host_id JOIN users u ON u.id = h.user_id
     WHERE cs.caller_id = ? ORDER BY cs.created_at DESC LIMIT 50`
  ).bind(sub).all();
  return c.json(result.results);
});

// POST /api/calls/:id/rate (parameterized — kept for backward compat)
call.post('/:id/rate', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const body = await c.req.json<{ stars?: number; rating?: number; comment?: string }>();
  const starsVal = body.stars ?? body.rating ?? 5;
  const db = c.env.DB;
  const session = await db.prepare('SELECT host_id FROM call_sessions WHERE id = ? AND caller_id = ?').bind(sessionId, sub).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  await db.prepare('INSERT OR IGNORE INTO ratings (id, host_id, user_id, call_session_id, stars, comment) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), session.host_id, sub, sessionId, starsVal, body.comment ?? null).run();
  const avg = await db.prepare('SELECT AVG(stars) as avg, COUNT(*) as cnt FROM ratings WHERE host_id = ?').bind(session.host_id).first<any>();
  await db.prepare('UPDATE hosts SET rating = ?, review_count = ? WHERE id = ?').bind(
    Math.round((avg?.avg ?? starsVal) * 10) / 10, avg?.cnt ?? 1, session.host_id
  ).run();
  return c.json({ success: true });
});

// GET /api/calls/:id
call.get('/:id', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const session = await c.env.DB.prepare(
    `SELECT cs.*, h.display_name as host_name, u.avatar_url as host_avatar, h.coins_per_minute
     FROM call_sessions cs
     JOIN hosts h ON h.id = cs.host_id
     JOIN users u ON u.id = h.user_id
     WHERE cs.id = ? AND (cs.caller_id = ? OR h.user_id = ?)`
  ).bind(sessionId, sub, sub).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json(session);
});

// GET /api/calls/:id/cf-token
call.get('/:id/cf-token', async (c) => {
  const sessionId = c.req.param('id');
  const session = await c.env.DB.prepare('SELECT cf_session_id FROM call_sessions WHERE id = ?').bind(sessionId).first<any>();
  if (!session?.cf_session_id) return c.json({ error: 'No CF session' }, 404);
  return c.json({ cf_session_id: session.cf_session_id, app_id: c.env.CF_CALLS_APP_ID });
});

export default call;
