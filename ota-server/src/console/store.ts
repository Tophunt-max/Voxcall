// ============================================================================
// Console data layer — reads/manages the same ota/ R2 objects the manifest
// endpoint serves. Pure functions over the R2 bucket; no HTTP concerns here.
// ============================================================================

import {
  type Env,
  type UpdateRecord,
  CHANNELS_PREFIX,
  UPDATES_PREFIX,
  METRICS_PREFIX,
  BUILDS_PREFIX,
  HEALTH_PREFIX,
  sanitize,
} from '../shared';

export interface ConsolePointer {
  channel: string;
  runtimeVersion: string;
  updateId: string;
  createdAt: string | null;
  rollout: number; // 1..100 — percentage of devices this pointer is served to
  rollBackToEmbedded?: boolean; // channel is serving a "roll back to embedded" directive
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
        const ptr = await readJsonKey<{ updateId?: string; createdAt?: string; rollout?: number; rollBackToEmbedded?: boolean }>(env, o.key);
        if (ptr?.rollBackToEmbedded) {
          results.push({
            channel,
            runtimeVersion: rv,
            updateId: '',
            createdAt: ptr.createdAt ?? null,
            rollout: 100,
            rollBackToEmbedded: true,
          });
        } else if (ptr?.updateId) {
          results.push({
            channel,
            runtimeVersion: rv,
            updateId: ptr.updateId,
            createdAt: ptr.createdAt ?? null,
            rollout: typeof ptr.rollout === 'number' ? ptr.rollout : 100,
          });
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
  rollout = 100,
): Promise<MutationResult<{ runtimeVersions: string[]; rollout: number }>> {
  const rec = await readJsonKey<UpdateRecord>(env, `${UPDATES_PREFIX}/${app}/${updateId}/update.json`);
  if (!rec) return { ok: false, status: 404, error: 'update not found' };
  const runtimeVersions = updateRuntimeVersions(rec);
  if (runtimeVersions.length === 0) return { ok: false, status: 400, error: 'update has no runtimeVersion' };
  const pct = clampRollout(rollout);
  const createdAt = new Date().toISOString();
  await Promise.all(
    runtimeVersions.map((rv) =>
      env.STORAGE.put(
        `${CHANNELS_PREFIX}/${app}/${sanitize(channel)}/${sanitize(rv)}.json`,
        JSON.stringify({ updateId, createdAt, runtimeVersion: rv, rollout: pct }),
        { httpMetadata: { contentType: 'application/json' } },
      ),
    ),
  );
  return { ok: true, runtimeVersions, rollout: pct };
}

function clampRollout(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(100, Math.round(n)));
}

/**
 * Change the rollout percentage of a channel's current release (every pointer
 * under that channel). Use this to gradually widen a staged rollout to 100%
 * without re-publishing. Rewrites each pointer's `rollout` field in place.
 */
export async function setRollout(
  env: Env,
  app: string,
  channel: string,
  rollout: number,
): Promise<MutationResult<{ rollout: number }>> {
  const dir = `${CHANNELS_PREFIX}/${app}/${sanitize(channel)}/`;
  const pct = clampRollout(rollout);
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await env.STORAGE.list({ prefix: dir, cursor, limit: 1000 });
    for (const o of res.objects) if (o.key.endsWith('.json')) keys.push(o.key);
    if (!res.truncated) break;
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
  }
  if (!keys.length) return { ok: false, status: 404, error: 'no live pointer for this channel' };
  await Promise.all(
    keys.map(async (k) => {
      const ptr = await readJsonKey<Record<string, unknown>>(env, k);
      if (!ptr) return;
      ptr.rollout = pct;
      await env.STORAGE.put(k, JSON.stringify(ptr), { httpMetadata: { contentType: 'application/json' } });
    }),
  );
  return { ok: true, rollout: pct };
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

// ─── App builds (installable APK/IPA distribution) ──────────────────────────
// Stored under ota/builds/<app>/<buildId>/ — either an uploaded binary + a
// build.json record, or a build.json that just points at an external URL (a
// store / EAS / CDN link). Downloads are served publicly via the worker's
// /download route (the buildId is an unguessable UUID), so testers can install
// without the console token — the standard way ad-hoc/test builds are shared.
// (BUILDS_PREFIX is defined in ../shared.)

