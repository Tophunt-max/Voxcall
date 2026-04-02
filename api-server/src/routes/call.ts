import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createCFCalls } from '../lib/cf-calls';
import { sendFCMPush } from '../lib/fcm';
import type { Env, JWTPayload } from '../types';

const call = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
call.use('*', authMiddleware);

call.post('/initiate', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  // Rate limit: max 5 call initiations per user per minute to prevent host spam
  const rlKey = `rl:initiate:${sub}:${Math.floor(Date.now() / 60000)}`;
  try {
    const rlRow = await db.prepare('SELECT attempts, window_reset FROM rate_limits WHERE id = ?').bind(rlKey).first<any>();
    const now = Math.floor(Date.now() / 1000);
    if (rlRow && rlRow.window_reset > now && rlRow.attempts >= 5) {
      return c.json({ error: 'Too many call requests. Please wait before trying again.' }, 429);
    }
    if (rlRow && rlRow.window_reset > now) {
      await db.prepare('UPDATE rate_limits SET attempts = attempts + 1 WHERE id = ?').bind(rlKey).run();
    } else {
      await db.prepare('INSERT OR REPLACE INTO rate_limits (id, attempts, window_reset) VALUES (?, 1, ?)').bind(rlKey, now + 60).run();
    }
  } catch { /* rate limit table may not exist — don't block */ }

  const body = await c.req.json<{ host_id: string; type?: 'audio' | 'video'; call_type?: 'audio' | 'video' }>();
  const callType = body.type || body.call_type || 'audio';

  const host = await db.prepare('SELECT id, coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id FROM hosts WHERE id = ? AND is_online = 1 AND is_active = 1').bind(body.host_id).first<any>();
  if (!host) return c.json({ error: 'Host not available' }, 404);

  const ratePerMin = callType === 'video'
    ? (host.video_coins_per_minute ?? host.coins_per_minute ?? 5)
    : (host.audio_coins_per_minute ?? host.coins_per_minute ?? 5);

  const caller = await db.prepare('SELECT coins, name FROM users WHERE id = ?').bind(sub).first<any>();
  if (!caller || caller.coins < ratePerMin) {
    return c.json({ error: 'Insufficient coins' }, 402);
  }

  const cfCalls = createCFCalls(c.env);
  let cfCallerSessionId: string | null = null;
  let cfHostSessionId: string | null = null;
  if (cfCalls) {
    try {
      const callerSession = await cfCalls.createSession();
      cfCallerSessionId = callerSession.sessionId;
      const hostSession = await cfCalls.createSession();
      cfHostSessionId = hostSession.sessionId;
    } catch (e) {
      console.error('CF Calls session creation error:', e);
    }
  }

  const sessionId = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO call_sessions (id, caller_id, host_id, type, status, cf_session_id, cf_host_session_id, rate_per_minute) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, sub, body.host_id, callType, 'pending', cfCallerSessionId, cfHostSessionId, ratePerMin).run();

  // WebSocket notification (foreground/background)
  // Fix H2: include caller_name so host sees caller's name instead of "Incoming Call"
  try {
    const notifId = c.env.NOTIFICATION_HUB.idFromName(host.user_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'incoming_call', session_id: sessionId, caller_id: sub, call_type: callType, caller_name: caller.name ?? 'Caller' }),
    });
  } catch {}

  // Expo Push Notification (app killed / background)
  try {
    const hostUser = await db
      .prepare('SELECT fcm_token FROM users WHERE id = ?')
      .bind(host.user_id)
      .first<{ fcm_token: string }>();
    if (hostUser?.fcm_token) {
      const callLabel = callType === 'video' ? 'Video Call' : 'Audio Call';
      await sendFCMPush(
        c.env.FIREBASE_SERVICE_ACCOUNT,
        hostUser.fcm_token,
        `Incoming ${callLabel}`,
        `${caller.name || 'Someone'} is calling you`,
        { type: 'incoming_call', session_id: sessionId, call_type: callType, caller_id: sub }
      );
    }
  } catch {}

  const maxSeconds = Math.floor((caller.coins / ratePerMin) * 60);
  return c.json({
    session_id: sessionId,
    cf_session_id: cfCallerSessionId,
    cf_host_session_id: cfHostSessionId,
    host_coins_per_minute: ratePerMin,
    rate_per_minute: ratePerMin,
    call_type: callType,
    max_seconds: maxSeconds,
  });
});

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

  // BUG 1 FIX: Atomic status update — prevents double charging on concurrent /end calls
  const atomicUpdate = await db.prepare(
    "UPDATE call_sessions SET status = 'processing' WHERE id = ? AND status IN ('active', 'pending')"
  ).bind(session_id).run();
  if (!atomicUpdate.meta?.changes || atomicUpdate.meta.changes === 0) {
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
      // Bug 2 fix: insert earn transaction for host so wallet earnings show correctly
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), hostRow?.user_id, 'bonus', hostShare, `${session.type || 'audio'} call — ${durationMin} min`, session_id),
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(hostShare, hostRow?.user_id),
    );
  }
  await db.batch(txs);

  // Fix NEW-1 + NEW-2: notify the OTHER party that call ended (cancel/end)
  try {
    const isCallerEnding = session.caller_id === sub;
    const otherUserId = isCallerEnding ? hostRow?.user_id : session.caller_id;
    if (otherUserId) {
      const notifId = c.env.NOTIFICATION_HUB.idFromName(otherUserId);
      const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
      await notifStub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'call_ended', session_id: session_id }),
      });
    }
  } catch {}

  const cfCalls = createCFCalls(c.env);
  if (cfCalls) {
    if (session.cf_session_id) { try { await cfCalls.closeSession(session.cf_session_id); } catch {} }
    if (session.cf_host_session_id) { try { await cfCalls.closeSession(session.cf_host_session_id); } catch {} }
  }

  return c.json({ success: true, duration_seconds: durationSec, coins_charged: coinsCharged, host_earnings: hostShare });
});

