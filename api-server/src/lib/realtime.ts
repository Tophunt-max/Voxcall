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
  opts?: { data?: Record<string, string>; realtime?: boolean },
): Promise<void> {
  const id = 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const createdAt = Math.floor(Date.now() / 1000);
  const safeTitle = title.slice(0, 100);
  const safeBody = body.slice(0, 500);
  const dataJson = opts?.data ? JSON.stringify(opts.data) : '{}';
  try {
    await env.DB.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, userId, type, safeTitle, safeBody, dataJson, createdAt)
      .run();
  } catch (e) {
    console.warn('[realtime] notifyUser DB insert failed for', userId, e);
  }
  // Real-time in-app delivery: push notification_new so an OPEN app prepends it
  // to the list + bumps the unread badge + shows a toast — no refetch needed.
  // Suppressed (realtime:false) for events that already have their own rich
  // live toast (tips/reviews/favorites) to avoid a double toast.
  if (opts?.realtime !== false) {
    await pushToUser(env, userId, {
      type: 'notification_new',
      notification: { id, type, title: safeTitle, body: safeBody, data: opts?.data ?? {}, is_read: 0, created_at: createdAt },
      timestamp: Date.now(),
    });
  }
  // FCM push (delivers when app is backgrounded/closed). `data` carries the
  // semantic type so the tap handler can deep-link to the right screen.
  try {
    const tokens = await getFCMTokens(env.DB, [userId]);
    if (tokens.length > 0) {
      // Pass env.DB so any UNREGISTERED tokens are pruned from the user row.
      await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, tokens, safeTitle, safeBody, { type, notif_type: type, ...(opts?.data ?? {}) }, env.DB);
    }
  } catch (e) {
    console.warn('[realtime] notifyUser FCM push failed for', userId, e);
  }
}


// ─── Generic single-user push ────────────────────────────────────────────────
/** Push an arbitrary real-time message to one user's connected apps. */
export async function pushToUser(env: Env, userId: string, message: Record<string, unknown>): Promise<void> {
  try {
    const stub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(userId));
    await stub.fetch('https://dummy/notify', { method: 'POST', body: JSON.stringify(message) });
  } catch (e) {
    console.warn('[realtime] pushToUser failed for', userId, e);
  }
}

/**
 * Push the account ban / unban state so the app can show (or dismiss) its
 * blocking ban popup instantly — WITHOUT logging the user out. `reason` and
 * `expires_at` are surfaced in the popup. Fans out to every account bound to a
 * banned device as well.
 */
export async function pushBanState(
  env: Env,
  opts: { userId?: string | null; deviceId?: string | null; banned: boolean; reason?: string | null; expiresAt?: string | null },
): Promise<void> {
  const msg = opts.banned
    ? { type: 'account_banned', reason: opts.reason ?? null, expires_at: opts.expiresAt ?? null, timestamp: Date.now() }
    : { type: 'account_unbanned', timestamp: Date.now() };
  const ids = new Set<string>();
  if (opts.userId) ids.add(opts.userId);
  if (opts.deviceId) {
    try {
      const rows = await env.DB.prepare("SELECT id FROM users WHERE device_id = ? AND status != 'deleted' LIMIT 200")
        .bind(opts.deviceId).all<{ id: string }>();
      for (const r of rows.results ?? []) ids.add(r.id);
    } catch { /* best-effort */ }
  }
  await Promise.allSettled([...ids].map((uid) => pushToUser(env, uid, msg)));
}
