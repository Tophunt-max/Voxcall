// ============================================================================
// OTA console store — read/manage the self-hosted Expo Updates objects in R2.
//
// These helpers back the admin panel's OTA page. They read the EXACT same
// `ota/` keys that `ota-server/publish.mjs` writes and the OTA Worker
// (`ota-server/src/index.ts`) serves, so the console reflects live state:
//
//   ota/updates/<app>/<updateId>/update.json            ← the manifest record
//   ota/channels/<app>/<channel>/<runtimeVersion>.json  ← { updateId } pointer
//
// The console never publishes bundles (that stays in the CLI/CI, which needs
// `expo export`). It only MANAGES what's already published: view history,
// promote/rollback a channel pointer, and toggle the forced-update flag.
// ============================================================================

import type { Env } from '../types';

export const OTA_APPS = ['user', 'host'] as const;
export type OtaApp = (typeof OTA_APPS)[number];

export function isOtaApp(x: string): x is OtaApp {
  return (OTA_APPS as readonly string[]).includes(x);
}

// Mirror the key layout + sanitiser used by publish.mjs / the OTA Worker so
// pointers we write are found by clients and match what publish would produce.
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
const updatesPrefix = (app: OtaApp) => `ota/updates/${app}/`;
const updateKey = (app: OtaApp, id: string) => `ota/updates/${app}/${sanitize(id)}/update.json`;
const channelsPrefix = (app: OtaApp) => `ota/channels/${app}/`;
const pointerKey = (app: OtaApp, channel: string, rv: string) =>
  `ota/channels/${app}/${sanitize(channel)}/${sanitize(rv)}.json`;

export interface OtaUpdateRecord {
  id: string;
  createdAt?: string;
  runtimeVersion?: string;
  extra?: {
    forceUpdate?: boolean;
    message?: string;
    gitCommit?: string;
    publishedAt?: string;
    [k: string]: unknown;
  };
  platforms?: Record<string, unknown>;
}

export interface OtaPointer {
  channel: string;
  runtimeVersion: string;
  updateId: string;
  createdAt: string | null;
}

export interface OtaUpdateSummary {
  id: string;
  createdAt: string | null;
  runtimeVersion: string | null;
  forceUpdate: boolean;
  message: string | null;
  gitCommit: string | null;
  platforms: string[];
  liveOn: string[]; // "channel @ runtimeVersion" entries where this update is live
}

type MutationResult = { ok: true } | { ok: false; error: string; status: 400 | 404 };

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const obj = await env.STORAGE.get(key);
  if (!obj) return null;
  try {
    return await obj.json<T>();
  } catch {
    return null;
  }
}

// R2 list() paginates. Collect the "sub-directory" prefixes under `prefix`
// (bounded by a hard cap so a runaway bucket can never hang the request).
async function listDelimited(env: Env, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await env.STORAGE.list({ prefix, delimiter: '/', cursor, limit: 1000 });
    const dp = (res as { delimitedPrefixes?: string[] }).delimitedPrefixes;
    if (dp?.length) out.push(...dp);
    if (!res.truncated) break;
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
  }
  return out;
}

/** Every live channel pointer for an app (one per channel + runtimeVersion). */
export async function listPointers(env: Env, app: OtaApp): Promise<OtaPointer[]> {
  const channelDirs = await listDelimited(env, channelsPrefix(app));
  const results: OtaPointer[] = [];
  for (const dir of channelDirs) {
    const channel = dir.slice(channelsPrefix(app).length).replace(/\/$/, '');
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const res = await env.STORAGE.list({ prefix: dir, cursor, limit: 1000 });
      for (const o of res.objects) {
        if (!o.key.endsWith('.json')) continue;
        const rv = o.key.slice(dir.length).replace(/\.json$/, '');
        const ptr = await readJson<{ updateId?: string; createdAt?: string }>(env, o.key);
        if (ptr?.updateId) {
          results.push({ channel, runtimeVersion: rv, updateId: ptr.updateId, createdAt: ptr.createdAt ?? null });
        }
      }
      if (!res.truncated) break;
      cursor = (res as { cursor?: string }).cursor;
      if (!cursor) break;
    }
  }
  return results;
}

