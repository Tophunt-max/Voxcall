// ============================================================================
// Console data layer — reads/manages the same ota/ R2 objects the manifest
// endpoint serves. Pure functions over the R2 bucket; no HTTP concerns here.
// ============================================================================

import {
  type Env,
  type UpdateRecord,
  CHANNELS_PREFIX,
  UPDATES_PREFIX,
  sanitize,
} from '../shared';

export interface ConsolePointer {
  channel: string;
  runtimeVersion: string;
  updateId: string;
  createdAt: string | null;
}

export interface ConsoleUpdate {
  id: string;
  createdAt: string | null;
  runtimeVersion: string | null;
  runtimeVersions: string[];
  forceUpdate: boolean;
  message: string | null;
  gitCommit: string | null;
  platforms: string[];
  liveOn: string[];
}

export type MutationResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

async function readJsonKey<T>(env: Env, key: string): Promise<T | null> {
  const obj = await env.STORAGE.get(key);
  if (!obj) return null;
  try {
    return (await obj.json()) as T;
  } catch {
    return null;
  }
}

// Collect the "sub-directory" prefixes under `prefix` (bounded so a runaway
// bucket can never hang the request).
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

/** Every distinct runtimeVersion an update covers (top-level + per-platform). */
export function updateRuntimeVersions(rec: UpdateRecord): string[] {
  const set = new Set<string>();
  if (rec.runtimeVersion) set.add(rec.runtimeVersion);
  if (rec.platforms) {
    for (const p of Object.values(rec.platforms)) {
      if (p?.runtimeVersion) set.add(p.runtimeVersion);
    }
  }
  return [...set];
}

