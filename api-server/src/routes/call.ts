import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { createCFCalls, CFCallsTrack } from '../lib/cf-calls';
import { sendFCMPush } from '../lib/fcm';
import { getLevelConfig, getEarningShare } from '../lib/levels';
import { applyLevelUp } from '../lib/levelService';
import { billedMinutes, coinsForCall, chargeCallerWithFreePool } from '../lib/billing';
import { registerHit } from '../lib/rateLimit';
import type { Env, JWTPayload, HostRow, CallSessionRow, CallerData, HostData } from '../types';

const call = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
call.use('*', authMiddleware);

// ─── ICE config ──────────────────────────────────────────────────────────────
// Returns the iceServers list clients should pass to RTCPeerConnection. When
// TURN_KEY_ID + TURN_KEY_TOKEN are configured we mint a short-lived (1h)
// Cloudflare Realtime TURN credential so clients on symmetric NATs / UDP-
// blocked networks (Jio / Airtel / corporate Wi-Fi) can actually relay.
// Without those env vars we still return STUN + a public TURN relay (Open
// Relay) so calls work in development.
//
// FIX (no-audio / one-way audio on mobile carriers): symmetric NAT prevents
// peers from finding each other through STUN alone; without TURN the call
// either silently fails ICE or only one direction's media gets through. The
// previous client hardcoded only STUN, which is why audio went missing on
// real devices behind cellular networks even though signalling succeeded.
call.get('/ice-config', async (c) => {
  const keyId = c.env.TURN_KEY_ID;
  const keyToken = c.env.TURN_KEY_TOKEN;

  // The public Open Relay TURN servers are convenient for development but are
  // rate-limited and unreliable — they must NOT be depended on in production.
  // When CF TURN credentials (TURN_KEY_ID/TURN_KEY_TOKEN) are configured we
  // mint proper short-lived credentials below; the static fallback therefore
  // only carries the public relay OUTSIDE production so local/dev calls still
  // traverse NAT without extra setup.
  const isProd = c.env.ENVIRONMENT === 'production';
  const publicTurn = isProd ? [] : [
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];

  // Default fallback: STUN (+ public TURN in dev). Public TURN is rate-limited
  // and not suitable for production scale but ensures dev / first-deploy users
  // are not blocked by NAT issues.
  const fallback = {
    iceServers: [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      ...publicTurn,
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle' as const,
    rtcpMuxPolicy: 'require' as const,
    source: 'fallback' as const,
  };

  if (!keyId || !keyToken) {
    if (isProd) {
      // Loud warning: without CF TURN creds, production clients on UDP-blocked
      // / symmetric-NAT networks (most mobile carriers) silently fail to
      // connect media even though signalling succeeds.
      console.error('[ice-config] PRODUCTION missing TURN_KEY_ID/TURN_KEY_TOKEN — clients behind symmetric NAT / UDP-blocked networks will fail to relay. Configure Cloudflare Realtime TURN credentials.');
    }
    return c.json(fallback);
  }

  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 3600 }),
    });

    if (!res.ok) {
      console.warn('[ice-config] Cloudflare TURN credential request failed:', res.status, await res.text().catch(() => ''));
      return c.json(fallback);
    }

    const data = await res.json<any>();
    // Cloudflare's response shape: { iceServers: { urls: [...], username, credential }, ttl }
    // RTCPeerConnection accepts both array-of-urls and a single-url-per-entry,
    // so we normalize to a flat array that's safe for every browser.
    const cfServers: any[] = [];
    const iceField = data?.iceServers;
    if (Array.isArray(iceField)) {
      cfServers.push(...iceField);
    } else if (iceField && typeof iceField === 'object') {
      cfServers.push(iceField);
    }

    if (cfServers.length === 0) {
      return c.json(fallback);
    }

    return c.json({
      iceServers: [
        // Keep the public STUN at the front for fast srflx candidate gathering.
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
        ...cfServers,
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle' as const,
      rtcpMuxPolicy: 'require' as const,
      ttl: data?.ttl ?? 3600,
      source: 'cloudflare' as const,
    });
  } catch (err: any) {
    console.warn('[ice-config] error fetching Cloudflare TURN credentials:', err?.message ?? err);
    return c.json(fallback);
  }
});

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
    // FIX #7: atomic check-and-increment (no read-then-write TOCTOU).
    const { limited } = await registerHit(db, rlKey, 5, 60);
    if (limited) {
      return c.json({ error: 'Too many call requests. Please wait before trying again.' }, 429);
    }
  } catch (e) {
    // Rate limit table may not exist — don't block but log the error
    console.warn('[initiate] Rate limit check failed:', e);
  }

  // FIX: Use c.req.valid('json') — zValidator already parsed the body, do NOT call c.req.json() again
  const body = c.req.valid('json');
  const callType = body.type || body.call_type || 'audio';

  // BUG #1 FIX: Use body.host_id instead of body.host_i[...]
  const host = await db.prepare('SELECT id, coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id FROM hosts WHERE id = ? AND is_online = 1 AND is_active = 1').bind(body.host_id).first<HostData>();
  if (!host) return c.json({ error: 'Host not available' }, 404);

  // Self-call check
  if (host.user_id === sub) {
    return c.json({ error: 'You cannot call yourself' }, 400);
  }

  // Concurrent call check — user pehle se kisi call mein hai?
  const existingCall = await db.prepare(
    "SELECT id FROM call_sessions WHERE caller_id = ? AND status IN ('pending','active') LIMIT 1"
  ).bind(sub).first<{ id: string }>();
  if (existingCall) {
    return c.json({ error: 'You are already in a call. Please end it before starting a new one.' }, 409);
  }

  // Host already busy check
  const hostBusy = await db.prepare(
    "SELECT id FROM call_sessions WHERE host_id = ? AND status IN ('pending','active') LIMIT 1"
  ).bind(host.id).first<{ id: string }>();
  if (hostBusy) {
    return c.json({ error: 'Host is currently busy. Please try again later.' }, 409);
  }

  const ratePerMin = callType === 'video'
    ? (host.video_coins_per_minute ?? host.coins_per_minute ?? 5)
    : (host.audio_coins_per_minute ?? host.coins_per_minute ?? 5);

  const caller = await db.prepare('SELECT coins, name FROM users WHERE id = ?').bind(sub).first<CallerData>();
  // Require at least 2 minutes worth of coins — WebRTC negotiation takes ~15s
  // so 1-min minimum would auto-end the call before it truly starts
  if (!caller || caller.coins < ratePerMin * 2) {
    return c.json({ error: 'Insufficient coins. You need at least 2 minutes worth of coins to start a call.' }, 402);
  }

  // FIX BUG-1: Do NOT pre-create CF sessions at initiation time.
  // CF Calls sessions idle-timeout in ~30-60s. Pre-creating them means by the time
  // the host accepts and WebRTC negotiation starts, they are already expired (→ 410 session_error).
  // Sessions are created lazily in /sdp/push when each party actually starts negotiating.
  //
  // RACE FIX (host double-call): the previous code did two SELECTs — one for
  // the caller's existing call and one for the host's existing call — then a
  // bare INSERT. Two callers initiating to the same host within the same few
  // ms could both pass both SELECTs (TOCTOU), then both INSERTs would succeed,
  // and the host would receive TWO simultaneous incoming calls. The early
  // SELECTs are still useful because they let us return precise error
  // messages ("you are already in a call" vs "host is busy") in the common
  // non-race case, but they are only advisory — the atomic guard below is
  // what actually prevents the race.
  //
  // The INSERT...SELECT WHERE NOT EXISTS form executes the existence check
  // and the row insert as a single SQLite statement. Either the row goes in
  // (changes === 1) or no row matches the SELECT and zero changes happen.
  // No other transaction can sneak in between, so two concurrent callers on
  // the same host can never both succeed.
  const sessionId = crypto.randomUUID();
  // Detect whether this initiate is the result of a recent /match/find
  // result. If so, stamp `is_random_match = 1` on the call_sessions row
  // so analytics + the host UI can tell random matches apart from direct
  // calls. We also flip the corresponding random_match_history row to
  // 'accepted' (best-effort, post-insert) so the decline-cooldown guard
  // doesn't count this as a decline.
  //
  // 5 min window — generous enough for a slow user, tight enough that an
  // unrelated direct call right after a different random match isn't
  // accidentally tagged.
  const RANDOM_MATCH_WINDOW_SEC = 300;
  const recentMatchedSince = Math.floor(Date.now() / 1000) - RANDOM_MATCH_WINDOW_SEC;
  const recentMatchRow = await db
    .prepare(
      `SELECT id FROM random_match_history
       WHERE user_id = ? AND host_id = ? AND outcome = 'matched' AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(sub, body.host_id, recentMatchedSince)
    .first<{ id: string }>()
    .catch(() => null); // table missing in legacy DBs — treat as not random
  const isRandomMatch = recentMatchRow ? 1 : 0;

  const insertResult = await (async () => {
    try {
      return await db.prepare(
        `INSERT INTO call_sessions (id, caller_id, host_id, type, status, cf_session_id, cf_host_session_id, rate_per_minute, is_random_match)
         SELECT ?1, ?2, ?3, ?4, 'pending', NULL, NULL, ?5, ?6
         WHERE NOT EXISTS (
           SELECT 1 FROM call_sessions
           WHERE status IN ('pending', 'active')
             AND (caller_id = ?2 OR host_id = ?3)
         )`
      ).bind(sessionId, sub, body.host_id, callType, ratePerMin, isRandomMatch).run();
    } catch (err) {
      // is_random_match was added by migration 0026 — if the column isn't
      // there yet (deploy ran without applying migrations) we still want
      // calls to work. Fall back to the legacy 8-column INSERT so the rest
      // of the system keeps running while the schema healer catches up.
      const msg = String((err as any)?.message || err);
      if (/no such column: is_random_match/i.test(msg)) {
        console.warn('[initiate] is_random_match column missing, using legacy INSERT');
        return await db.prepare(
          `INSERT INTO call_sessions (id, caller_id, host_id, type, status, cf_session_id, cf_host_session_id, rate_per_minute)
           SELECT ?1, ?2, ?3, ?4, 'pending', NULL, NULL, ?5
           WHERE NOT EXISTS (
             SELECT 1 FROM call_sessions
             WHERE status IN ('pending', 'active')
               AND (caller_id = ?2 OR host_id = ?3)
           )`
        ).bind(sessionId, sub, body.host_id, callType, ratePerMin).run();
      }
      throw err;
    }
  })();

  if (!insertResult.meta?.changes) {
    // Race lost — another concurrent /initiate took the slot. Re-query to
    // tell the user precisely why so they see the right toast.
    const stillBusyOnCaller = await db.prepare(
      "SELECT 1 as ok FROM call_sessions WHERE caller_id = ? AND status IN ('pending','active') LIMIT 1"
    ).bind(sub).first<{ ok: number }>();
    if (stillBusyOnCaller) {
      return c.json({ error: 'You are already in a call. Please end it before starting a new one.' }, 409);
    }
    return c.json({ error: 'Host is currently busy. Please try again later.' }, 409);
  }

  // Mark the originating random match as 'accepted' so the decline-cooldown
  // guard doesn't count it as a decline. Best-effort — failure here is not
  // user-visible, the call still proceeds.
  if (recentMatchRow) {
    try {
      await db
        .prepare("UPDATE random_match_history SET outcome = 'accepted' WHERE id = ?")
        .bind(recentMatchRow.id)
        .run();
    } catch (e) {
      console.warn('[initiate] random_match_history accept update failed:', e);
    }
  }

  // WebSocket notification (foreground/background)
  // Fix H2: include caller_name so host sees caller's name instead of "Incoming Call"
  // FIX: also include max_seconds so host's call timer has a real cap (prevents
  // running past the caller's balance on the host UI when the polling fallback is bypassed).
  const maxSeconds = Math.floor((caller.coins / ratePerMin) * 60);
  try {
    const notifId = c.env.NOTIFICATION_HUB.idFromName(host.user_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'incoming_call', session_id: sessionId, caller_id: sub, call_type: callType, caller_name: caller.name ?? 'Caller', rate_per_minute: ratePerMin, max_seconds: maxSeconds }),
    });
  } catch (e) {
    // BUG #8 FIX: Log notification failures instead of silently swallowing
    console.warn('[initiate] WebSocket notification failed:', e);
  }

  // Expo Push Notification (app killed / background)
  try {
    const hostUser = await db.prepare('SELECT fcm_token FROM users WHERE id = ?').bind(host.user_id).first<{ fcm_token: string }>();
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
  } catch (e) {
    // BUG #8 FIX: Log FCM failures
    console.warn('[initiate] FCM notification failed:', e);
  }

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
    ).bind(session_id, sub, sub).first<CallSessionRow>();
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
    // Whole minutes billed for this call (any started minute rounds up).
    const durationMin = billedMinutes(durationSec);

    // BUG #1 FIX: Fixed incomplete query
    const hostRow = await db.prepare('SELECT coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id, total_minutes, total_earnings, level FROM hosts WHERE id = ?').bind(session.host_id).first<HostRow>();
    
    // BUG #4 FIX: Check if hostRow is null before using it
    if (!hostRow) {
      console.error('[/end] Host not found for session', session_id);
      return c.json({ error: 'Host data missing' }, 500);
    }

    const effectiveRate = session.rate_per_minute
      ?? (session.type === 'video'
        ? (hostRow.video_coins_per_minute ?? hostRow.coins_per_minute ?? 5)
        : (hostRow.audio_coins_per_minute ?? hostRow.coins_per_minute ?? 5));
    const coinsCharged = coinsForCall({ status: session.status, durationSec, ratePerMinute: effectiveRate });
    // Level-based earning share — higher-level hosts keep a larger cut.
    // Defaults to the historical 70% (level 1) so low-level hosts are unaffected.
    const levelCfg = await getLevelConfig(c.env.DB);

    // FIX #1: best-effort (partial) billing — charge what the caller can afford
    // and pay the host their share of the amount actually collected. Previously
    // an overrun caller (talked past their balance) caused the all-or-nothing
    // transfer to move ZERO coins, so the host earned nothing for real talk-time.
    // See lib/billing.ts → chargeCallerAffordable / atomicCallTransfer.
    let actualCoinsCharged = 0;
    let actualHostShare = 0;
    let freeMinutesUsed = 0;
    if (coinsCharged > 0 && hostRow?.user_id) {
      const { charged, hostEarned, free_minutes_used } = await chargeCallerWithFreePool(db, {
        callerId: session.caller_id,
        hostUserId: hostRow.user_id,
        durationSec,
        ratePerMinute: effectiveRate,
        earningShare: getEarningShare(hostRow.level ?? 1, levelCfg),
      });
      actualCoinsCharged = charged;
      actualHostShare = hostEarned;
      freeMinutesUsed = free_minutes_used;
      if (charged === 0 && hostEarned === 0) {
        console.warn('[/end] Caller had no coins to charge. Caller:', session.caller_id, 'wanted:', coinsCharged);
      }
    }

    // End-reason taxonomy: tag who hung up so analytics + the call-summary
    // screen can distinguish caller-initiated vs host-initiated hangups
    // without parsing description strings. The voluntary /end path is
    // always one of these two; cron-reaped + balance-zero stamps happen
    // elsewhere (cron reaper / heartbeat force-end).
    const endReason: 'caller_hangup' | 'host_hangup' =
      sub === session.caller_id ? 'caller_hangup' : 'host_hangup';

    // Now record bookkeeping in a single batch (atomic at D1 batch level).
    // Only insert coin_transactions / update host stats if money actually moved.
    // Note: freeMinutesUsed > 0 with caller charged === 0 is a valid state
    // (caller burned the freebie, host still gets paid by the platform) — we
    // record the host credit + stats but no caller spend row.
    const txs: any[] = [
      db.prepare('UPDATE call_sessions SET status = ?, duration_seconds = ?, coins_charged = ?, free_minutes_used = ?, end_reason = ? WHERE id = ?')
        .bind('ended', durationSec, actualCoinsCharged, freeMinutesUsed, endReason, session_id),
    ];
    if (actualCoinsCharged > 0 || actualHostShare > 0) {
      txs.push(
        db.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
          .bind(durationMin, actualHostShare, session.host_id),
      );
      if (actualCoinsCharged > 0) {
        txs.push(
          db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), session.caller_id, 'spend', -actualCoinsCharged, `${session.type || 'audio'} call — ${durationMin} min`, session_id),
        );
      }
      if (actualHostShare > 0) {
        txs.push(
          db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), hostRow.user_id, 'bonus', actualHostShare, `${session.type || 'audio'} call — ${durationMin} min${freeMinutesUsed > 0 ? ` (${freeMinutesUsed} free)` : ''}`, session_id),
        );
      }
    }
    await db.batch(txs);

    // Notify the OTHER party that the call ended.
    //
    // FIX (call-disconnect propagation bug): the WebSocket path is unreliable —
    // if the recipient's WS is briefly disconnected (mobile data switch, app
    // backgrounded, brief network blip), NotificationHub silently drops the
    // message because there's no offline queue. Result: the other party stays
    // stuck on the call screen, billing keeps running on the server until the
    // 30-min cron reaper fires.
    //
    // We now fan out via TWO channels:
    //   1. WebSocket  → instant delivery when connected (covers 95% of cases)
    //   2. FCM push   → wakes the app even when WS is dropped (covers the rest)
    //
    // The client treats whichever arrives first as authoritative; the second
    // arrival is deduplicated by session_id on the receiver side.
    try {
      const isCallerEnding = session.caller_id === sub;
      const otherUserId = isCallerEnding ? hostRow.user_id : session.caller_id;
      if (otherUserId) {
        // 1. WebSocket notification (fast path)
        try {
          const notifId = c.env.NOTIFICATION_HUB.idFromName(otherUserId);
          const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
          await notifStub.fetch('https://dummy/notify', {
            method: 'POST',
            body: JSON.stringify({ type: 'call_ended', session_id: session_id }),
          });
        } catch (e) {
          console.warn('[/end] WS notify failed for other party:', e);
        }

        // 2. FCM push fallback (offline path) — fire-and-forget so a slow FCM
        //    response does not block the /end response. The push payload uses
        //    the same `type: 'call_ended'` shape the WS handler emits, so the
        //    client's FCM bridge can route it through the same code path.
        c.executionCtx.waitUntil((async () => {
          try {
            const otherUser = await db
              .prepare('SELECT fcm_token FROM users WHERE id = ?')
              .bind(otherUserId)
              .first<{ fcm_token: string | null }>();
            if (otherUser?.fcm_token) {
              await sendFCMPush(
                c.env.FIREBASE_SERVICE_ACCOUNT,
                otherUser.fcm_token,
                'Call Ended',
                'The other party has disconnected.',
                { type: 'call_ended', session_id: session_id }
              );
            }
          } catch (e) {
            console.warn('[/end] FCM fallback failed:', e);
          }
        })());
      }
    } catch (e) {
      // BUG #8 FIX: Log errors instead of silently swallowing
      console.warn('[/end] Failed to notify other party:', e);
    }

    // FIX: coin_update event bhejo — host wallet + user balance real-time update hoga.
    // Use ACTUAL transferred amounts (could be 0 if atomic transfer failed due to insufficient coins).
    if (actualCoinsCharged > 0 && hostRow?.user_id) {
      try {
        const hostNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(hostRow.user_id));
        const updatedHost = await c.env.DB.prepare('SELECT coins FROM users WHERE id = ?').bind(hostRow.user_id).first<{ coins: number }>();
        await hostNotif.fetch('https://dummy/notify', {
          method: 'POST',
          body: JSON.stringify({ type: 'coin_update', amount: actualHostShare, new_balance: updatedHost?.coins ?? 0 }),
        });
      } catch (e) {
        // BUG #8 FIX: Log host notification failures
        console.warn('[/end] Failed to notify host of coin update:', e);
      }
      // User ko deduction notify karo
      try {
        const userNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(session.caller_id));
        const updatedUser = await c.env.DB.prepare('SELECT coins FROM users WHERE id = ?').bind(session.caller_id).first<{ coins: number }>();
        await userNotif.fetch('https://dummy/notify', {
          method: 'POST',
          body: JSON.stringify({ type: 'coin_update', amount: -actualCoinsCharged, new_balance: updatedUser?.coins ?? 0 }),
        });
      } catch (e) {
        // BUG #8 FIX: Log user notification failures
        console.warn('[/end] Failed to notify user of coin deduction:', e);
      }
    }

    const cfCalls = createCFCalls(c.env);
    if (cfCalls) {
      if (session.cf_session_id) {
        try {
          await cfCalls.closeSession(session.cf_session_id);
        } catch (e) {
          console.warn('[/end] Failed to close CF session (caller):', e);
        }
      }
      if (session.cf_host_session_id) {
        try {
          await cfCalls.closeSession(session.cf_host_session_id);
        } catch (e) {
          console.warn('[/end] Failed to close CF session (host):', e);
        }
      }
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

  const session = await db.prepare('SELECT host_id FROM call_sessions WHERE id = ? AND caller_id = ?').bind(sessionId, sub).first<{ host_id: string }>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  await db.prepare('INSERT OR IGNORE INTO ratings (id, host_id, user_id, call_session_id, stars, comment) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), session.host_id, sub, sessionId, starsVal, body.comment ?? null).run();

  const avg = await db.prepare('SELECT AVG(stars) as avg, COUNT(*) as cnt FROM ratings WHERE host_id = ?').bind(session.host_id).first<{ avg: number; cnt: number }>();
  await db.prepare('UPDATE hosts SET rating = ?, review_count = ? WHERE id = ?').bind(
    Math.round((avg?.avg ?? starsVal) * 10) / 10, avg?.cnt ?? 1, session.host_id
  ).run();

  // Auto level-up: the host's rating/review_count just changed, so re-evaluate
  // their level. Best-effort — a failure here must never fail the rating call.
  try {
    await applyLevelUp(c.env, session.host_id, 'auto');
  } catch (e) {
    console.warn('[/rate] applyLevelUp failed:', e);
  }

  return c.json({ success: true });
});

call.post('/:id/answer', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const { accepted } = await c.req.json<{ accepted: boolean }>();
  const db = c.env.DB;

  const session = await db.prepare('SELECT * FROM call_sessions WHERE id = ?').bind(sessionId).first<CallSessionRow>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  // Status check — can only answer pending calls
  if (session.status !== 'pending') {
    return c.json({ error: `Cannot answer — call is already ${session.status}` }, 400);
  }

  // Verify the requester is actually the host of this session
  const hostCheck = await db.prepare('SELECT id FROM hosts WHERE id = ? AND user_id = ?').bind(session.host_id, sub).first<{ id: string }>();
  if (!hostCheck) return c.json({ error: 'Not authorized — you are not the host of this session' }, 403);

  if (!accepted) {
    // Stamp end_reason='declined' for analytics symmetry with the
    // hangup paths. Status='declined' is the canonical signal but a
    // single end_reason column means analytics dashboards don't have to
    // case on (status, end_reason) tuples.
    await db.prepare("UPDATE call_sessions SET status = ?, ended_at = unixepoch(), end_reason = 'declined' WHERE id = ?").bind('declined', sessionId).run();
    // Bug 3 fix: notify caller that call was declined
    try {
      const notifId = c.env.NOTIFICATION_HUB.idFromName(session.caller_id);
      const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
      await notifStub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'call_declined', session_id: sessionId }),
      });
    } catch (e) {
      console.warn('[/:id/answer] Failed to notify decline:', e);
    }
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
  } catch (e) {
    console.warn('[/:id/answer] Failed to notify accept:', e);
  }

  return c.json({
    success: true,
    status: 'active',
    started_at: now,
    cf_session_id: session.cf_session_id,
    cf_host_session_id: session.cf_host_session_id,
  });
});

async function deriveRole(db: D1Database, sessionId: string, userId: string): Promise<{ session: CallSessionRow; role: 'caller' | 'host' } | null> {
  const session = await db.prepare(
    `SELECT cs.*, h.user_id as host_user_id FROM call_sessions cs
     LEFT JOIN hosts h ON h.id = cs.host_id
     WHERE cs.id = ? AND cs.status IN ('pending', 'active')`
  ).bind(sessionId).first<CallSessionRow & { host_user_id: string }>();
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
  const sessionField = role === 'host' ? 'cf_host_session_id' : 'cf_session_id';
  const trackField = role === 'host' ? 'cf_host_track_names' : 'cf_caller_track_names';

  // Lazy session creation: if no CF session ID stored (e.g. call was created before
  // CF_CALLS_APP_ID was configured), create one now and persist it.
  //
  // RACE FIX: two concurrent /sdp/push requests for the same role (e.g. the
  // initial push racing an ICE-restart re-push, or a retried request) could
  // both observe a null cfSessionId, both call createSession(), and both
  // UPDATE the row — the second write clobbering the first. Whichever session
  // lost the write becomes an orphan, and tracks pushed to it are invisible to
  // the peer (who pulls from the stored session id). We make the persist
  // atomic with a `WHERE <field> IS NULL` guard so only the first writer wins;
  // the loser re-reads the winning id and closes its now-orphaned session.
  if (!cfSessionId) {
    try {
      const newSess = await cfCalls.createSession();
      const claim = await db.prepare(
        `UPDATE call_sessions SET ${sessionField} = ? WHERE id = ? AND ${sessionField} IS NULL`
      ).bind(newSess.sessionId, sessionId).run();

      if (claim.meta?.changes) {
        cfSessionId = newSess.sessionId;
      } else {
        // Lost the race — reuse the session another concurrent push stored and
        // discard ours so it doesn't linger on CF until idle-timeout.
        const fresh = await db.prepare(
          `SELECT ${sessionField} as sid FROM call_sessions WHERE id = ?`
        ).bind(sessionId).first<{ sid: string | null }>();
        cfSessionId = fresh?.sid ?? newSess.sessionId;
        if (cfSessionId !== newSess.sessionId) {
          try { await cfCalls.closeSession(newSess.sessionId); } catch { /* best-effort orphan cleanup */ }
        }
      }
    } catch (e) {
      console.error('Lazy CF session creation error:', e);
      return c.json({ error: 'Failed to create CF session' }, 500);
    }
  }
  const trackList = body.tracks.map(t => ({ location: 'local' as const, mid: t.mid, trackName: t.trackName }));

  // Helper: notify other party + persist track names after a successful push
  const afterPush = async (tracks: any[]) => {
    try {
      const otherUserId = role === 'host' ? session.caller_id : (session as any).host_user_id;
      if (otherUserId) {
        const notifId = c.env.NOTIFICATION_HUB.idFromName(otherUserId);
        const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
        await notifStub.fetch('https://dummy/notify', {
          method: 'POST',
          body: JSON.stringify({ type: 'peer_tracks_ready', session_id: sessionId }),
        });
      }
    } catch (e) {
      console.warn('[sdp/push] Failed to notify tracks ready:', e);
    }
    try {
      const trackNamesJson = JSON.stringify(body.tracks.map((t: any) => t.trackName));
      await db.prepare(`UPDATE call_sessions SET ${trackField} = ? WHERE id = ?`)
        .bind(trackNamesJson, sessionId).run();
    } catch (e) {
      console.warn('[sdp/push] Failed to persist track names:', e);
    }
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
  // BUG #5 FIX: Safe JSON parsing with error handling
  const storedRemoteNames = role === 'caller'
    ? (session as any).cf_host_track_names
    : (session as any).cf_caller_track_names;
  
  let trackNamesToUse = body.trackNames;
  if (storedRemoteNames) {
    try {
      trackNamesToUse = JSON.parse(storedRemoteNames);
    } catch (e) {
      console.warn('[sdp/pull] Malformed track names, using request body:', e);
      // Fall back to request body
    }
  }

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

// In-call media-state relay. The client posts its current mic / camera state
// whenever the user toggles mute or camera; we forward it to the OTHER party
// over their NotificationHub socket so the remote UI updates INSTANTLY
// (camera-off avatar, "muted" badge) instead of polling the remote track's
// `muted` flag — which is laggy and fires unreliably across platforms.
// Best-effort: a delivery failure never fails the toggle. No CF Calls call is
// involved, so this is cheap and safe even on flaky networks.
call.post('/:id/media-state', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const body = await c.req.json<{ audio?: boolean; video?: boolean }>().catch(() => ({} as { audio?: boolean; video?: boolean }));
  const db = c.env.DB;

  const result = await deriveRole(db, sessionId, sub);
  if (!result) return c.json({ error: 'Session not found or access denied' }, 403);
  const { session, role } = result;

  const otherUserId = role === 'host' ? session.caller_id : (session as any).host_user_id;
  if (otherUserId) {
    try {
      const notifId = c.env.NOTIFICATION_HUB.idFromName(otherUserId);
      const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
      await notifStub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({
          type: 'peer_media_state',
          session_id: sessionId,
          audio: body.audio !== false, // true = mic on (unmuted)
          video: body.video !== false, // true = camera on
        }),
      });
    } catch (e) {
      console.warn('[/:id/media-state] notify failed:', e);
    }
  }
  return c.json({ success: true });
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
    ).bind(sessionId).first<CallSessionRow & { host_user_id?: string }>();
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
    // Whole minutes billed for this call (any started minute rounds up).
    const durationMin = billedMinutes(durationSec);
    
    // BUG #1 FIX: Fixed incomplete query
    const hostRow = await db.prepare('SELECT coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id, total_minutes, total_earnings, level FROM hosts WHERE id = ?').bind(session.host_id).first<HostRow>();
    
    // BUG #4 FIX: Check if hostRow is null
    if (!hostRow) {
      console.error('[/:id/end] Host not found for session', sessionId);
      return c.json({ error: 'Host data missing' }, 500);
    }

    const effectiveRate = session.rate_per_minute ?? (session.type === 'video'
      ? (hostRow.video_coins_per_minute ?? hostRow.coins_per_minute ?? 5)
      : (hostRow.audio_coins_per_minute ?? hostRow.coins_per_minute ?? 5));
    // Only charge if call was active AND had non-zero duration
    const coinsCharged = coinsForCall({ status: session.status, durationSec, ratePerMinute: effectiveRate });
    // Level-based earning share — higher-level hosts keep a larger cut.
    // Defaults to the historical 70% (level 1) so low-level hosts are unaffected.
    const levelCfg = await getLevelConfig(c.env.DB);

    // FIX #1: best-effort (partial) billing — see lib/billing.ts.
    let actualCoinsCharged = 0;
    let actualHostShare = 0;
    let freeMinutesUsed = 0;

    if (coinsCharged > 0 && hostRow?.user_id) {
      const { charged, hostEarned, free_minutes_used } = await chargeCallerWithFreePool(db, {
        callerId: session.caller_id,
        hostUserId: hostRow.user_id,
        durationSec,
        ratePerMinute: effectiveRate,
        earningShare: getEarningShare(hostRow.level ?? 1, levelCfg),
      });
      actualCoinsCharged = charged;
      actualHostShare = hostEarned;
      freeMinutesUsed = free_minutes_used;
      if (charged === 0 && hostEarned === 0) {
        console.warn('[/:id/end] Caller had no coins to charge. Caller:', session.caller_id, 'wanted:', coinsCharged);
      }
    }

    // End-reason — same caller-vs-host attribution as the main /end path.
    const endReason: 'caller_hangup' | 'host_hangup' =
      sub === session.caller_id ? 'caller_hangup' : 'host_hangup';

    // Bookkeeping transactions
    const batchOps: any[] = [
      db.prepare('UPDATE call_sessions SET status = ?, duration_seconds = ?, coins_charged = ?, free_minutes_used = ?, end_reason = ? WHERE id = ?')
        .bind('ended', durationSec, actualCoinsCharged, freeMinutesUsed, endReason, sessionId),
    ];

    if (actualCoinsCharged > 0 || actualHostShare > 0) {
      batchOps.push(
        db.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
          .bind(durationMin, actualHostShare, session.host_id),
      );
      if (actualCoinsCharged > 0) {
        batchOps.push(
          db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), session.caller_id, 'spend', -actualCoinsCharged, `${session.type} call — ${durationMin} min`, sessionId),
        );
      }
      if (actualHostShare > 0) {
        batchOps.push(
          db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), hostRow.user_id, 'bonus', actualHostShare, `${session.type} call — ${durationMin} min${freeMinutesUsed > 0 ? ` (${freeMinutesUsed} free)` : ''}`, sessionId),
        );
      }
    }

    await db.batch(batchOps);

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
    } catch (e) {
      console.warn('[/:id/end] Failed to notify other party:', e);
    }

    // FIX: coin_update event — host wallet + user balance real-time update
    if (actualCoinsCharged > 0 && hostRow?.user_id) {
      try {
        const hostNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(hostRow.user_id));
        const updatedHost = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(hostRow.user_id).first<{ coins: number }>();
        await hostNotif.fetch('https://dummy/notify', {
          method: 'POST',
          body: JSON.stringify({ type: 'coin_update', amount: actualHostShare, new_balance: updatedHost?.coins ?? 0 }),
        });
      } catch (e) {
        console.warn('[/:id/end] Failed to notify host of coin update:', e);
      }
      try {
        const userNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(session.caller_id));
        const updatedUser = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(session.caller_id).first<{ coins: number }>();
        await userNotif.fetch('https://dummy/notify', {
          method: 'POST',
          body: JSON.stringify({ type: 'coin_update', amount: -actualCoinsCharged, new_balance: updatedUser?.coins ?? 0 }),
        });
      } catch (e) {
        console.warn('[/:id/end] Failed to notify user of coin deduction:', e);
      }
    }

    const cfCalls = createCFCalls(c.env);
    if (cfCalls) {
      if (session.cf_session_id) {
        try {
          await cfCalls.closeSession(session.cf_session_id);
        } catch (e) {
          console.warn('[/:id/end] Failed to close CF session (caller):', e);
        }
      }
      if (session.cf_host_session_id) {
        try {
          await cfCalls.closeSession(session.cf_host_session_id);
        } catch (e) {
          console.warn('[/:id/end] Failed to close CF session (host):', e);
        }
      }
    }

    return c.json({ success: true, duration_seconds: durationSec, coins_charged: actualCoinsCharged, host_earnings: actualHostShare });
  } catch (e: any) {
    console.error('[/:id/end] error:', e);
    return c.json({ error: e.message || 'Failed to end call' }, 500);
  }
});

// FIX #1: Mid-call heartbeat — server-side balance cap enforcement.
// The client posts this periodically (e.g. every 20–30s) during an active call.
// Billing still settles at /end (best-effort/partial), but this endpoint caps
// runaway calls server-side: once elapsed time exceeds what the caller's balance
// can pay for, the call is force-ended and settled, so an honest client can't
// silently overrun and a misbehaving one is bounded to one heartbeat interval.
call.post('/:id/heartbeat', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const db = c.env.DB;

  const result = await deriveRole(db, sessionId, sub);
  if (!result) return c.json({ error: 'Session not found or access denied' }, 403);
  const { session } = result;
  if (session.status !== 'active') {
    return c.json({ ok: true, ended: session.status === 'ended', status: session.status });
  }

  const now = Math.floor(Date.now() / 1000);
  const startedAt = session.started_at ?? now;
  const elapsed = Math.max(0, now - startedAt);
  const rate = session.rate_per_minute ?? 5;
  const caller = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(session.caller_id).first<{ coins: number }>();
  const balance = caller?.coins ?? 0;
  const maxSeconds = rate > 0 ? Math.floor((balance / rate) * 60) : 0;
  const remaining = Math.max(0, maxSeconds - elapsed);

  if (remaining > 0) {
    // Low-balance early warning — when the caller has fewer than the
    // admin-configured threshold of seconds left, push a WS event so the
    // client can surface a "Quick Recharge" modal before the call hard-stops
    // at the next heartbeat. Best-effort — failure must not break the
    // heartbeat response itself.
    let warnSeconds = 60;
    try {
      const row = await db
        .prepare("SELECT value FROM app_settings WHERE key = 'low_balance_warn_seconds'")
        .first<{ value: string }>();
      const n = parseInt(row?.value ?? '');
      if (Number.isFinite(n) && n > 0) warnSeconds = n;
    } catch { /* keep default */ }

    if (remaining <= warnSeconds) {
      try {
        const stub = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(session.caller_id));
        await stub.fetch('https://dummy/notify', {
          method: 'POST',
          body: JSON.stringify({
            type: 'call_low_balance',
            session_id: sessionId,
            remaining_seconds: remaining,
            rate_per_minute: rate,
          }),
        });
      } catch (e) {
        console.warn('[/:id/heartbeat] low-balance notify failed:', e);
      }
    }

    return c.json({
      ok: true,
      ended: false,
      remaining_seconds: remaining,
      max_seconds: maxSeconds,
      // Surface the threshold so the client can also render the warning
      // banner without polling app-config; saves a round-trip on the hot
      // path. Equivalent to remaining_seconds <= low_balance_warn_seconds.
      low_balance: remaining <= warnSeconds,
    });
  }

  // Balance exhausted → force-end + settle (partial). Atomic guard via ended_at.
  const guard = await db.prepare(
    "UPDATE call_sessions SET ended_at = ? WHERE id = ? AND status = 'active' AND ended_at IS NULL"
  ).bind(now, sessionId).run();
  if (!guard.meta?.changes) {
    return c.json({ ok: true, ended: true, reason: 'already_ending' });
  }

  const durationSec = session.started_at ? now - session.started_at : 0;
  const durationMin = billedMinutes(durationSec);
  const hostRow = await db.prepare('SELECT user_id, level FROM hosts WHERE id = ?').bind(session.host_id).first<{ user_id: string; level: number }>();
  const levelCfg = await getLevelConfig(db);
  const coinsCharged = coinsForCall({ status: 'active', durationSec, ratePerMinute: rate });

  let actualCoinsCharged = 0;
  let actualHostShare = 0;
  let freeMinutesUsed = 0;
  if (coinsCharged > 0 && hostRow?.user_id) {
    const { charged, hostEarned, free_minutes_used } = await chargeCallerWithFreePool(db, {
      callerId: session.caller_id,
      hostUserId: hostRow.user_id,
      durationSec,
      ratePerMinute: rate,
      earningShare: getEarningShare(hostRow.level ?? 1, levelCfg),
    });
    actualCoinsCharged = charged;
    actualHostShare = hostEarned;
    freeMinutesUsed = free_minutes_used;
  }

  const batchOps: any[] = [
    db.prepare("UPDATE call_sessions SET status = ?, duration_seconds = ?, coins_charged = ?, free_minutes_used = ?, end_reason = 'balance_zero' WHERE id = ?")
      .bind('ended', durationSec, actualCoinsCharged, freeMinutesUsed, sessionId),
  ];
  if ((actualCoinsCharged > 0 || actualHostShare > 0) && hostRow?.user_id) {
    batchOps.push(
      db.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
        .bind(durationMin, actualHostShare, session.host_id),
    );
    if (actualCoinsCharged > 0) {
      batchOps.push(
        db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), session.caller_id, 'spend', -actualCoinsCharged, `${session.type || 'audio'} call — ${durationMin} min (balance limit)`, sessionId),
      );
    }
    if (actualHostShare > 0) {
      batchOps.push(
        db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), hostRow.user_id, 'bonus', actualHostShare, `${session.type || 'audio'} call — ${durationMin} min (balance limit)${freeMinutesUsed > 0 ? `, ${freeMinutesUsed} free` : ''}`, sessionId),
      );
    }
  }
  await db.batch(batchOps);

  // Notify both parties the call ended (balance exhausted).
  for (const uid of [session.caller_id, hostRow?.user_id]) {
    if (!uid) continue;
    try {
      const stub = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(uid));
      await stub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'call_ended', session_id: sessionId, reason: 'balance_exhausted' }),
      });
    } catch (e) {
      console.warn('[/:id/heartbeat] notify failed:', e);
    }
  }

  // Best-effort: close CF sessions so media tears down promptly.
  const cfCalls = createCFCalls(c.env);
  if (cfCalls) {
    for (const sid of [session.cf_session_id, session.cf_host_session_id]) {
      if (sid) {
        try { await cfCalls.closeSession(sid); } catch (e) { console.warn('[/:id/heartbeat] CF close failed:', e); }
      }
    }
  }

  return c.json({ ok: true, ended: true, reason: 'balance_exhausted', coins_charged: actualCoinsCharged, duration_seconds: durationSec });
});

// POST /api/calls/:id/quality — ingest a per-call quality sample.
//
// Both parties' clients post this every ~30s during an active call. Used
// for per-host quality dashboards (avg jitter / p95 packet loss) so the
// admin can spot hosts whose calls drop a lot, and for the future "Top
// quality hosts" listing filter.
//
// Best-effort: a malformed sample doesn't fail the call, just gets
// dropped. Clients that don't have network info yet (early in the call)
// can post NULLs for any field. The deriveRole() check ensures only the
// two participants of THIS call can write samples to it — no spoofing.
call.post('/:id/quality', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const body = await c.req.json<{
    jitter_ms?: number | null;
    packet_loss_pct?: number | null;
    rtt_ms?: number | null;
    codec?: string | null;
  }>().catch(() => ({} as any));

  const db = c.env.DB;
  const result = await deriveRole(db, sessionId, sub);
  if (!result) return c.json({ error: 'Session not found or access denied' }, 403);
  const { role } = result;

  // Sanitize: clamp the few fields that have natural bounds + cap codec
  // length so a malicious client can't write arbitrary text into the row.
  const jitter = sanitizeMetric(body.jitter_ms, 0, 10_000);     // ms
  const loss   = sanitizeMetric(body.packet_loss_pct, 0, 100);  // %
  const rtt    = sanitizeMetric(body.rtt_ms, 0, 10_000);        // ms
  const codec  = typeof body.codec === 'string' ? body.codec.slice(0, 16) : null;

  // Skip the insert entirely if every field is null — saves a DB write
  // when the client posted before any real measurement was available.
  if (jitter === null && loss === null && rtt === null && !codec) {
    return c.json({ ok: true, recorded: false });
  }

  try {
    await db
      .prepare(
        `INSERT INTO call_quality (call_session_id, user_id, role, jitter_ms, packet_loss_pct, rtt_ms, codec)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(sessionId, sub, role, jitter, loss, rtt, codec)
      .run();
  } catch (err) {
    // Schema not yet healed (migration 0029) — fail open, don't break
    // the call.
    console.warn('[/:id/quality] insert failed (non-fatal):', err);
    return c.json({ ok: true, recorded: false });
  }

  return c.json({ ok: true, recorded: true });
});

