// ============================================================================
// Connected-user presence helpers (thin wrappers over the PresenceRegistry DO).
// ============================================================================
//
// These are the ONLY functions the rest of the code should call to record who
// is connected and to fan a realtime message out to connected users. They hide
// the sharding (see durable-objects/PresenceRegistry.ts) behind a simple API:
//
//   registerConnected(env, userId, role)   — call when a user's FIRST socket opens
//   unregisterConnected(env, userId)        — call when their LAST socket closes
//   broadcastToConnected(env, message, aud) — push to every connected user
//
// All are best-effort: a registry error must never break a WebSocket handshake
// or an admin request, so every call swallows its own errors.
// ============================================================================

import type { Env } from '../types';
import {
  presenceShardName,
  allPresenceShardNames,
  type BroadcastRole,
} from '../durable-objects/PresenceRegistry';

function shard(env: Env, name: string) {
  return env.PRESENCE_REGISTRY.get(env.PRESENCE_REGISTRY.idFromName(name));
}

/** Record that `userId` (a `user` or `host`) now has a live socket. */
export async function registerConnected(
  env: Env,
  userId: string,
  role: 'user' | 'host',
): Promise<void> {
  try {
    await shard(env, presenceShardName(userId)).fetch('https://dummy/register', {
      method: 'POST',
      body: JSON.stringify({ userId, role }),
    });
  } catch (e) {
    console.warn('[presence] registerConnected failed for', userId, e);
  }
}

/** Record that `userId`'s last socket has closed. */
export async function unregisterConnected(env: Env, userId: string): Promise<void> {
  try {
    await shard(env, presenceShardName(userId)).fetch('https://dummy/unregister', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  } catch (e) {
    console.warn('[presence] unregisterConnected failed for', userId, e);
  }
}

/**
 * Push a realtime message to every CONNECTED user (optionally filtered by
 * audience). Fans the work across all registry shards in parallel; each shard
 * pushes only to its own connected members. Returns the total number of
 * sockets the message reached (best-effort count).
 */
export async function broadcastToConnected(
  env: Env,
  message: Record<string, unknown>,
  audience: BroadcastRole = 'all',
): Promise<number> {
  const payload = JSON.stringify({ message, audience });
  const results = await Promise.allSettled(
    allPresenceShardNames().map(async (name) => {
      const res = await shard(env, name).fetch('https://dummy/broadcast', {
        method: 'POST',
        body: payload,
      });
      const data = (await res.json().catch(() => ({}))) as { pushed?: number };
      return data.pushed ?? 0;
    }),
  );
  return results.reduce(
    (sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0),
    0,
  );
}
