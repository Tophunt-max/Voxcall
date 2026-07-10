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
