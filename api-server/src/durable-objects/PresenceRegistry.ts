// ============================================================================
// PresenceRegistry Durable Object — the "who is connected right now" index.
// ============================================================================
//
// WHY THIS EXISTS (scalability):
//   The old broadcast path (`broadcastDataChanged`) did
//     SELECT id FROM users ... LIMIT 10000
//   and then POSTed a message to EVERY user's NotificationHub. Two problems at
//   scale:
//     1. LIMIT 10000 silently truncated — past 10k users, some clients NEVER
//        received admin catalog updates.
//     2. It fanned out to EVERY user, including the ~95% who are offline. A
//        push to an offline user's hub does nothing but still costs a Durable
//        Object subrequest — and a single Worker invocation is capped at ~1000
//        subrequests, so the fan-out itself broke well before 10k users.
//
//   A `data_changed` / presence push is only useful to a user with a LIVE
//   WebSocket. This registry keeps the (small) set of currently-connected users
//   so broadcasts target only them — bounded, complete, and cheap.
//
// SHARDING:
//   A single registry DO would serialize every connect/disconnect and cap the
//   broadcast fan-out at one invocation's subrequest budget. We shard across
//   PRESENCE_SHARDS instances (by a stable hash of userId). Each shard holds a
//   slice of the connected set, so:
//     • connect/disconnect writes spread across shards, and
//     • a broadcast is PRESENCE_SHARDS parallel fan-outs, each pushing to only
//       its own members — so the effective concurrent-connection ceiling is
//       roughly PRESENCE_SHARDS * (per-invocation subrequest budget).
//   With 16 shards that comfortably covers tens of thousands of concurrent
//   sockets; raise PRESENCE_SHARDS (and redeploy) if you outgrow it.
//
// STATE:
//   Membership lives in Durable Object STORAGE (not in-memory) so it survives
//   hibernation/eviction — an evicted in-memory set would make connected users
//   look offline and silently drop their broadcasts. Keys are `u:<userId>` with
//   the user's role as the value, so a broadcast can filter by audience
//   (all / user / host) without a DB read.
// ============================================================================

import type { Env } from '../types';

/** Number of registry shards. Must stay stable across deploys (changing it
 * re-buckets users, briefly stranding existing entries until they reconnect).
 */
export const PRESENCE_SHARDS = 16;

export type BroadcastRole = 'user' | 'host' | 'all';

/** Stable, cheap hash → shard index. Deterministic for a given userId so
 * register/unregister/broadcast all address the same shard. */
function shardIndexFor(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % PRESENCE_SHARDS;
}

/** DO name for the shard that owns `userId`. */
export function presenceShardName(userId: string): string {
  return `presence-shard-${shardIndexFor(userId)}`;
}

/** All shard names (used to fan a broadcast across every shard). */
export function allPresenceShardNames(): string[] {
  return Array.from({ length: PRESENCE_SHARDS }, (_, i) => `presence-shard-${i}`);
}

export class PresenceRegistry {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/register':
          return await this.register(request);
        case '/unregister':
          return await this.unregister(request);
        case '/broadcast':
          return await this.broadcast(request);
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (e) {
      // A registry failure must never surface to the caller (best-effort
      // realtime). Log and return ok so the WS handshake / admin request
      // continues unaffected.
      console.warn('[PresenceRegistry] handler error:', e);
      return new Response(JSON.stringify({ ok: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  private async register(request: Request): Promise<Response> {
    const { userId, role } = (await request.json()) as { userId?: string; role?: string };
    if (userId) {
      await this.state.storage.put(`u:${userId}`, role === 'host' ? 'host' : 'user');
    }
    return this.ok();
  }

  private async unregister(request: Request): Promise<Response> {
    const { userId } = (await request.json()) as { userId?: string };
    if (userId) {
      await this.state.storage.delete(`u:${userId}`);
    }
    return this.ok();
  }

  // Fan a message out to this shard's connected members, filtered by audience.
  // Pushes to each member's NotificationHub in bounded chunks so a large shard
  // still respects the per-invocation subrequest budget.
  private async broadcast(request: Request): Promise<Response> {
    const { message, audience } = (await request.json()) as {
      message?: unknown;
      audience?: BroadcastRole;
    };
    if (message == null) return this.ok();

    const entries = await this.state.storage.list<string>({ prefix: 'u:' });
    const wantRole: BroadcastRole = audience === 'user' || audience === 'host' ? audience : 'all';

    const targets: string[] = [];
    for (const [key, role] of entries) {
      if (wantRole !== 'all' && role !== wantRole) continue;
      targets.push(key.slice(2)); // strip "u:" prefix
    }
    if (targets.length === 0) return this.ok(0);

    const body = JSON.stringify(message);
    const CHUNK = 50;
    let pushed = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      const results = await Promise.allSettled(
        chunk.map(async (uid) => {
          const stub = this.env.NOTIFICATION_HUB.get(
            this.env.NOTIFICATION_HUB.idFromName(uid),
          );
          await stub.fetch('https://dummy/notify', { method: 'POST', body });
        }),
      );
      pushed += results.filter((r) => r.status === 'fulfilled').length;
    }
    return this.ok(pushed);
  }

  private ok(pushed?: number): Response {
    return new Response(JSON.stringify({ ok: true, pushed: pushed ?? undefined }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