export interface BuildRecord {
  id: string;
  app: string;
  channel: string; // 'production' | 'preview' | 'staging' | …
  platform: string; // 'android' | 'ios'
  version: string;
  buildNumber: string;
  notes: string;
  createdAt: string;
  storageKey?: string; // set when the binary was uploaded to R2
  externalUrl?: string; // set when registered by URL instead of uploaded
  filename?: string;
  size?: number;
  contentType?: string;
  bundleId?: string; // app bundle identifier (for the iOS itms-services manifest)
}

export interface BuildInput {
  channel: string;
  platform: string;
  version: string;
  buildNumber: string;
  notes: string;
  filename?: string;
  externalUrl?: string;
  contentType?: string;
  bundleId?: string;
}

function mimeForFilename(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'apk') return 'application/vnd.android.package-archive';
  // .aab and .ipa have no universally-honored install MIME; octet-stream is safe.
  return 'application/octet-stream';
}

/** Download URL for a build: the worker /download route (uploaded) or the external link. */
export function buildDownloadUrl(rec: BuildRecord, origin: string): string {
  if (rec.storageKey) {
    const name = rec.filename ? `&name=${encodeURIComponent(rec.filename)}` : '';
    return `${origin}/download?key=${encodeURIComponent(rec.storageKey)}${name}`;
  }
  return rec.externalUrl || '';
}

