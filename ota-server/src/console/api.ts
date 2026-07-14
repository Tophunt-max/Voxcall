// ============================================================================
// Console JSON API — /console/api/*. Reads/writes are gated behind the console
// bearer token (see auth.ts); the build endpoints also accept the scoped
// PUBLISH_TOKEN. Every mutation is written to the audit log, and notable ones
// fire a notification. HTTP routing/validation only; R2 work lives in store.ts.
// ============================================================================

import { type Env, APPS, json } from '../shared';
import { authorizeConsole, authorizePublish } from './auth';
import {
  getConsoleState,
  getUpdateDetail,
  getMetrics,
  promoteUpdate,
  setForceFlag,
  setRollout,
  setRollbackToEmbedded,
  getHealthMap,
  listBuilds,
  registerBuild,
  saveUploadedBuild,
  deleteBuild,
  buildDownloadUrl,
} from './store';
import { appendAudit, listAudit } from './audit';
import { notify } from '../notify';

function isPlatform(p: string): boolean {
  return p === 'android' || p === 'ios';
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Handle a request under `/console/api/`. `path` is the full request pathname. */
export async function handleConsoleApi(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const sub = path.slice('/console/api/'.length);
  const method = request.method;

  // Build register/upload also accept the scoped publish token; everything else
  // requires the full console login.
  const publishRoute = method === 'POST' && (sub === 'builds' || sub === 'builds/upload');
  const auth = publishRoute ? authorizePublish(request, env) : authorizeConsole(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  if (sub === 'state' && method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    return json({ app, ...(await getConsoleState(env, app)) });
  }

  if (sub === 'metrics' && method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    return json({ app, ...(await getMetrics(env, app)) });
  }

  if (sub === 'health' && method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    return json({ app, health: await getHealthMap(env, app) });
  }

  if (sub === 'audit' && method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    return json({ app, entries: await listAudit(env, app, limit) });
  }

  if (sub === 'update' && method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    const id = (url.searchParams.get('id') || '').trim();
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!id) return json({ error: 'id is required' }, 400);
    const detail = await getUpdateDetail(env, app, id, url.origin);
    if (!detail) return json({ error: 'update not found' }, 404);
    return json(detail);
  }

  if (sub === 'promote' && method === 'POST') {
    const body = await readJsonBody(request);
    const app = String(body.app ?? '');
    const channel = String(body.channel ?? '').trim();
    const updateId = String(body.updateId ?? '').trim();
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!channel || !updateId) return json({ error: 'channel and updateId are required' }, 400);
    const rollout = typeof body.rollout === 'number' ? body.rollout : 100;
    const res = await promoteUpdate(env, app, channel, updateId, rollout);
    if (!res.ok) return json({ error: res.error }, res.status);
    await appendAudit(env, { app, action: 'promote', actor: 'console', detail: { channel, updateId, rollout: res.rollout } });
    ctx.waitUntil(notify(env, `🚀 Promote (${app}): ${updateId.slice(0, 8)} → "${channel}" @ ${res.rollout}%`));
    return json({ ok: true, app, channel, updateId, runtimeVersions: res.runtimeVersions, rollout: res.rollout });
  }

  // Change the rollout % of a channel's current release (widen a staged rollout).
  if (sub === 'rollout' && method === 'POST') {
    const body = await readJsonBody(request);
    const app = String(body.app ?? '');
    const channel = String(body.channel ?? '').trim();
    const rollout = Number(body.rollout);
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!channel) return json({ error: 'channel is required' }, 400);
    if (!Number.isFinite(rollout)) return json({ error: 'rollout must be a number (1-100)' }, 400);
    const res = await setRollout(env, app, channel, rollout);
    if (!res.ok) return json({ error: res.error }, res.status);
    await appendAudit(env, { app, action: 'rollout', actor: 'console', detail: { channel, rollout: res.rollout } });
    return json({ ok: true, app, channel, rollout: res.rollout });
  }

  // Roll a channel back to the embedded bundle (kill-switch).
  if (sub === 'rollback' && method === 'POST') {
    const body = await readJsonBody(request);
    const app = String(body.app ?? '');
    const channel = String(body.channel ?? '').trim();
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!channel) return json({ error: 'channel is required' }, 400);
    const res = await setRollbackToEmbedded(env, app, channel);
    if (!res.ok) return json({ error: res.error }, res.status);
    await appendAudit(env, { app, action: 'rollback', actor: 'console', detail: { channel, runtimeVersions: res.runtimeVersions } });
    ctx.waitUntil(notify(env, `⏪ Rollback to embedded (${app}): channel "${channel}" (${res.runtimeVersions.length} runtime version(s)).`));
    return json({ ok: true, app, channel, runtimeVersions: res.runtimeVersions });
  }

  if (sub === 'force' && method === 'POST') {
    const body = await readJsonBody(request);
    const app = String(body.app ?? '');
    const updateId = String(body.updateId ?? '').trim();
    const force = body.force === true ? true : body.force === false ? false : null;
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!updateId || force === null) return json({ error: 'updateId and force (boolean) are required' }, 400);
    const res = await setForceFlag(env, app, updateId, force);
    if (!res.ok) return json({ error: res.error }, res.status);
    await appendAudit(env, { app, action: 'force', actor: 'console', detail: { updateId, force } });
    return json({ ok: true, app, updateId, forceUpdate: force });
  }

  // ── App builds (installable APK/IPA distribution) ─────────────────────────
  if (sub === 'builds' && method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    const builds = (await listBuilds(env, app)).map((b) => ({ ...b, downloadUrl: buildDownloadUrl(b, url.origin) }));
    return json({ app, builds });
  }

  // Register a build that lives at an external https URL (store / EAS / CDN).
  if (sub === 'builds' && method === 'POST') {
    const body = await readJsonBody(request);
    const app = String(body.app ?? '');
    const platform = String(body.platform ?? '').trim();
    const channel = String(body.channel ?? 'production').trim() || 'production';
    const externalUrl = String(body.externalUrl ?? '').trim();
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!isPlatform(platform)) return json({ error: 'platform must be "android" or "ios"' }, 400);
    if (!/^https:\/\/\S+$/i.test(externalUrl)) return json({ error: 'externalUrl must be an https URL' }, 400);
    const rec = await registerBuild(env, app, {
      channel,
      platform,
      version: String(body.version ?? '').trim(),
      buildNumber: String(body.buildNumber ?? '').trim(),
      notes: String(body.notes ?? '').trim(),
      externalUrl,
      filename: String(body.filename ?? '').trim(),
      bundleId: String(body.bundleId ?? '').trim(),
    });
    await appendAudit(env, { app, action: 'build.add', actor: 'ci', detail: { id: rec.id, platform, channel, version: rec.version } });
    ctx.waitUntil(notify(env, `📦 New build (${app} · ${platform} · ${channel}) ${rec.version || ''}`.trim()));
    return json({ ok: true, build: { ...rec, downloadUrl: buildDownloadUrl(rec, url.origin) } });
  }

  // Upload a binary (raw request body streamed to R2). Metadata via query string.
  if (sub === 'builds/upload' && method === 'POST') {
    const app = url.searchParams.get('app') || 'user';
    const platform = (url.searchParams.get('platform') || '').trim();
    const channel = (url.searchParams.get('channel') || 'production').trim() || 'production';
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!isPlatform(platform)) return json({ error: 'platform must be "android" or "ios"' }, 400);
    if (!request.body) return json({ error: 'no file body' }, 400);
    const rec = await saveUploadedBuild(
      env,
      app,
      {
        channel,
        platform,
        version: (url.searchParams.get('version') || '').trim(),
        buildNumber: (url.searchParams.get('buildNumber') || '').trim(),
        notes: (url.searchParams.get('notes') || '').trim(),
        filename: (url.searchParams.get('filename') || 'app.bin').trim(),
        contentType: request.headers.get('content-type') || '',
        bundleId: (url.searchParams.get('bundleId') || '').trim(),
      },
      request.body,
    );
    await appendAudit(env, { app, action: 'build.add', actor: 'ci', detail: { id: rec.id, platform, channel, version: rec.version, uploaded: true } });
    ctx.waitUntil(notify(env, `📦 New build (${app} · ${platform} · ${channel}) ${rec.version || ''}`.trim()));
    return json({ ok: true, build: { ...rec, downloadUrl: buildDownloadUrl(rec, url.origin) } });
  }

  if (sub === 'builds' && method === 'DELETE') {
    const app = url.searchParams.get('app') || 'user';
    const id = (url.searchParams.get('id') || '').trim();
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!id) return json({ error: 'id is required' }, 400);
    const res = await deleteBuild(env, app, id);
    if (!res.ok) return json({ error: res.error }, res.status);
    await appendAudit(env, { app, action: 'build.delete', actor: 'console', detail: { id } });
    return json({ ok: true, app, id });
  }

  return json({ error: 'Not found' }, 404);
}