call.post('/rate', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json<{ session_id: string; rating?: number; stars?: number; comment?: string }>();
  const starsVal = Math.min(5, Math.max(1, Number(body.stars ?? body.rating ?? 5)));
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

call.post('/:id/answer', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const { accepted } = await c.req.json<{ accepted: boolean }>();
  const db = c.env.DB;

  const session = await db.prepare('SELECT * FROM call_sessions WHERE id = ?').bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  // Bug 13 fix: verify the requester is actually the host of this session
  const hostCheck = await db.prepare('SELECT id FROM hosts WHERE id = ? AND user_id = ?').bind(session.host_id, sub).first<any>();
  if (!hostCheck) return c.json({ error: 'Not authorized — you are not the host of this session' }, 403);

  if (!accepted) {
    await db.prepare('UPDATE call_sessions SET status = ?, ended_at = unixepoch() WHERE id = ?').bind('declined', sessionId).run();
    // Bug 3 fix: notify caller that call was declined
    try {
      const notifId = c.env.NOTIFICATION_HUB.idFromName(session.caller_id);
      const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
      await notifStub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'call_declined', session_id: sessionId }),
      });
    } catch {}
    return c.json({ success: true, status: 'declined' });
  }

  const now = Math.floor(Date.now() / 1000);
  await db.prepare('UPDATE call_sessions SET status = ?, started_at = ? WHERE id = ?').bind('active', now, sessionId).run();

  // Bug 3 fix: notify caller that call was accepted
  try {
    const notifId = c.env.NOTIFICATION_HUB.idFromName(session.caller_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'call_accepted', session_id: sessionId }),
    });
  } catch {}

  return c.json({
    success: true,
    status: 'active',
    cf_session_id: session.cf_session_id,
    cf_host_session_id: session.cf_host_session_id,
  });
});

