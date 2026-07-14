// ============================================================================
// Console JSON API — /console/api/*. Every call is gated behind the console
// bearer token (see auth.ts). HTTP routing/validation only; the actual R2 work
// lives in store.ts.
// ============================================================================

import { type Env, APPS, json } from '../shared';
import { authorizeConsole } from './auth';
import { getConsoleState, getUpdateDetail, promoteUpdate, setForceFlag } from './store';

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
    const res = await promoteUpdate(env, app, channel, updateId);
    if (!res.ok) return json({ error: res.error }, res.status);
    return json({ ok: true, app, channel, updateId, runtimeVersions: res.runtimeVersions });
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

  return json({ error: 'Not found' }, 404);
}