export async function listBuilds(env: Env, app: string): Promise<BuildRecord[]> {
  const base = `${BUILDS_PREFIX}/${app}/`;
  const dirs = await listDelimited(env, base);
  const recs = await Promise.all(
    dirs.map((dir) => {
      const id = dir.slice(base.length).replace(/\/$/, '');
      return readJsonKey<BuildRecord>(env, `${base}${id}/build.json`);
    }),
  );
  return recs
    .filter((r): r is BuildRecord => r !== null)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Register a build that lives at an external URL (store / EAS / CDN link). */
export async function registerBuild(env: Env, app: string, input: BuildInput): Promise<BuildRecord> {
  const id = crypto.randomUUID();
  const rec: BuildRecord = {
    id,
    app,
    channel: input.channel,
    platform: input.platform,
    version: input.version,
    buildNumber: input.buildNumber,
    notes: input.notes,
    createdAt: new Date().toISOString(),
    externalUrl: input.externalUrl,
    filename: input.filename || undefined,
    bundleId: input.bundleId || undefined,
  };
  await env.STORAGE.put(`${BUILDS_PREFIX}/${app}/${id}/build.json`, JSON.stringify(rec, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  return rec;
}

/** Stream an uploaded binary to R2 and write its build.json record. */
export async function saveUploadedBuild(
  env: Env,
  app: string,
  input: BuildInput,
  body: ReadableStream,
): Promise<BuildRecord> {
  const id = crypto.randomUUID();
  const safeName = sanitize(input.filename || 'app.bin');
  const storageKey = `${BUILDS_PREFIX}/${app}/${id}/${safeName}`;
  const contentType =
    input.contentType && input.contentType !== 'application/octet-stream'
      ? input.contentType
      : mimeForFilename(safeName);
  const put = await env.STORAGE.put(storageKey, body, { httpMetadata: { contentType } });
  const rec: BuildRecord = {
    id,
    app,
    channel: input.channel,
    platform: input.platform,
    version: input.version,
    buildNumber: input.buildNumber,
    notes: input.notes,
    createdAt: new Date().toISOString(),
    storageKey,
    filename: safeName,
    size: (put as { size?: number })?.size,
    contentType,
    bundleId: input.bundleId || undefined,
  };
  await env.STORAGE.put(`${BUILDS_PREFIX}/${app}/${id}/build.json`, JSON.stringify(rec, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  return rec;
}

// ─── Adoption metrics ───────────────────────────────────────────────────────
// Tally the per-install adoption records the manifest endpoint writes (one R2
// object per device, customMetadata = { u:updateId, rv, p:platform, t:ts }).
// Uses list({ include:['customMetadata'] }) so counting needs no per-object
// reads. Bounded so a huge install base can never hang the request.

export interface MetricsSummary {
  total: number;
  active24h: number;
  active7d: number;
  byUpdate: Record<string, number>;
  byPlatform: Record<string, number>;
  truncated: boolean;
}

export async function getMetrics(env: Env, app: string): Promise<MetricsSummary> {
  const prefix = `${METRICS_PREFIX}/${app}/clients/`;
  const byUpdate: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  let total = 0;
  let active24h = 0;
  let active7d = 0;
  let truncated = false;
  const now = Date.now();
  const DAY = 86400000;
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    // `include: ['customMetadata']` is a valid R2 runtime option; the installed
    // workers-types just omits it from R2ListOptions, so widen the type here.
    const res = await env.STORAGE.list({
      prefix,
      cursor,
      limit: 1000,
      include: ['customMetadata'],
    } as R2ListOptions & { include: ('httpMetadata' | 'customMetadata')[] });
    for (const o of res.objects) {
      total++;
      const md = (o as { customMetadata?: Record<string, string> }).customMetadata || {};
      const u = md.u || 'embedded';
      byUpdate[u] = (byUpdate[u] || 0) + 1;
      const p = md.p || 'unknown';
      byPlatform[p] = (byPlatform[p] || 0) + 1;
      const t = Number(md.t || 0);
      if (t) {
        if (now - t < DAY) active24h++;
        if (now - t < 7 * DAY) active7d++;
      }
    }
    if (!res.truncated) break;
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
    if (i === 19) truncated = true;
  }
  return { total, active24h, active7d, byUpdate, byPlatform, truncated };
}

/** Delete a build (its record + any uploaded binary). */
export async function deleteBuild(env: Env, app: string, id: string): Promise<MutationResult> {
  const base = `${BUILDS_PREFIX}/${app}/${sanitize(id)}/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await env.STORAGE.list({ prefix: base, cursor, limit: 1000 });
    for (const o of res.objects) keys.push(o.key);
    if (!res.truncated) break;
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
  }
  if (!keys.length) return { ok: false, status: 404, error: 'build not found' };
  await Promise.all(keys.map((k) => env.STORAGE.delete(k)));
  return { ok: true };
}


// ─── Rollback to embedded (kill-switch) ─────────────────────────────────────
// Rewrites every live pointer under a channel to a "rollBackToEmbedded"
// directive. Clients currently running an OTA update revert to the bundle
// embedded in their installed build on their next check — the safest way to
// pull a bad update. Returns the runtime versions affected.
export async function setRollbackToEmbedded(
  env: Env,
  app: string,
  channel: string,
): Promise<MutationResult<{ runtimeVersions: string[] }>> {
  const dir = `${CHANNELS_PREFIX}/${app}/${sanitize(channel)}/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await env.STORAGE.list({ prefix: dir, cursor, limit: 1000 });
    for (const o of res.objects) if (o.key.endsWith('.json')) keys.push(o.key);
    if (!res.truncated) break;
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
  }
  if (!keys.length) return { ok: false, status: 404, error: 'no live pointer for this channel' };
  const commitTime = new Date().toISOString();
  const runtimeVersions: string[] = [];
  await Promise.all(
    keys.map(async (k) => {
      runtimeVersions.push(k.slice(dir.length).replace(/\.json$/, ''));
      await env.STORAGE.put(
        k,
        JSON.stringify({ rollBackToEmbedded: true, commitTime, createdAt: commitTime }),
        { httpMetadata: { contentType: 'application/json' } },
      );
    }),
  );
  return { ok: true, runtimeVersions };
}

// ─── Update health (client-reported apply/launch outcomes) ──────────────────
// The app posts to /report after applying/launching an update; we keep a small
// aggregate per update (best-effort, read-modify-write like the adoption metric).
export interface UpdateHealth {
  ok: number;
  err: number;
  lastError: string | null;
  updatedAt: string;
}

export async function recordUpdateResult(
  env: Env,
  app: string,
  updateId: string,
  outcome: 'ok' | 'error',
  message?: string,
): Promise<UpdateHealth> {
  const key = `${HEALTH_PREFIX}/${app}/${sanitize(updateId)}.json`;
  const cur =
    (await readJsonKey<UpdateHealth>(env, key)) ?? { ok: 0, err: 0, lastError: null, updatedAt: '' };
  if (outcome === 'error') {
    cur.err += 1;
    if (message) cur.lastError = message.slice(0, 300);
  } else {
    cur.ok += 1;
  }
  cur.updatedAt = new Date().toISOString();
  await env.STORAGE.put(key, JSON.stringify(cur), { httpMetadata: { contentType: 'application/json' } });
  return cur;
}

export async function getHealthMap(env: Env, app: string): Promise<Record<string, UpdateHealth>> {
  const prefix = `${HEALTH_PREFIX}/${app}/`;
  const out: Record<string, UpdateHealth> = {};
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await env.STORAGE.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects) {
      if (!o.key.endsWith('.json')) continue;
      const id = o.key.slice(prefix.length).replace(/\.json$/, '');
      const h = await readJsonKey<UpdateHealth>(env, o.key);
      if (h) out[id] = h;
    }
    if (!res.truncated) break;
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
  }
  return out;
}

// Opt-in auto-rollback. When a live update's failure rate crosses the configured
// threshold (over a minimum sample) every channel serving it is rolled back to
// embedded. Returns the channels rolled back (empty ⇒ disabled or below limits).
export async function maybeAutoRollback(
  env: Env,
  app: string,
  updateId: string,
  health: UpdateHealth,
): Promise<string[]> {
  const pct = Number(env.AUTO_ROLLBACK_FAILURE_PCT);
  if (!Number.isFinite(pct) || pct <= 0) return []; // disabled
  const minSample = Number(env.AUTO_ROLLBACK_MIN_SAMPLE) || 20;
  const total = health.ok + health.err;
  if (total < minSample) return [];
  if ((health.err / total) * 100 < pct) return [];

  const pointers = await listConsolePointers(env, app);
  const channels = [...new Set(pointers.filter((p) => p.updateId === updateId).map((p) => p.channel))];
  for (const ch of channels) await setRollbackToEmbedded(env, app, ch);
  return channels;
}

// ─── Retention / cleanup ────────────────────────────────────────────────────
// Deletes updates + builds older than `days`, but ALWAYS keeps anything that is
// currently live on a channel plus the newest `keepRecent` of each kind.
async function deletePrefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  for (let i = 0; i < 40; i++) {
    const res = await env.STORAGE.list({ prefix, cursor, limit: 1000 });
    if (res.objects.length) await Promise.all(res.objects.map((o) => env.STORAGE.delete(o.key)));
    if (!res.truncated) break;
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
  }
}

