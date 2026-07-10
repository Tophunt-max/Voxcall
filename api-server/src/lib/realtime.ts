// ============================================================================
// Real-time data-change broadcasts.
// ============================================================================
//
// Admin catalog edits (coin plans, gifts, banners, talk topics, rewards, …)
// used to reach the user / host apps only when a screen was (re)opened, because
// nothing pushed a signal over the WebSocket. `broadcastDataChanged` sends a
// lightweight `data_changed` message to every connected client so any screen
// currently mounted can invalidate its cache and refetch instantly.
//
// The message is intentionally tiny — just the resource name, NOT the payload.
// Clients decide what to refetch. This keeps the fan-out cheap even for a large
// connected user base and avoids shipping stale/oversized data over the socket.
//
// Fan-out mirrors the existing settings broadcast: the NotificationHub is a
// per-user Durable Object, so "broadcast to everyone" means iterating user ids
// in chunks and POSTing to each hub. Admin catalog edits are rare, so the cost
// is acceptable and it always runs via ctx.waitUntil (never blocks the response).
// ============================================================================

import type { Env } from '../types';

export type BroadcastAudience = 'all' | 'user' | 'host';

const CHUNK_SIZE = 50;

export async function broadcastDataChanged(
  env: Env,
  resource: string,
  audience: BroadcastAudience = 'all',
): Promise<void> {
  try {
    let where = "status != 'deleted'";
    if (audience === 'user') where += " AND role = 'user'";
    else if (audience === 'host') where += " AND role = 'host'";

    const rows = await env.DB.prepare(
      `SELECT id FROM users WHERE ${where} LIMIT 10000`,
    ).all<{ id: string }>();
    const users = rows.results ?? [];
    if (users.length === 0) return;

    const msg = JSON.stringify({
      type: 'data_changed',
      resource,
      timestamp: Date.now(),
    });

    for (let i = 0; i < users.length; i += CHUNK_SIZE) {
      const chunk = users.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(
        chunk.map(async (u) => {
          try {
            const stub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(u.id));
            await stub.fetch('https://dummy/notify', { method: 'POST', body: msg });
          } catch {
            /* one hub failing must not abort the rest of the broadcast */
          }
        }),
      );
    }
  } catch (e) {
    // A broadcast failure must never surface to the admin request.
    console.warn('[realtime] broadcastDataChanged failed for', resource, e);
  }
}


// ─── Per-user real-time helpers ──────────────────────────────────────────────
// Admin actions that change ONE user's balance or need to reach ONE user
// (withdrawal/deposit decisions, host-application review, support replies) go
// through these instead of the broadcast fan-out above.

import { getFCMTokens, sendFCMPush } from './fcm';

/**
 * Push the user's CURRENT coin balance to their app in real time so the wallet
 * updates instantly (client listens for `coin_update`). Used after admin coin
 * adjustments, withdrawal-reject refunds, and deposit approvals/refunds.
 */
export async function pushCoinUpdate(env: Env, userId: string, delta?: number): Promise<void> {
  try {
    const row = await env.DB.prepare('SELECT coins FROM users WHERE id = ?')
      .bind(userId)
      .first<{ coins: number }>();
    if (!row) return;
    const stub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(userId));
    await stub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({
        type: 'coin_update',
        amount: delta ?? 0,
        new_balance: row.coins ?? 0,
      }),
    });
  } catch (e) {
    console.warn('[realtime] pushCoinUpdate failed for', userId, e);
  }
}

/**
 * Notify a single user: persist a notification row (so it appears in their
 * in-app notifications list) AND send an FCM push (so they see it even when the
 * app is closed). Mirrors POST /admin/notifications/send for one recipient.
 * Best-effort — never throws.
 */
export async function notifyUser(
  env: Env,
  userId: string,
  title: string,
  body: string,
  type: string = 'system',
): Promise<void> {
  try {
    const id = 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    await env.DB.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, userId, type, title.slice(0, 100), body.slice(0, 500), Math.floor(Date.now() / 1000))
      .run();
  } catch (e) {
    console.warn('[realtime] notifyUser DB insert failed for', userId, e);
  }
  try {
    const tokens = await getFCMTokens(env.DB, [userId]);
    if (tokens.length > 0) {
      await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, tokens, title, body, { type, notif_type: type });
    }
  } catch (e) {
    console.warn('[realtime] notifyUser FCM push failed for', userId, e);
  }
}