/** Full console state for an app: live channel pointers + update history. */
export async function getOtaState(
  env: Env,
  app: OtaApp,
): Promise<{ channels: OtaPointer[]; updates: OtaUpdateSummary[] }> {
  const [channels, updateDirs] = await Promise.all([
    listPointers(env, app),
    listDelimited(env, updatesPrefix(app)),
  ]);

  // Read each update record (bounded — an OTA channel has tens of updates,
  // not thousands; cap defensively so the request stays cheap).
  const capped = updateDirs.slice(0, 200);
  const records = await Promise.all(
    capped.map(async (dir) => {
      const id = dir.slice(updatesPrefix(app).length).replace(/\/$/, '');
      const rec = await readJson<OtaUpdateRecord>(env, updateKey(app, id));
      return { id, rec };
    }),
  );

  const liveByUpdate = new Map<string, string[]>();
  for (const ptr of channels) {
    const arr = liveByUpdate.get(ptr.updateId) ?? [];
    arr.push(`${ptr.channel} @ ${ptr.runtimeVersion}`);
    liveByUpdate.set(ptr.updateId, arr);
  }

  const updates: OtaUpdateSummary[] = records
    .filter((r): r is { id: string; rec: OtaUpdateRecord } => r.rec !== null)
    .map((r) => ({
      id: r.id,
      createdAt: r.rec.createdAt ?? null,
      runtimeVersion: r.rec.runtimeVersion ?? null,
      forceUpdate: r.rec.extra?.forceUpdate === true,
      message: typeof r.rec.extra?.message === 'string' ? r.rec.extra.message : null,
      gitCommit: typeof r.rec.extra?.gitCommit === 'string' ? r.rec.extra.gitCommit : null,
      platforms: r.rec.platforms ? Object.keys(r.rec.platforms) : [],
      liveOn: liveByUpdate.get(r.id) ?? [],
    }))
    // Newest first — ISO-8601 timestamps sort lexicographically.
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  return { channels, updates };
}

/**
 * Point a channel/runtimeVersion at a given update — this is both "promote"
 * (roll forward) and "rollback" (point back at an older update). Writing the
 * pointer is the single atomic act that makes an update go live, exactly like
 * the last step of publish.mjs.
 */
export async function promotePointer(
  env: Env,
  app: OtaApp,
  channel: string,
  runtimeVersion: string,
  updateId: string,
): Promise<MutationResult> {
  const rec = await readJson<OtaUpdateRecord>(env, updateKey(app, updateId));
  if (!rec) return { ok: false, error: 'update not found', status: 404 };
  // A client only accepts a manifest whose runtimeVersion matches its build.
  // Refuse to point a channel/runtimeVersion at an update built for a
  // different runtimeVersion — that update would be silently unreachable.
  if (rec.runtimeVersion && sanitize(rec.runtimeVersion) !== sanitize(runtimeVersion)) {
    return { ok: false, error: `runtimeVersion mismatch: update ${updateId} targets ${rec.runtimeVersion}`, status: 400 };
  }
  const createdAt = new Date().toISOString();
  await env.STORAGE.put(pointerKey(app, channel, runtimeVersion), JSON.stringify({ updateId, createdAt, runtimeVersion }), {
    httpMetadata: { contentType: 'application/json' },
  });
  return { ok: true };
}

/**
 * Toggle the forced-update flag on an already-published update by rewriting
 * its `update.json`. The Worker surfaces `extra` as `manifest.extra`, so if
 * this update is the live pointer the change takes effect on the next client
 * manifest poll — no re-publish needed.
 */
export async function setForce(env: Env, app: OtaApp, updateId: string, force: boolean): Promise<MutationResult> {
  const rec = await readJson<OtaUpdateRecord>(env, updateKey(app, updateId));
  if (!rec) return { ok: false, error: 'update not found', status: 404 };
  rec.extra = { ...(rec.extra ?? {}), forceUpdate: force };
  await env.STORAGE.put(updateKey(app, updateId), JSON.stringify(rec, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  return { ok: true };
}
