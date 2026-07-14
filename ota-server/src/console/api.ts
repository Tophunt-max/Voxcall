// ============================================================================
// Console JSON API — /console/api/*. Every call is gated behind the console
// bearer token (see auth.ts). HTTP routing/validation only; the actual R2 work
// lives in store.ts.
// ============================================================================

import { type Env, APPS, json } from '../shared';
import { authorizeConsole } from './auth';
import {
  getConsoleState,
  getUpdateDetail,
  promoteUpdate,
  setForceFlag,
  setRollout,
  listBuilds,
  registerBuild,
  saveUploadedBuild,
  deleteBuild,
  buildDownloadUrl,
} from './store';

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
export async function handleConsoleApi(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  const auth = authorizeConsole(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const sub = path.slice('/console/api/'.length);

  if (sub === 'state' && request.method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    return json({ app, ...(await getConsoleState(env, app)) });
  }

  if (sub === 'update' && request.method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    const id = (url.searchParams.get('id') || '').trim();
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!id) return json({ error: 'id is required' }, 400);
    const detail = await getUpdateDetail(env, app, id, url.origin);
    if (!detail) return json({ error: 'update not found' }, 404);
    return json(detail);
  }

  if (sub === 'promote' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const app = String(body.app ?? '');
    const channel = String(body.channel ?? '').trim();
    const updateId = String(body.updateId ?? '').trim();
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!channel || !updateId) return json({ error: 'channel and updateId are required' }, 400);
    const rollout = typeof body.rollout === 'number' ? body.rollout : 100;
    const res = await promoteUpdate(env, app, channel, updateId, rollout);
    if (!res.ok) return json({ error: res.error }, res.status);
    return json({ ok: true, app, channel, updateId, runtimeVersions: res.runtimeVersions, rollout: res.rollout });
  }

  // Change the rollout % of a channel's current release (widen a staged rollout).
  if (sub === 'rollout' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const app = String(body.app ?? '');
    const channel = String(body.channel ?? '').trim();
    const rollout = Number(body.rollout);
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!channel) return json({ error: 'channel is required' }, 400);
    if (!Number.isFinite(rollout)) return json({ error: 'rollout must be a number (1-100)' }, 400);
    const res = await setRollout(env, app, channel, rollout);
    if (!res.ok) return json({ error: res.error }, res.status);
    return json({ ok: true, app, channel, rollout: res.rollout });
  }

  if (sub === 'force' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const app = String(body.app ?? '');
    const updateId = String(body.updateId ?? '').trim();
    const force = body.force === true ? true : body.force === false ? false : null;
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!updateId || force === null) return json({ error: 'updateId and force (boolean) are required' }, 400);
    const res = await setForceFlag(env, app, updateId, force);
    if (!res.ok) return json({ error: res.error }, res.status);
    return json({ ok: true, app, updateId, forceUpdate: force });
  }

  // ── App builds (installable APK/IPA distribution) ─────────────────────────
  if (sub === 'builds' && request.method === 'GET') {
    const app = url.searchParams.get('app') || 'user';
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    const builds = (await listBuilds(env, app)).map((b) => ({ ...b, downloadUrl: buildDownloadUrl(b, url.origin) }));
    return json({ app, builds });
  }

  // Register a build that lives at an external https URL (store / EAS / CDN).
  if (sub === 'builds' && request.method === 'POST') {
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
    });
    return json({ ok: true, build: { ...rec, downloadUrl: buildDownloadUrl(rec, url.origin) } });
  }

  // Upload a binary (raw request body streamed to R2). Metadata via query string.
  if (sub === 'builds/upload' && request.method === 'POST') {
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
      },
      request.body,
    );
    return json({ ok: true, build: { ...rec, downloadUrl: buildDownloadUrl(rec, url.origin) } });
  }

  if (sub === 'builds' && request.method === 'DELETE') {
    const app = url.searchParams.get('app') || 'user';
    const id = (url.searchParams.get('id') || '').trim();
    if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
    if (!id) return json({ error: 'id is required' }, 400);
    const res = await deleteBuild(env, app, id);
    if (!res.ok) return json({ error: res.error }, res.status);
    return json({ ok: true, app, id });
  }

  return json({ error: 'Not found' }, 404);
}