export async function pruneOld(
  env: Env,
  app: string,
  days: number,
  keepRecent = 20,
): Promise<{ updatesDeleted: number; buildsDeleted: number }> {
  const cutoff = Date.now() - days * 86400000;
  let updatesDeleted = 0;
  let buildsDeleted = 0;

  const pointers = await listConsolePointers(env, app);
  const live = new Set(pointers.map((p) => p.updateId).filter(Boolean));

  // Updates
  const uBase = `${UPDATES_PREFIX}/${app}/`;
  const uDirs = await listDelimited(env, uBase);
  const updates = await Promise.all(
    uDirs.map(async (dir) => {
      const id = dir.slice(uBase.length).replace(/\/$/, '');
      const rec = await readJsonKey<UpdateRecord>(env, `${uBase}${id}/update.json`);
      return { id, createdAt: rec?.createdAt ?? null };
    }),
  );
  updates.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const uKeep = new Set(updates.slice(0, keepRecent).map((u) => u.id));
  for (const u of updates) {
    if (live.has(u.id) || uKeep.has(u.id)) continue;
    const t = u.createdAt ? Date.parse(u.createdAt) : 0;
    if (t && t >= cutoff) continue;
    await deletePrefix(env, `${uBase}${u.id}/`);
    updatesDeleted++;
  }

  // Builds
  const bBase = `${BUILDS_PREFIX}/${app}/`;
  const builds = await listBuilds(env, app);
  const bKeep = new Set(builds.slice(0, keepRecent).map((b) => b.id));
  for (const b of builds) {
    if (bKeep.has(b.id)) continue;
    const t = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (t && t >= cutoff) continue;
    await deletePrefix(env, `${bBase}${sanitize(b.id)}/`);
    buildsDeleted++;
  }
  return { updatesDeleted, buildsDeleted };
}