async function deriveRole(db: any, sessionId: string, userId: string): Promise<{ session: any; role: 'caller' | 'host' } | null> {
  const session = await db.prepare(
    `SELECT cs.*, h.user_id as host_user_id FROM call_sessions cs
     LEFT JOIN hosts h ON h.id = cs.host_id
     WHERE cs.id = ?`
  ).bind(sessionId).first<any>();
  if (!session) return null;
  if (session.caller_id === userId) return { session, role: 'caller' };
  if (session.host_user_id === userId) return { session, role: 'host' };
  return null;
}

call.post('/:id/sdp/push', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const body = await c.req.json<{
    sdp: string;
    type: string;
    tracks: Array<{ mid: string; trackName: string }>;
  }>();
  const db = c.env.DB;

  const result = await deriveRole(db, sessionId, sub);
  if (!result) return c.json({ error: 'Session not found or access denied' }, 403);
  const { session, role } = result;

  const cfCalls = createCFCalls(c.env);
  if (!cfCalls) return c.json({ error: 'CF Calls not configured' }, 500);

  const cfSessionId = role === 'host' ? session.cf_host_session_id : session.cf_session_id;
  if (!cfSessionId) return c.json({ error: 'No CF session for this role' }, 400);

  try {
    const pushResult = await cfCalls.pushTracks(
      cfSessionId,
      { type: body.type, sdp: body.sdp },
      body.tracks.map(t => ({ location: 'local' as const, mid: t.mid, trackName: t.trackName }))
    );
    return c.json({
      answer: pushResult.answer,
      tracks: pushResult.tracks,
      role,
    });
  } catch (e: any) {
    console.error('pushTracks error:', e);
    return c.json({ error: e.message || 'Failed to push tracks' }, 500);
  }
});

call.post('/:id/sdp/pull', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const body = await c.req.json<{
    trackNames: string[];
  }>();
  const db = c.env.DB;

  const result = await deriveRole(db, sessionId, sub);
  if (!result) return c.json({ error: 'Session not found or access denied' }, 403);
  const { session, role } = result;

  const cfCalls = createCFCalls(c.env);
  if (!cfCalls) return c.json({ error: 'CF Calls not configured' }, 500);

  const mySessionId = role === 'host' ? session.cf_host_session_id : session.cf_session_id;
  const remoteSessionId = role === 'host' ? session.cf_session_id : session.cf_host_session_id;

  if (!mySessionId || !remoteSessionId) return c.json({ error: 'Missing CF session IDs' }, 400);

  try {
    const pullResult = await cfCalls.pullTracks(mySessionId, remoteSessionId, body.trackNames);
    return c.json({
      offer: pullResult.offer,
      tracks: pullResult.tracks,
      role,
    });
  } catch (e: any) {
    console.error('pullTracks error:', e);
    return c.json({ error: e.message || 'Failed to pull tracks' }, 500);
  }
});

call.post('/:id/sdp/answer', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const body = await c.req.json<{
    sdp: string;
    type: string;
  }>();
  const db = c.env.DB;

  const result = await deriveRole(db, sessionId, sub);
  if (!result) return c.json({ error: 'Session not found or access denied' }, 403);
  const { session, role } = result;

  const cfCalls = createCFCalls(c.env);
  if (!cfCalls) return c.json({ error: 'CF Calls not configured' }, 500);

  const mySessionId = role === 'host' ? session.cf_host_session_id : session.cf_session_id;
  if (!mySessionId) return c.json({ error: 'No CF session' }, 400);

  try {
    await cfCalls.sendAnswerForPull(mySessionId, { type: body.type, sdp: body.sdp });
    return c.json({ success: true });
  } catch (e: any) {
    console.error('sendAnswer error:', e);
    return c.json({ error: e.message || 'Failed to send answer' }, 500);
  }
});

