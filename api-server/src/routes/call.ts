import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { createCFCalls, CFCallsTrack } from '../lib/cf-calls';
import { sendFCMPush } from '../lib/fcm';
import type { Env, JWTPayload } from '../types';

const call = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
call.use('*', authMiddleware);

const initiateSchema = z.object({
  host_id: z.string().min(1),
  type: z.enum(['audio', 'video']).optional(),
  call_type: z.enum(['audio', 'video']).optional(),
});

const rateSchema = z.object({
  session_id: z.string().min(1),
  stars: z.number().int().min(1).max(5).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(500).optional(),
});

call.post('/initiate', zValidator('json', initiateSchema), async (c) => {
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

  // FIX: Use c.req.valid('json') — zValidator already parsed the body, do NOT call c.req.json() again
  const body = c.req.valid('json');
  const callType = body.type || body.call_type || 'audio';

  const host = await db.prepare('SELECT id, coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id FROM hosts WHERE id = ? AND is_online = 1 AND is_active = 1').bind(body.host_id).first<any>();
  if (!host) return c.json({ error: 'Host not available' }, 404);

  // Self-call check
  if (host.user_id === sub) {
    return c.json({ error: 'You cannot call yourself' }, 400);
  }

  // Concurrent call check — user pehle se kisi call mein hai?
  const existingCall = await db.prepare(
    "SELECT id FROM call_sessions WHERE caller_id = ? AND status IN ('pending','active') LIMIT 1"
  ).bind(sub).first<any>();
  if (existingCall) {
    return c.json({ error: 'You are already in a call. Please end it before starting a new one.' }, 409);
  }

  // Host already busy check
  const hostBusy = await db.prepare(
    "SELECT id FROM call_sessions WHERE host_id = ? AND status IN ('pending','active') LIMIT 1"
  ).bind(host.id).first<any>();
  if (hostBusy) {
    return c.json({ error: 'Host is currently busy. Please try again later.' }, 409);
  }

  const ratePerMin = callType === 'video'
    ? (host.video_coins_per_minute ?? host.coins_per_minute ?? 5)
    : (host.audio_coins_per_minute ?? host.coins_per_minute ?? 5);

  const caller = await db.prepare('SELECT coins, name FROM users WHERE id = ?').bind(sub).first<any>();
  // Require at least 2 minutes worth of coins — WebRTC negotiation takes ~15s
  // so 1-min minimum would auto-end the call before it truly starts
  if (!caller || caller.coins < ratePerMin * 2) {
    return c.json({ error: 'Insufficient coins. You need at least 2 minutes worth of coins to start a call.' }, 402);
  }

  // FIX BUG-1: Do NOT pre-create CF sessions at initiation time.
  // CF Calls sessions idle-timeout in ~30-60s. Pre-creating them means by the time
  // the host accepts and WebRTC negotiation starts, they are already expired (→ 410 session_error).
  // Sessions are created lazily in /sdp/push when each party actually starts negotiating.
  const sessionId = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO call_sessions (id, caller_id, host_id, type, status, cf_session_id, cf_host_session_id, rate_per_minute) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, sub, body.host_id, callType, 'pending', null, null, ratePerMin).run();

  // WebSocket notification (foreground/background)
  // Fix H2: include caller_name so host sees caller's name instead of "Incoming Call"
  try {
    const notifId = c.env.NOTIFICATION_HUB.idFromName(host.user_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'incoming_call', session_id: sessionId, caller_id: sub, call_type: callType, caller_name: caller.name ?? 'Caller', rate_per_minute: ratePerMin }),
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
        { type: 'incoming_call', session_id: sessionId, call_type: callType, caller_id: sub, caller_name: caller.name ?? 'Caller' }
      );
    }
  } catch {}

  const maxSeconds = Math.floor((caller.coins / ratePerMin) * 60);
  return c.json({
    session_id: sessionId,
    cf_session_id: null,
    cf_host_session_id: null,
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

  try {
  const session = await db.prepare(
    'SELECT * FROM call_sessions WHERE id = ? AND (caller_id = ? OR host_id IN (SELECT id FROM hosts WHERE user_id = ?))'
  ).bind(session_id, sub, sub).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  if (session.status !== 'active' && session.status !== 'pending') {
    return c.json({ error: 'Call already ended' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  // Atomic guard: set ended_at to claim this end operation.
  // 'processing' was previously used but is not a valid CHECK value — using ended_at IS NULL instead.
  const atomicUpdate = await db.prepare(
    "UPDATE call_sessions SET ended_at = ? WHERE id = ? AND status IN ('active', 'pending') AND ended_at IS NULL"
  ).bind(now, session_id).run();
  if (!atomicUpdate.meta?.changes || atomicUpdate.meta.changes === 0) {
    return c.json({ error: 'Call already ended' }, 400);
  }

  // Use server-calculated duration as primary; fall back to client-provided only when started_at unavailable
  const durationSec = session.started_at ? now - session.started_at : (duration_seconds ?? 0);
  // Only apply 1-minute minimum when the call actually had some duration
  const durationMin = durationSec > 0 ? Math.max(1, Math.ceil(durationSec / 60)) : 0;

  const hostRow = await db.prepare('SELECT coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id, total_minutes, total_earnings FROM hosts WHERE id = ?').bind(session.host_id).first<any>();
  const effectiveRate = session.rate_per_minute
    ?? (session.type === 'video'
        ? (hostRow?.video_coins_per_minute ?? hostRow?.coins_per_minute ?? 5)
        : (hostRow?.audio_coins_per_minute ?? hostRow?.coins_per_minute ?? 5));
  const coinsCharged = (session.status === 'active' && durationSec > 0)
    ? durationMin * effectiveRate
    : 0;
  const hostShare = Math.floor(coinsCharged * 0.7);

  // ──────────────────────────────────────────────────────────────────────────
  // CRITICAL FIX: Atomic coin transfer using a SINGLE UPDATE statement.
  //
  // Previous design used a multi-statement batch with a conditional WHERE
  // (`coins >= ?`) on the deduction. If the caller had insufficient coins, the
  // deduction "succeeded" with 0 changes (SQL doesn't error on unmatched WHERE)
  // but the unconditional host credit still applied → free coins for the host.
  // The "manual reversal" fallback was non-atomic — a Worker crash between the
  // batch and the reversal would permanently inflate the money supply.
  //
  // New design: a single UPDATE with a CASE expression and an EXISTS guard.
  //   - If caller has >= amount coins  →  EXISTS true  →  both rows update
  //                                       (caller -= amount, host += share)
  //   - If caller has < amount coins   →  EXISTS false →  WHERE excludes ALL
  //                                       rows → ZERO money moves.
  // Atomic at the SQL engine level. No partial state possible.
  // ──────────────────────────────────────────────────────────────────────────
  let actualCoinsCharged = 0;
  let actualHostShare = 0;
  if (coinsCharged > 0 && hostRow?.user_id) {
    const transfer = await db.prepare(
      `UPDATE users
         SET coins = coins + CASE id
           WHEN ?1 THEN -?2
           WHEN ?3 THEN ?4
           ELSE 0
         END
         WHERE id IN (?1, ?3)
           AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND coins >= ?2)`
    ).bind(session.caller_id, coinsCharged, hostRow.user_id, hostShare).run();

    // changes === 2 → both caller and host rows updated (success).
    // changes === 0 → caller had insufficient coins; nothing moved.
    if (transfer.meta?.changes === 2) {
      actualCoinsCharged = coinsCharged;
      actualHostShare = hostShare;
    } else {
      console.warn('[/end] Atomic transfer failed (insufficient coins). Caller:', session.caller_id, 'wanted:', coinsCharged);
    }
  }

  // Now record bookkeeping in a single batch (atomic at D1 batch level).
  // Only insert coin_transactions / update host stats if money actually moved.
  const txs: any[] = [
    db.prepare('UPDATE call_sessions SET status = ?, duration_seconds = ?, coins_charged = ? WHERE id = ?')
      .bind('ended', durationSec, actualCoinsCharged, session_id),
  ];
  if (actualCoinsCharged > 0) {
    txs.push(
      db.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
        .bind(durationMin, actualHostShare, session.host_id),
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), session.caller_id, 'spend', -actualCoinsCharged, `${session.type || 'audio'} call — ${durationMin} min`, session_id),
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), hostRow.user_id, 'bonus', actualHostShare, `${session.type || 'audio'} call — ${durationMin} min`, session_id),
    );
  }
  await db.batch(txs);

  // Notify the OTHER party that call ended
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

  // FIX: coin_update event bhejo — host wallet + user balance real-time update hoga.
  // Use ACTUAL transferred amounts (could be 0 if atomic transfer failed due to insufficient coins).
  if (actualCoinsCharged > 0 && hostRow?.user_id) {
    try {
      const hostNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(hostRow.user_id));
      const updatedHost = await c.env.DB.prepare('SELECT coins FROM users WHERE id = ?').bind(hostRow.user_id).first<any>();
      await hostNotif.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'coin_update', amount: actualHostShare, new_balance: updatedHost?.coins ?? 0 }),
      });
    } catch {}
    // User ko deduction notify karo
    try {
      const userNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(session.caller_id));
      const updatedUser = await c.env.DB.prepare('SELECT coins FROM users WHERE id = ?').bind(session.caller_id).first<any>();
      await userNotif.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'coin_update', amount: -actualCoinsCharged, new_balance: updatedUser?.coins ?? 0 }),
      });
    } catch {}
  }

  const cfCalls = createCFCalls(c.env);
  if (cfCalls) {
    if (session.cf_session_id) { try { await cfCalls.closeSession(session.cf_session_id); } catch {} }
    if (session.cf_host_session_id) { try { await cfCalls.closeSession(session.cf_host_session_id); } catch {} }
  }

  return c.json({ success: true, duration_seconds: durationSec, coins_charged: actualCoinsCharged, host_earnings: actualHostShare });
  } catch (e: any) {
    console.error('[/end] error:', e);
    return c.json({ error: e.message || 'Failed to end call' }, 500);
  }
});