/**
 * Clamp a numeric quality metric into a sane bound. Returns null for missing
 * / non-finite values so the column stores SQL NULL (vs. an invalid 0 that
 * would skew "avg jitter" aggregations).
 */
function sanitizeMetric(v: unknown, lo: number, hi: number): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

// Polling fallback: host checks if there's a pending incoming call for them
// Used by the host app when WebSocket is not connected or as a reliability backup
call.get('/pending-for-host', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const host = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<{ id: string }>();
  if (!host) return c.json(null);
  const cutoff = Math.floor(Date.now() / 1000) - 90;
  // FIX: also fetch caller.coins so we can compute max_seconds — without it the host
  // app's call timer has no upper bound (host UI keeps the call alive past the
  // caller's balance even though the server's atomic guard refuses to charge).
  const session = await db.prepare(
    `SELECT cs.id, cs.caller_id, cs.type as call_type, cs.rate_per_minute,
            u.name as caller_name, u.avatar_url as caller_avatar, u.coins as caller_coins
     FROM call_sessions cs
     JOIN users u ON u.id = cs.caller_id
     WHERE cs.host_id = ? AND cs.status = 'pending' AND cs.created_at > ?
     ORDER BY cs.created_at DESC LIMIT 1`
  ).bind(host.id, cutoff).first<any>();
  if (!session) return c.json(null);
  const rate = session.rate_per_minute ?? 5;
  const callerCoins = session.caller_coins ?? 0;
  const max_seconds = Math.floor((callerCoins / rate) * 60);
  // Strip caller_coins from the response (internal only) and append max_seconds
  const { caller_coins, ...rest } = session;
  return c.json({ ...rest, max_seconds });
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
  const session = await db.prepare('SELECT host_id FROM call_sessions WHERE id = ? AND caller_id = ?').bind(sessionId, sub).first<{ host_id: string }>();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  await db.prepare('INSERT OR IGNORE INTO ratings (id, host_id, user_id, call_session_id, stars, comment) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), session.host_id, sub, sessionId, starsVal, body.comment ?? null).run();
  const avg = await db.prepare('SELECT AVG(stars) as avg, COUNT(*) as cnt FROM ratings WHERE host_id = ?').bind(session.host_id).first<{ avg: number; cnt: number }>();
  await db.prepare('UPDATE hosts SET rating = ?, review_count = ? WHERE id = ?').bind(
    Math.round((avg?.avg ?? starsVal) * 10) / 10, avg?.cnt ?? 1, session.host_id
  ).run();
  // Auto level-up after rating update (best-effort — never fails the request).
  try {
    await applyLevelUp(c.env, session.host_id, 'auto');
  } catch (e) {
    console.warn('[/:id/rate] applyLevelUp failed:', e);
  }
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