call.post('/:id/end', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const db = c.env.DB;

  const session = await db.prepare('SELECT * FROM call_sessions WHERE id = ?').bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  if (session.status !== 'active' && session.status !== 'pending') return c.json({ error: 'Call already ended' }, 400);

  const atomicUpdate = await db.prepare(
    "UPDATE call_sessions SET status = 'processing' WHERE id = ? AND status IN ('active', 'pending')"
  ).bind(sessionId).run();
  if (!atomicUpdate.meta?.changes || atomicUpdate.meta.changes === 0) {
    return c.json({ error: 'Call already ended' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const durationSec = now - (session.started_at || now);
  const durationMin = Math.max(1, Math.ceil(durationSec / 60));
  const hostRow = await db.prepare('SELECT coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id, total_minutes, total_earnings FROM hosts WHERE id = ?').bind(session.host_id).first<any>();
  const effectiveRate = session.rate_per_minute ?? (session.type === 'video'
    ? (hostRow?.video_coins_per_minute ?? hostRow?.coins_per_minute ?? 5)
    : (hostRow?.audio_coins_per_minute ?? hostRow?.coins_per_minute ?? 5));
  // Bug 14 fix: only charge if call was actually active
  const coinsCharged = session.status === 'active' ? durationMin * effectiveRate : 0;
  const hostShare = Math.floor(coinsCharged * 0.7);

  const batchOps: any[] = [
    db.prepare('UPDATE call_sessions SET status = ?, ended_at = ?, duration_seconds = ?, coins_charged = ? WHERE id = ?')
      .bind('ended', now, durationSec, coinsCharged, sessionId),
  ];
  if (coinsCharged > 0) {
    batchOps.push(
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').bind(coinsCharged, session.caller_id, coinsCharged),
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), session.caller_id, 'spend', -coinsCharged, `${session.type} call — ${durationMin} min`, sessionId),
      db.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
        .bind(durationMin, hostShare, session.host_id),
      // Bug 2+14 fix: earn transaction for host
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), hostRow?.user_id, 'bonus', hostShare, `${session.type} call — ${durationMin} min`, sessionId),
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(hostShare, hostRow?.user_id),
    );
  }
  await db.batch(batchOps);

  // Fix NEW-1 + NEW-2: notify the OTHER party that call ended
  try {
    const isCallerEnding = session.caller_id === sub;
    const otherUserId = isCallerEnding ? hostRow?.user_id : session.caller_id;
    if (otherUserId) {
      const notifId = c.env.NOTIFICATION_HUB.idFromName(otherUserId);
      const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
      await notifStub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'call_ended', session_id: sessionId }),
      });
    }
  } catch {}

  const cfCalls = createCFCalls(c.env);
  if (cfCalls) {
    if (session.cf_session_id) { try { await cfCalls.closeSession(session.cf_session_id); } catch {} }
    if (session.cf_host_session_id) { try { await cfCalls.closeSession(session.cf_host_session_id); } catch {} }
  }

  return c.json({ success: true, duration_seconds: durationSec, coins_charged: coinsCharged, host_earnings: hostShare });
});

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

call.get('/history', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    `SELECT cs.*, h.display_name as host_name, hu.avatar_url as host_avatar,
            cu.name as caller_name, cu.avatar_url as caller_avatar
     FROM call_sessions cs
     JOIN hosts h ON h.id = cs.host_id
     JOIN users hu ON hu.id = h.user_id
     JOIN users cu ON cu.id = cs.caller_id
     WHERE cs.caller_id = ? OR h.user_id = ?
     ORDER BY cs.created_at DESC LIMIT 50`
  ).bind(sub, sub).all();
  return c.json(result.results);
});

call.post('/:id/rate', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const body = await c.req.json<{ stars?: number; rating?: number; comment?: string }>();
  const starsVal = Math.min(5, Math.max(1, Number(body.stars ?? body.rating ?? 5)));
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

call.get('/:id/cf-token', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const result = await deriveRole(c.env.DB, sessionId, sub);
  if (!result) return c.json({ error: 'Not found or access denied' }, 403);
  return c.json({
    cf_session_id: result.session.cf_session_id,
    cf_host_session_id: result.session.cf_host_session_id,
    app_id: c.env.CF_CALLS_APP_ID,
    role: result.role,
  });
});

export default call;