call.post('/rate', zValidator('json', rateSchema), async (c) => {
  const { sub } = c.get('user');
  // FIX: Use c.req.valid('json') — zValidator already parsed, do NOT call c.req.json() again
  const body = c.req.valid('json');
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

  // Status check — can only answer pending calls
  if (session.status !== 'pending') {
    return c.json({ error: `Cannot answer — call is already ${session.status}` }, 400);
  }

  // Verify the requester is actually the host of this session
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
  // Atomic guard — prevent double-accept race
  const acceptUpdate = await db.prepare(
    "UPDATE call_sessions SET status = 'active', started_at = ? WHERE id = ? AND status = 'pending'"
  ).bind(now, sessionId).run();
  if (!acceptUpdate.meta?.changes || acceptUpdate.meta.changes === 0) {
    return c.json({ error: 'Call already answered or cancelled' }, 409);
  }

  // FIX: include started_at so caller can sync their billing timer with the server
  try {
    const notifId = c.env.NOTIFICATION_HUB.idFromName(session.caller_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'call_accepted', session_id: sessionId, started_at: now }),
    });
  } catch {}

  return c.json({
    success: true,
    status: 'active',
    started_at: now,
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
  if (!cfCalls) {
    console.error('[CF Calls] NOT CONFIGURED — CF_CALLS_APP_ID:', !!c.env.CF_CALLS_APP_ID, 'CF_CALLS_APP_SECRET:', !!c.env.CF_CALLS_APP_SECRET);
    return c.json({ error: 'CF Calls not configured — contact admin to set CF_CALLS_APP_SECRET' }, 500);
  }

  let cfSessionId = role === 'host' ? session.cf_host_session_id : session.cf_session_id;

  // Lazy session creation: if no CF session ID stored (e.g. call was created before
  // CF_CALLS_APP_ID was configured), create one now and persist it.
  if (!cfSessionId) {
    try {
      const newSess = await cfCalls.createSession();
      cfSessionId = newSess.sessionId;
      const field = role === 'host' ? 'cf_host_session_id' : 'cf_session_id';
      await db.prepare(`UPDATE call_sessions SET ${field} = ? WHERE id = ?`)
        .bind(cfSessionId, sessionId).run();
    } catch (e) {
      console.error('Lazy CF session creation error:', e);
      return c.json({ error: 'Failed to create CF session' }, 500);
    }
  }

  const sessionField = role === 'host' ? 'cf_host_session_id' : 'cf_session_id';
  const trackField   = role === 'host' ? 'cf_host_track_names' : 'cf_caller_track_names';
  const trackList    = body.tracks.map(t => ({ location: 'local' as const, mid: t.mid, trackName: t.trackName }));

  // Helper: notify other party + persist track names after a successful push
  const afterPush = async (tracks: any[]) => {
    try {
      const otherUserId = role === 'host' ? session.caller_id : session.host_user_id;
      if (otherUserId) {
        const notifId = c.env.NOTIFICATION_HUB.idFromName(otherUserId);
        const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
        await notifStub.fetch('https://dummy/notify', {
          method: 'POST',
          body: JSON.stringify({ type: 'peer_tracks_ready', session_id: sessionId }),
        });
      }
    } catch {}
    try {
      const trackNamesJson = JSON.stringify(body.tracks.map((t: any) => t.trackName));
      await db.prepare(`UPDATE call_sessions SET ${trackField} = ? WHERE id = ?`)
        .bind(trackNamesJson, sessionId).run();
    } catch {}
  };

  try {
    const pushResult = await cfCalls.pushTracks(
      cfSessionId!,
      { type: body.type, sdp: body.sdp },
      trackList
    );
    await afterPush(pushResult.tracks);
    return c.json({ answer: pushResult.answer, tracks: pushResult.tracks, role });
  } catch (e: any) {
    console.error('pushTracks error:', e);

    // FIX BUG-1 safety net: if the CF session expired (410 session_error) — which can happen
    // if the lazy-created session also aged out — recreate a fresh session and retry once.
    const isSessionExpired = e.message && (
      e.message.includes('410') || e.message.toLowerCase().includes('session_error')
    );
    if (isSessionExpired) {
      try {
        const newSess = await cfCalls.createSession();
        cfSessionId = newSess.sessionId;
        await db.prepare(`UPDATE call_sessions SET ${sessionField} = ? WHERE id = ?`)
          .bind(cfSessionId, sessionId).run();

        const retryResult = await cfCalls.pushTracks(
          cfSessionId,
          { type: body.type, sdp: body.sdp },
          trackList
        );
        await afterPush(retryResult.tracks);
        return c.json({ answer: retryResult.answer, tracks: retryResult.tracks, role });
      } catch (retryE: any) {
        console.error('pushTracks retry failed:', retryE);
        return c.json({ error: 'session_error', message: 'CF session expired, please retry the call' }, 410);
      }
    }

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
  if (!cfCalls) {
    console.error('[CF Calls] NOT CONFIGURED — CF_CALLS_APP_ID:', !!c.env.CF_CALLS_APP_ID, 'CF_CALLS_APP_SECRET:', !!c.env.CF_CALLS_APP_SECRET);
    return c.json({ error: 'CF Calls not configured — contact admin to set CF_CALLS_APP_SECRET' }, 500);
  }

  const mySessionId = role === 'host' ? session.cf_host_session_id : session.cf_session_id;
  const remoteSessionId = role === 'host' ? session.cf_session_id : session.cf_host_session_id;

  // If my session is missing, remote hasn't been set up yet — retry signal
  if (!mySessionId) return c.json({ offer: null, tracks: [], role, retryable: true });
  if (!remoteSessionId) return c.json({ offer: null, tracks: [], role, retryable: true });

  // FIX: use stored remote track names if available — avoids hardcoded 'audio-0'/'video-1'
  // assumption that breaks when MID assignment differs by platform
  const storedRemoteNames = role === 'caller'
    ? session.cf_host_track_names
    : session.cf_caller_track_names;
  const trackNamesToUse = storedRemoteNames
    ? JSON.parse(storedRemoteNames)
    : body.trackNames;

  try {
    const pullResult = await cfCalls.pullTracks(mySessionId, remoteSessionId, trackNamesToUse);

    // If ALL requested tracks have errors, remote hasn't pushed yet — tell client to retry.
    // CF Calls returns a valid offer SDP even when tracks are unavailable (a=inactive),
    // so we must explicitly detect this and signal "not ready" instead of returning the bad offer.
    const allTracksErrored =
      pullResult.tracks?.length > 0 &&
      pullResult.tracks.every((t: CFCallsTrack) => t.errorCode);

    if (allTracksErrored) {
      return c.json({ offer: null, tracks: [], role, retryable: true });
    }

    return c.json({
      offer: pullResult.offer,
      tracks: pullResult.tracks,
      role,
    });
  } catch (e: any) {
    // CF Calls returns 410 with session_error when the remote PeerConnection isn't established yet.
    // This is equivalent to "remote hasn't pushed yet" — tell the client to retry.
    const isSessionError = e.message?.includes('session_error') || e.message?.includes('410');
    if (isSessionError) {
      return c.json({ offer: null, tracks: [], role, retryable: true });
    }
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
  if (!cfCalls) {
    console.error('[CF Calls] NOT CONFIGURED — CF_CALLS_APP_ID:', !!c.env.CF_CALLS_APP_ID, 'CF_CALLS_APP_SECRET:', !!c.env.CF_CALLS_APP_SECRET);
    return c.json({ error: 'CF Calls not configured — contact admin to set CF_CALLS_APP_SECRET' }, 500);
  }

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

  try {
  const session = await db.prepare(
    `SELECT cs.*, h.user_id as host_user_id
     FROM call_sessions cs
     LEFT JOIN hosts h ON h.id = cs.host_id
     WHERE cs.id = ?`
  ).bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  // FIX: Authorization check — only the caller or the host can end the call
  if (session.caller_id !== sub && session.host_user_id !== sub) {
    return c.json({ error: 'Not authorized to end this call' }, 403);
  }

  if (session.status !== 'active' && session.status !== 'pending') return c.json({ error: 'Call already ended' }, 400);

  const now = Math.floor(Date.now() / 1000);
  // Atomic guard using ended_at IS NULL — avoids violating the status CHECK constraint.
  const atomicUpdate = await db.prepare(
    "UPDATE call_sessions SET ended_at = ? WHERE id = ? AND status IN ('active', 'pending') AND ended_at IS NULL"
  ).bind(now, sessionId).run();
  if (!atomicUpdate.meta?.changes || atomicUpdate.meta.changes === 0) {
    return c.json({ error: 'Call already ended' }, 400);
  }

  const durationSec = session.started_at ? now - session.started_at : 0;
  // Only apply 1-minute minimum when the call actually had some duration
  const durationMin = durationSec > 0 ? Math.max(1, Math.ceil(durationSec / 60)) : 0;
  const hostRow = await db.prepare('SELECT coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id, total_minutes, total_earnings FROM hosts WHERE id = ?').bind(session.host_id).first<any>();
  const effectiveRate = session.rate_per_minute ?? (session.type === 'video'
    ? (hostRow?.video_coins_per_minute ?? hostRow?.coins_per_minute ?? 5)
    : (hostRow?.audio_coins_per_minute ?? hostRow?.coins_per_minute ?? 5));
  // Only charge if call was active AND had non-zero duration
  const coinsCharged = (session.status === 'active' && durationSec > 0) ? durationMin * effectiveRate : 0;
  const hostShare = Math.floor(coinsCharged * 0.7);

  const batchOps: any[] = [
    // ended_at already set by atomic guard above
    db.prepare('UPDATE call_sessions SET status = ?, duration_seconds = ?, coins_charged = ? WHERE id = ?')
      .bind('ended', durationSec, coinsCharged, sessionId),
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
  const batchOpResults = await db.batch(batchOps);
  // Verify coin deduction actually succeeded (user may have had insufficient coins due to a race)
  if (coinsCharged > 0) {
    const deductResult = batchOpResults[1];
    if (!deductResult?.meta?.changes || deductResult.meta.changes === 0) {
      console.error('[/:id/end] Coin deduction failed for caller', session.caller_id, '— reversing host credit');
      await db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(hostShare, hostRow?.user_id).run();
      await db.prepare('UPDATE hosts SET total_earnings = total_earnings - ? WHERE id = ?').bind(hostShare, session.host_id).run();
    }
  }

  // Notify the OTHER party that call ended
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

  // FIX: coin_update event — host wallet + user balance real-time update
  if (coinsCharged > 0 && hostRow?.user_id) {
    try {
      const hostNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(hostRow.user_id));
      const updatedHost = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(hostRow.user_id).first<any>();
      await hostNotif.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'coin_update', amount: hostShare, new_balance: updatedHost?.coins ?? 0 }),
      });
    } catch {}
    try {
      const userNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(session.caller_id));
      const updatedUser = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(session.caller_id).first<any>();
      await userNotif.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'coin_update', amount: -coinsCharged, new_balance: updatedUser?.coins ?? 0 }),
      });
    } catch {}
  }

  const cfCalls = createCFCalls(c.env);
  if (cfCalls) {
    if (session.cf_session_id) { try { await cfCalls.closeSession(session.cf_session_id); } catch {} }
    if (session.cf_host_session_id) { try { await cfCalls.closeSession(session.cf_host_session_id); } catch {} }
  }

  return c.json({ success: true, duration_seconds: durationSec, coins_charged: coinsCharged, host_earnings: hostShare });
  } catch (e: any) {
    console.error('[/:id/end] error:', e);
    return c.json({ error: e.message || 'Failed to end call' }, 500);
  }
});

// Polling fallback: host checks if there's a pending incoming call for them
// Used by the host app when WebSocket is not connected or as a reliability backup
call.get('/pending-for-host', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const host = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<any>();
  if (!host) return c.json(null);
  const cutoff = Math.floor(Date.now() / 1000) - 90;
  const session = await db.prepare(
    `SELECT cs.id, cs.caller_id, cs.type as call_type, cs.rate_per_minute, u.name as caller_name, u.avatar_url as caller_avatar
     FROM call_sessions cs
     JOIN users u ON u.id = cs.caller_id
     WHERE cs.host_id = ? AND cs.status = 'pending' AND cs.created_at > ?
     ORDER BY cs.created_at DESC LIMIT 1`
  ).bind(host.id, cutoff).first<any>();
  return c.json(session ?? null);
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