async function listConsolePointers(env: Env, app: string): Promise<ConsolePointer[]> {
  const base = `${CHANNELS_PREFIX}/${app}/`;
  const channelDirs = await listDelimited(env, base);
  const results: ConsolePointer[] = [];
  for (const dir of channelDirs) {
    const channel = dir.slice(base.length).replace(/\/$/, '');
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const res = await env.STORAGE.list({ prefix: dir, cursor, limit: 1000 });
      for (const o of res.objects) {
        if (!o.key.endsWith('.json')) continue;
        const rv = o.key.slice(dir.length).replace(/\.json$/, '');
        const ptr = await readJsonKey<{ updateId?: string; createdAt?: string }>(env, o.key);
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

/** Live channel pointers + the update history for an app (used by the dashboard). */
export async function getConsoleState(
  env: Env,
  app: string,
): Promise<{ channels: ConsolePointer[]; updates: ConsoleUpdate[] }> {
  const base = `${UPDATES_PREFIX}/${app}/`;
  const [channels, updateDirs] = await Promise.all([listConsolePointers(env, app), listDelimited(env, base)]);

  const capped = updateDirs.slice(0, 200);
  const records = await Promise.all(
    capped.map(async (dir) => {
      const id = dir.slice(base.length).replace(/\/$/, '');
      const rec = await readJsonKey<UpdateRecord>(env, `${UPDATES_PREFIX}/${app}/${id}/update.json`);
      return { id, rec };
    }),
  );

  const liveByUpdate = new Map<string, string[]>();
  for (const ptr of channels) {
    const arr = liveByUpdate.get(ptr.updateId) ?? [];
    arr.push(`${ptr.channel} @ ${ptr.runtimeVersion}`);
    liveByUpdate.set(ptr.updateId, arr);
  }

  const updates: ConsoleUpdate[] = records
    .filter((r): r is { id: string; rec: UpdateRecord } => r.rec !== null)
    .map((r) => ({
      id: r.id,
      createdAt: r.rec.createdAt ?? null,
      runtimeVersion: r.rec.runtimeVersion ?? null,
      runtimeVersions: updateRuntimeVersions(r.rec),
      forceUpdate: (r.rec.extra as { forceUpdate?: boolean })?.forceUpdate === true,
      message:
        typeof (r.rec.extra as { message?: unknown })?.message === 'string'
          ? (r.rec.extra as { message: string }).message
          : null,
      gitCommit:
        typeof (r.rec.extra as { gitCommit?: unknown })?.gitCommit === 'string'
          ? (r.rec.extra as { gitCommit: string }).gitCommit
          : null,
      platforms: r.rec.platforms ? Object.keys(r.rec.platforms) : [],
      liveOn: liveByUpdate.get(r.id) ?? [],
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  return { channels, updates };
}

/**
 * Full detail for one update: metadata + per-platform launch asset & asset list
 * with content-addressed download URLs (through this worker's /assets route).
 */
export async function getUpdateDetail(
  env: Env,
  app: string,
  id: string,
  origin: string,
): Promise<Record<string, unknown> | null> {
  const rec = await readJsonKey<UpdateRecord>(env, `${UPDATES_PREFIX}/${app}/${id}/update.json`);
  if (!rec) return null;
  const assetUrl = (storageKey: string) => `${origin}/assets?key=${encodeURIComponent(storageKey)}`;
  const platforms: Record<string, unknown> = {};
  for (const [p, pr] of Object.entries(rec.platforms ?? {})) {
    if (!pr) continue;
    platforms[p] = {
      runtimeVersion: pr.runtimeVersion ?? rec.runtimeVersion,
      launchAsset: {
        key: pr.launchAsset.key,
        hash: pr.launchAsset.hash,
        contentType: pr.launchAsset.contentType,
        url: assetUrl(pr.launchAsset.storageKey),
      },
      assetCount: pr.assets?.length ?? 0,
      assets: (pr.assets ?? []).map((a) => ({
        key: a.key,
        hash: a.hash,
        contentType: a.contentType,
        fileExtension: a.fileExtension ?? null,
        url: assetUrl(a.storageKey),
      })),
    };
  }
  const extra = (rec.extra ?? {}) as Record<string, unknown>;
  const eas = extra.eas as { projectId?: string } | undefined;
  return {
    id: rec.id,
    createdAt: rec.createdAt ?? null,
    runtimeVersion: rec.runtimeVersion ?? null,
    runtimeVersions: updateRuntimeVersions(rec),
    forceUpdate: extra.forceUpdate === true,
    message: typeof extra.message === 'string' ? extra.message : null,
    gitCommit: typeof extra.gitCommit === 'string' ? extra.gitCommit : null,
    publishedAt: typeof extra.publishedAt === 'string' ? extra.publishedAt : null,
    easProjectId: eas?.projectId ?? null,
    manifestUrl: `${origin}/manifest/${app}`,
    platforms,
  };
}

/**
 * Make an update live on a channel (promote OR rollback). Writes one pointer
 * per runtimeVersion the update covers, so both platforms roll together.
 */
export async function promoteUpdate(
  env: Env,
  app: string,
  channel: string,
  updateId: string,
): Promise<MutationResult<{ runtimeVersions: string[] }>> {
  const rec = await readJsonKey<UpdateRecord>(env, `${UPDATES_PREFIX}/${app}/${updateId}/update.json`);
  if (!rec) return { ok: false, status: 404, error: 'update not found' };
  const runtimeVersions = updateRuntimeVersions(rec);
  if (runtimeVersions.length === 0) return { ok: false, status: 400, error: 'update has no runtimeVersion' };
  const createdAt = new Date().toISOString();
  await Promise.all(
    runtimeVersions.map((rv) =>
      env.STORAGE.put(
        `${CHANNELS_PREFIX}/${app}/${sanitize(channel)}/${sanitize(rv)}.json`,
        JSON.stringify({ updateId, createdAt, runtimeVersion: rv }),
        { httpMetadata: { contentType: 'application/json' } },
      ),
    ),
  );
  return { ok: true, runtimeVersions };
}

/**
 * Toggle the mandatory-update flag by rewriting the update record. If the update
 * is the live pointer, clients see it on their next manifest poll.
 */
export async function setForceFlag(
  env: Env,
  app: string,
  updateId: string,
  force: boolean,
): Promise<MutationResult> {
  const key = `${UPDATES_PREFIX}/${app}/${updateId}/update.json`;
  const rec = await readJsonKey<UpdateRecord>(env, key);
  if (!rec) return { ok: false, status: 404, error: 'update not found' };
  rec.extra = { ...(rec.extra ?? {}), forceUpdate: force };
  await env.STORAGE.put(key, JSON.stringify(rec, null, 2), { httpMetadata: { contentType: 'application/json' } });
  return { ok: true };
}
