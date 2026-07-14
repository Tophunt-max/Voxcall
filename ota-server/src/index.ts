// ============================================================================
// VoxCall self-hosted OTA server — Expo Updates protocol v1
// ============================================================================
// Implements https://docs.expo.dev/technical-specs/expo-updates-1/ as a
// Cloudflare Worker, serving updates published to the shared R2 bucket by
// `ota-server/publish.mjs`. One deployment serves BOTH apps:
//   • voxlink       → /manifest/user
//   • voxlink-host  → /manifest/host
//
// R2 layout (all under the `ota/` prefix so it never touches app media):
//   ota/updates/<app>/<updateId>/update.json     ← precomputed manifest record
//   ota/updates/<app>/<updateId>/<bundle+assets>  ← the exported files
//   ota/channels/<app>/<channel>/<runtimeVersion>.json  ← { updateId } pointer
//     (under the fingerprint policy there is one pointer per platform's
//      fingerprint, all pointing at the same updateId)
//
// The publish script precomputes every hash/key so the Worker only assembles,
// (optionally) signs, and serves — no heavy work on the hot path.
// ============================================================================

export interface Env {
  STORAGE: R2Bucket;
  /** PKCS8 PEM private key. When set (secret) + the client asks, manifests are signed. */
  CODE_SIGNING_PRIVATE_KEY?: string;
  /** keyid advertised in the expo-signature header (default "root"). */
  CODE_SIGNING_KEY_ID?: string;
  /**
   * Bearer token that unlocks the built-in web console at `/console`. Set it as
   * a secret (`wrangler secret put CONSOLE_PASSWORD`). When UNSET the console's
   * data + management endpoints are disabled (503) — safe by default, so the
   * worker never exposes an open rollback/force switch.
   */
  CONSOLE_PASSWORD?: string;
}

const PROTOCOL_VERSION = '1';
const APPS = new Set(['user', 'host']);
const UPDATES_PREFIX = 'ota/updates';
const CHANNELS_PREFIX = 'ota/channels';

interface AssetRecord {
  key: string;
  contentType: string;
  hash: string;
  fileExtension?: string;
  storageKey: string;
}
interface PlatformRecord {
  /**
   * The runtimeVersion this platform's bundle was built against. Present when
   * the publisher used the "fingerprint" policy (iOS/Android can differ). When
   * absent (appVersion policy) the record's top-level runtimeVersion applies.
   */
  runtimeVersion?: string;
  launchAsset: AssetRecord;
  assets: AssetRecord[];
}
interface UpdateRecord {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  extra?: Record<string, unknown>;
  platforms: Partial<Record<'ios' | 'android', PlatformRecord>>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/' || path === '/health') {
      return json({ status: 'ok', service: 'voxcall-ota', protocol: PROTOCOL_VERSION, console: '/console' });
    }
    if (path === '/assets') {
      return serveAsset(request, env, url);
    }
    // Built-in web console: a static single-page UI (no auth to view the shell)
    // plus JSON endpoints that read/manage the ota/ objects (auth-gated).
    if (path === '/console') {
      return new Response(CONSOLE_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (path.startsWith('/console/api/')) {
      return serveConsoleApi(request, env, url, path);
    }
    const m = path.match(/^\/manifest\/([a-z0-9_-]+)$/i);
    if (m) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return serveManifest(request, env, url, m[1]);
    }
    return json({ error: 'Not found' }, 404);
  },
};

// ─── Manifest endpoint (the Expo Updates request) ───────────────────────────
async function serveManifest(request: Request, env: Env, url: URL, app: string): Promise<Response> {
  if (!APPS.has(app)) return json({ error: 'Unknown app' }, 404);

  // Protocol negotiation — we only speak v1.
  const proto = request.headers.get('expo-protocol-version');
  if (proto !== null && proto !== PROTOCOL_VERSION) {
    return new Response('Unsupported protocol version', { status: 400 });
  }
  const platform = request.headers.get('expo-platform');
  if (platform !== 'ios' && platform !== 'android') {
    return json({ error: 'Invalid or missing expo-platform' }, 400);
  }
  const runtimeVersion = request.headers.get('expo-runtime-version');
  if (!runtimeVersion) return json({ error: 'Missing expo-runtime-version' }, 400);

  const channel =
    url.searchParams.get('channel') || request.headers.get('expo-channel-name') || 'production';
  const currentUpdateId = request.headers.get('expo-current-update-id');

  const commonHeaders: Record<string, string> = {
    'expo-protocol-version': PROTOCOL_VERSION,
    'expo-sfv-version': '0',
    // Short cache so the newest manifest is always seen (per spec recommendation).
    'cache-control': 'private, max-age=0',
  };

  // 1. Resolve the channel pointer → which update to serve for this runtime.
  const pointerKey = `${CHANNELS_PREFIX}/${app}/${sanitize(channel)}/${sanitize(runtimeVersion)}.json`;
  const pointerObj = await env.STORAGE.get(pointerKey);
  if (!pointerObj) return noUpdate(commonHeaders); // nothing published → embedded update runs
  let pointer: { updateId?: string };
  try {
    pointer = (await pointerObj.json()) as { updateId?: string };
  } catch {
    return noUpdate(commonHeaders);
  }
  if (!pointer.updateId) return noUpdate(commonHeaders);

  // 2. Already on the latest? Tell the client there's nothing new.
  if (currentUpdateId && currentUpdateId === pointer.updateId) return noUpdate(commonHeaders);

  // 3. Load the precomputed update record.
  const recObj = await env.STORAGE.get(`${UPDATES_PREFIX}/${app}/${pointer.updateId}/update.json`);
  if (!recObj) return noUpdate(commonHeaders);
  let record: UpdateRecord;
  try {
    record = (await recObj.json()) as UpdateRecord;
  } catch {
    return noUpdate(commonHeaders);
  }
  const plat = record.platforms?.[platform];
  if (!plat || !plat.launchAsset) return noUpdate(commonHeaders);

  // 4. Build the manifest, rewriting asset URLs to this Worker's /assets route.
  const origin = url.origin;
  const assetUrl = (a: AssetRecord) => `${origin}/assets?key=${encodeURIComponent(a.storageKey)}`;
  const manifest = {
    id: record.id,
    createdAt: record.createdAt,
    // A client only launches a manifest whose runtimeVersion matches its build.
    // Under the fingerprint policy that value is per-platform; fall back to the
    // record's top-level value (appVersion policy) when not set.
    runtimeVersion: plat.runtimeVersion ?? record.runtimeVersion,
    launchAsset: {
      key: plat.launchAsset.key,
      contentType: plat.launchAsset.contentType,
      hash: plat.launchAsset.hash,
      url: assetUrl(plat.launchAsset),
    },
    assets: plat.assets.map((a) => ({
      key: a.key,
      contentType: a.contentType,
      hash: a.hash,
      ...(a.fileExtension ? { fileExtension: a.fileExtension } : {}),
      url: assetUrl(a),
    })),
    metadata: {},
    extra: record.extra ?? {},
  };
  const manifestStr = JSON.stringify(manifest);

  // 5. Optional code signing. If the client asked for a signature and we have a
  //    key, sign; if it asked but we CAN'T sign, fail loudly rather than serve
  //    an unsigned manifest the client will reject anyway.
  let signaturePart = '';
  const expectSig = request.headers.get('expo-expect-signature');
  if (expectSig) {
    if (!env.CODE_SIGNING_PRIVATE_KEY) {
      return json({ error: 'Code signing requested but server has no signing key' }, 500);
    }
    try {
      const sig = await signRsaSha256(manifestStr, env.CODE_SIGNING_PRIVATE_KEY);
      const keyid = env.CODE_SIGNING_KEY_ID || 'root';
      signaturePart = `expo-signature: sig="${sig}", keyid="${keyid}", alg="rsa-v1_5-sha256"\r\n`;
    } catch {
      return json({ error: 'Manifest signing failed' }, 500);
    }
  }

  // 6. multipart/mixed with a single "manifest" part.
  const boundary = `voxcall-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="manifest"\r\n` +
    `Content-Type: application/json\r\n` +
    signaturePart +
    `\r\n` +
    manifestStr +
    `\r\n` +
    `--${boundary}--\r\n`;

  return new Response(body, {
    status: 200,
    headers: { ...commonHeaders, 'content-type': `multipart/mixed; boundary=${boundary}` },
  });
}

// A no-parts response ⇒ "no update / directive available". The client keeps
// running whatever it already has (a prior update or the embedded bundle).
function noUpdate(headers: Record<string, string>): Response {
  return new Response(null, { status: 204, headers });
}

// ─── Asset endpoint ─────────────────────────────────────────────────────────
async function serveAsset(_request: Request, env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get('key');
  // Only ever serve OTA objects — never let this read arbitrary R2 keys
  // (chat media, KYC docs, etc.).
  if (!key || !key.startsWith('ota/updates/') || key.includes('..')) {
    return json({ error: 'Invalid asset key' }, 400);
  }
  const obj = await env.STORAGE.get(key);
  if (!obj) return json({ error: 'Asset not found' }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('content-type')) {
    const ct = url.searchParams.get('contentType');
    headers.set('content-type', ct || 'application/octet-stream');
  }
  // OTA assets are content-addressed (hash-verified by the client) and immutable.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

// ─── Web console API ─────────────────────────────────────────────────────────
// Read/manage the same ota/ objects the manifest endpoint serves. Every call is
// gated behind the CONSOLE_PASSWORD bearer token; when that secret is unset the
// console is disabled entirely (503) so there is never an open control surface.

interface ConsolePointer {
  channel: string;
  runtimeVersion: string;
  updateId: string;
  createdAt: string | null;
}
interface ConsoleUpdate {
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

// Constant-time string compare — avoids leaking the token length/prefix via
// response-time differences.
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function authorizeConsole(request: Request, env: Env): { ok: true } | { ok: false; status: number; error: string } {
  if (!env.CONSOLE_PASSWORD) {
    return { ok: false, status: 503, error: 'Console disabled — set the CONSOLE_PASSWORD secret to enable it.' };
  }
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqual(token, env.CONSOLE_PASSWORD)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

async function serveConsoleApi(request: Request, env: Env, url: URL, path: string): Promise<Response> {
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

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

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

function updateRuntimeVersions(rec: UpdateRecord): string[] {
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

async function getConsoleState(env: Env, app: string): Promise<{ channels: ConsolePointer[]; updates: ConsoleUpdate[] }> {
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
      message: typeof (r.rec.extra as { message?: unknown })?.message === 'string' ? ((r.rec.extra as { message: string }).message) : null,
      gitCommit: typeof (r.rec.extra as { gitCommit?: unknown })?.gitCommit === 'string' ? ((r.rec.extra as { gitCommit: string }).gitCommit) : null,
      platforms: r.rec.platforms ? Object.keys(r.rec.platforms) : [],
      liveOn: liveByUpdate.get(r.id) ?? [],
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  return { channels, updates };
}

// Make an update live on a channel (promote OR rollback). Writes one pointer
// per runtimeVersion the update covers, so both platforms roll together.
async function promoteUpdate(
  env: Env,
  app: string,
  channel: string,
  updateId: string,
): Promise<{ ok: true; runtimeVersions: string[] } | { ok: false; status: number; error: string }> {
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

// Toggle the mandatory-update flag by rewriting the update record. If the update
// is the live pointer, clients see it on their next manifest poll.
async function setForceFlag(
  env: Env,
  app: string,
  updateId: string,
  force: boolean,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const key = `${UPDATES_PREFIX}/${app}/${updateId}/update.json`;
  const rec = await readJsonKey<UpdateRecord>(env, key);
  if (!rec) return { ok: false, status: 404, error: 'update not found' };
  rec.extra = { ...(rec.extra ?? {}), forceUpdate: force };
  await env.STORAGE.put(key, JSON.stringify(rec, null, 2), { httpMetadata: { contentType: 'application/json' } });
  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function signRsaSha256(data: string, pem: string): Promise<string> {
  const key = await importPkcs8(pem);
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(data));
  return base64(new Uint8Array(sig));
}

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}


// Full detail for one update: metadata + per-platform launch asset & asset list
// with content-addressed download URLs (through this worker's /assets route).
async function getUpdateDetail(env: Env, app: string, id: string, origin: string): Promise<Record<string, unknown> | null> {
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



// ─── Web console UI ──────────────────────────────────────────────────────────
// A dependency-free single-page dashboard served at /console (Expo-style: side
// nav, overview with stats, updates list with a detail slide-over, channel
// management). It authenticates with the CONSOLE_PASSWORD token (sessionStorage)
// and talks to the /console/api/* endpoints above. Kept as one string so the
// worker needs no bundler/asset pipeline. NOTE: the embedded client script
// deliberately avoids backticks and ${...} so it survives this template literal.
const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VoxCall OTA Console</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0b0f; --panel: #12141c; --panel2: #171a24; --border: #232838;
    --text: #e8eaf0; --muted: #8a90a2; --accent: #7c5cff; --accent2: #6a49f0;
    --green: #46d19e; --greenbg: #0f2a20; --red: #ff7a8f; --redbg: #2a141a; --amber: #f5b544;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 14px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: var(--muted); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  button { cursor: pointer; font: inherit; border-radius: 9px; border: 1px solid var(--border);
           background: var(--panel2); color: var(--text); padding: 7px 12px; font-size: 13px; transition: background .12s, border-color .12s; }
  button:hover:not(:disabled) { background: #1f2434; }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover:not(:disabled) { background: var(--accent2); }
  button.danger { background: var(--redbg); border-color: #5a2530; color: var(--red); }
  button.ghost { background: transparent; }
  button.sm { padding: 5px 10px; font-size: 12px; }
  button.live { background: var(--greenbg); border-color: #1f5a3a; color: var(--green); cursor: default; }
  input, select { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border);
                  border-radius: 9px; padding: 9px 11px; }
  input:focus, select:focus { outline: none; border-color: var(--accent); }

  /* Layout */
  .shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
  .side { background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 16px 12px; position: sticky; top: 0; height: 100vh; }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 15px; padding: 6px 8px 14px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
  .appswitch { display: flex; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 3px; margin: 4px 4px 14px; }
  .appswitch button { flex: 1; border: none; background: transparent; padding: 7px; font-size: 12.5px; border-radius: 8px; color: var(--muted); }
  .appswitch button.active { background: var(--accent); color: #fff; }
  nav { display: flex; flex-direction: column; gap: 3px; }
  .navitem { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 9px; color: var(--muted); cursor: pointer; font-weight: 500; }
  .navitem:hover { background: var(--panel2); color: var(--text); }
  .navitem.active { background: var(--panel2); color: var(--text); }
  .navitem .ic { width: 16px; text-align: center; }
  .side .bottom { margin-top: auto; }

  .main { min-width: 0; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 26px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(10,11,15,.85); backdrop-filter: blur(8px); z-index: 4; }
  .topbar h2 { margin: 0; font-size: 17px; }
  .topbar .sub { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  .content { padding: 24px 26px 60px; max-width: 1040px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 26px; }
  .stat { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
  .stat .n { font-size: 26px; font-weight: 700; }
  .stat .l { color: var(--muted); font-size: 12px; margin-top: 4px; text-transform: uppercase; letter-spacing: .04em; }
  h3.sec { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 26px 0 12px; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 13px; padding: 15px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .between { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

  .badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
  .b-ch { background: #1c1740; color: #b9a8ff; }
  .b-plat { background: #1a1e2b; color: #9aa2b8; }
  .b-force { background: var(--redbg); color: var(--red); font-weight: 700; text-transform: uppercase; }
  .b-live { background: var(--greenbg); color: var(--green); font-weight: 600; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; padding: 0 12px 10px; }
  td { padding: 12px; border-top: 1px solid var(--border); vertical-align: middle; }
  tr.clk { cursor: pointer; }
  tr.clk:hover td { background: var(--panel2); }
  .tablewrap { background: var(--panel); border: 1px solid var(--border); border-radius: 13px; overflow: hidden; }

  .toolbar { display: flex; gap: 10px; margin-bottom: 14px; }
  .toolbar input { flex: 1; }
  .empty { text-align: center; color: var(--muted); padding: 40px 0; }
  .err { background: var(--redbg); color: var(--red); border: 1px solid #5a2530; border-radius: 10px; padding: 11px 13px; margin-bottom: 16px; }
  .spin { width: 22px; height: 22px; border: 2px solid var(--accent); border-top-color: transparent; border-radius: 50%; animation: sp .7s linear infinite; margin: 40px auto; }
  @keyframes sp { to { transform: rotate(360deg); } }

  /* Detail slide-over */
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); opacity: 0; pointer-events: none; transition: opacity .18s; z-index: 20; }
  .overlay.show { opacity: 1; pointer-events: auto; }
  .drawer { position: fixed; top: 0; right: 0; height: 100vh; width: min(560px, 94vw); background: var(--panel); border-left: 1px solid var(--border);
            transform: translateX(100%); transition: transform .2s ease; z-index: 21; overflow-y: auto; }
  .drawer.show { transform: translateX(0); }
  .drawer .dh { position: sticky; top: 0; background: var(--panel); border-bottom: 1px solid var(--border); padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
  .drawer .db { padding: 20px; }
  .kv { display: grid; grid-template-columns: 130px 1fr; gap: 8px 14px; margin: 6px 0 18px; }
  .kv .k { color: var(--muted); font-size: 12.5px; }
  .kv .v { word-break: break-all; }
  .copy { cursor: pointer; color: var(--muted); font-size: 11px; border: 1px solid var(--border); border-radius: 6px; padding: 1px 6px; }
  .copy:hover { color: var(--text); }
  .asset { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border); font-size: 12.5px; }
  .assetlist { max-height: 260px; overflow-y: auto; }

  /* Auth */
  .authwrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .authcard { width: 100%; max-width: 380px; background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 26px; }
  .authcard h1 { font-size: 18px; margin: 0 0 6px; display: flex; align-items: center; gap: 9px; }

  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--panel2); border: 1px solid var(--border);
           padding: 10px 16px; border-radius: 10px; box-shadow: 0 10px 34px rgba(0,0,0,.55); opacity: 0; transition: opacity .2s; z-index: 40; }
  .toast.show { opacity: 1; }
  .hidden { display: none !important; }
  @media (max-width: 720px) { .shell { grid-template-columns: 1fr; } .side { position: static; height: auto; flex-direction: row; flex-wrap: wrap; } .side .bottom { margin: 0; } nav { flex-direction: row; } }
</style>
</head>
<body>

<div id="auth" class="authwrap hidden">
  <div class="authcard">
    <h1><span class="dot"></span> VoxCall OTA</h1>
    <p class="muted" style="margin-top:0">Self-hosted Expo Updates console. Enter the console password (the <span class="mono">CONSOLE_PASSWORD</span> secret set on this worker).</p>
    <input id="token" type="password" placeholder="Console password" autocomplete="current-password" style="width:100%" />
    <button id="loginBtn" class="primary" style="width:100%; margin-top:12px">Unlock console</button>
    <div id="authErr" class="err hidden" style="margin-top:14px"></div>
  </div>
</div>

<div id="shell" class="shell hidden">
  <aside class="side">
    <div class="brand"><span class="dot"></span> VoxCall OTA</div>
    <div class="appswitch">
      <button data-app="user" class="active">User</button>
      <button data-app="host">Host</button>
    </div>
    <nav>
      <div class="navitem active" data-view="overview"><span class="ic">◫</span> Overview</div>
      <div class="navitem" data-view="updates"><span class="ic">⤒</span> Updates</div>
      <div class="navitem" data-view="channels"><span class="ic">⇄</span> Channels</div>
    </nav>
    <div class="bottom">
      <div class="navitem" id="logoutBtn"><span class="ic">⏻</span> Sign out</div>
    </div>
  </aside>

  <div class="main">
    <div class="topbar">
      <div>
        <h2 id="viewTitle">Overview</h2>
        <div class="sub" id="viewSub"></div>
      </div>
      <button id="refreshBtn" class="sm">↻ Refresh</button>
    </div>
    <div class="content">
      <div id="err" class="err hidden"></div>
      <div id="loading" class="spin"></div>
      <div id="content"></div>
    </div>
  </div>
</div>

<div id="overlay" class="overlay"></div>
<div id="drawer" class="drawer"></div>
<div id="toast" class="toast"></div>

<script>
(function () {
  var TOKEN_KEY = "voxota_token";
  var token = sessionStorage.getItem(TOKEN_KEY) || "";
  var app = "user";
  var view = "overview";
  var filter = "";
  var data = { channels: [], updates: [] };
  var byId = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function shortId(s) { s = String(s || ""); return s.length > 14 ? s.slice(0, 10) + "…" : s; }
  function fmt(iso) { if (!iso) return "—"; var d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleString(); }
  function rel(iso) {
    if (!iso) return "";
    var d = new Date(iso); if (isNaN(d.getTime())) return "";
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  var toastTimer;
  function toast(msg, isErr) {
    var t = byId("toast");
    t.textContent = msg;
    t.style.borderColor = isErr ? "#5a2530" : "#232838";
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("Copied"); }, function () { toast("Copy failed", true); });
    else toast("Copy not supported", true);
  }
  window.OTA_copy = copy;

  function api(method, sub, body) {
    var opts = { method: method, headers: { "Authorization": "Bearer " + token } };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch("/console/api/" + sub, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { var e = new Error("Unauthorized"); e.code = 401; throw e; }
        if (r.status === 503) { var e3 = new Error(j.error || "Console disabled"); e3.code = 503; throw e3; }
        if (!r.ok) { var e2 = new Error(j.error || ("HTTP " + r.status)); e2.code = r.status; throw e2; }
        return j;
      });
    });
  }

  function showAuth(msg) {
    byId("shell").classList.add("hidden");
    byId("auth").classList.remove("hidden");
    var ae = byId("authErr");
    if (msg) { ae.textContent = msg; ae.classList.remove("hidden"); } else { ae.classList.add("hidden"); }
    byId("token").focus();
  }
  function showApp() { byId("auth").classList.add("hidden"); byId("shell").classList.remove("hidden"); }

  function login() {
    var val = byId("token").value.trim();
    if (!val) { showAuth("Password required."); return; }
    token = val; sessionStorage.setItem(TOKEN_KEY, token); showApp(); load();
  }
  function logout() { token = ""; sessionStorage.removeItem(TOKEN_KEY); showAuth(); }

  function handleErr(e) {
    byId("loading").classList.add("hidden");
    if (e && e.code === 401) { logout(); showAuth("Wrong password, try again."); return; }
    if (e && e.code === 503) { logout(); showAuth(e.message); return; }
    var box = byId("err"); box.textContent = (e && e.message) ? e.message : "Failed to load"; box.classList.remove("hidden");
  }

  function channelNames() {
    var set = {}; for (var i = 0; i < data.channels.length; i++) set[data.channels[i].channel] = 1;
    var names = Object.keys(set); if (!names.length) names = ["production"]; names.sort(); return names;
  }
  function isLiveOn(u, ch) { for (var i = 0; i < u.liveOn.length; i++) { if (u.liveOn[i].indexOf(ch + " @ ") === 0) return true; } return false; }
  function rtvLabel(u) { return (u.runtimeVersions && u.runtimeVersions.length) ? u.runtimeVersions.map(shortId).join(", ") : "—"; }
  function findUpdate(id) { for (var i = 0; i < data.updates.length; i++) if (data.updates[i].id === id) return data.updates[i]; return null; }

  // ── Views ──────────────────────────────────────────────────────────────
  var TITLES = {
    overview: ["Overview", "Deployment status at a glance"],
    updates: ["Updates", "Every published update for this app"],
    channels: ["Channels", "Which update is live on each channel + runtime"]
  };

  function setView(v) {
    view = v;
    var items = document.querySelectorAll(".navitem[data-view]");
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("active", items[i].getAttribute("data-view") === v);
    byId("viewTitle").textContent = TITLES[v][0];
    byId("viewSub").textContent = TITLES[v][1] + " · " + (app === "user" ? "User app" : "Host app");
    renderView();
  }

  function renderView() {
    if (view === "overview") renderOverview();
    else if (view === "updates") renderUpdates();
    else renderChannels();
  }

  function statCard(n, l) { return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + esc(l) + '</div></div>'; }

  function updateBadges(u) {
    var h = "";
    for (var p = 0; p < u.platforms.length; p++) h += '<span class="badge b-plat">' + esc(u.platforms[p]) + '</span>';
    if (u.forceUpdate) h += '<span class="badge b-force">mandatory</span>';
    for (var l = 0; l < u.liveOn.length; l++) h += '<span class="badge b-live">live · ' + esc(u.liveOn[l]) + '</span>';
    return h;
  }

  function renderOverview() {
    var u = data.updates, ch = data.channels;
    var names = {}; for (var i = 0; i < ch.length; i++) names[ch[i].channel] = 1;
    var rtvs = {}; for (var j = 0; j < ch.length; j++) rtvs[ch[j].runtimeVersion] = 1;
    var mand = 0; for (var k = 0; k < u.length; k++) if (u[k].forceUpdate) mand++;
    var last = u.length ? rel(u[0].createdAt) : "—";

    var html = '<div class="cards">' +
      statCard(u.length, "Updates") +
      statCard(Object.keys(names).length || 0, "Channels") +
      statCard(Object.keys(rtvs).length || 0, "Runtime versions") +
      statCard(mand, "Mandatory") +
      '</div>';

    html += '<div class="between"><h3 class="sec" style="margin:0">Live now</h3><span class="muted" style="font-size:12px">last publish ' + esc(last) + '</span></div>';
    if (!ch.length) {
      html += '<div class="card empty">Nothing published yet. Run <span class="mono">node ota-server/publish.mjs --app ' + esc(app) + '</span>.</div>';
    } else {
      html += '<div class="grid">';
      for (var c = 0; c < ch.length; c++) {
        var p = ch[c];
        html += '<div class="card"><div class="row"><span class="badge b-ch">' + esc(p.channel) + '</span>' +
          '<span class="muted mono" title="' + esc(p.runtimeVersion) + '">rtv ' + esc(shortId(p.runtimeVersion)) + '</span></div>' +
          '<div class="mono clklink" style="margin-top:9px;cursor:pointer;color:var(--accent)" onclick="OTA.open(\\'' + esc(p.updateId) + '\\')">' + esc(shortId(p.updateId)) + '</div>' +
          '<div class="muted" style="font-size:12px;margin-top:4px">' + esc(fmt(p.createdAt)) + '</div></div>';
      }
      html += '</div>';
    }

    html += '<h3 class="sec">Recent updates</h3>';
    if (!u.length) { html += '<div class="card empty">No updates yet.</div>'; }
    else {
      html += '<div class="tablewrap"><table><tbody>';
      for (var r = 0; r < Math.min(6, u.length); r++) {
        var up = u[r];
        html += '<tr class="clk" onclick="OTA.open(\\'' + esc(up.id) + '\\')">' +
          '<td class="mono">' + esc(shortId(up.id)) + '</td>' +
          '<td>' + updateBadges(up) + '</td>' +
          '<td class="muted" style="text-align:right;white-space:nowrap">' + esc(rel(up.createdAt)) + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
    byId("content").innerHTML = html;
  }

  function renderUpdates() {
    var f = filter.toLowerCase();
    var list = data.updates.filter(function (u) {
      if (!f) return true;
      return (u.id + " " + (u.message || "") + " " + (u.gitCommit || "") + " " + (u.runtimeVersions || []).join(" ")).toLowerCase().indexOf(f) >= 0;
    });
    var html = '<div class="toolbar"><input id="search" placeholder="Search by id, message, commit, runtime…" value="' + esc(filter) + '" /></div>';
    if (!list.length) { html += '<div class="card empty">' + (filter ? "No updates match your search." : "No updates published for this app yet.") + '</div>'; }
    else {
      html += '<div class="tablewrap"><table><thead><tr><th>Update</th><th>Runtime</th><th>Status</th><th style="text-align:right">Published</th></tr></thead><tbody>';
      for (var i = 0; i < list.length; i++) {
        var u = list[i];
        html += '<tr class="clk" onclick="OTA.open(\\'' + esc(u.id) + '\\')">' +
          '<td><div class="mono" style="font-weight:600">' + esc(shortId(u.id)) + '</div>' + (u.message ? '<div class="muted" style="font-size:12px;margin-top:3px">' + esc(u.message.length > 60 ? u.message.slice(0, 58) + "…" : u.message) + '</div>' : '') + '</td>' +
          '<td class="mono muted" title="' + esc((u.runtimeVersions || []).join(", ")) + '">' + esc(rtvLabel(u)) + '</td>' +
          '<td>' + updateBadges(u) + '</td>' +
          '<td class="muted" style="text-align:right;white-space:nowrap" title="' + esc(fmt(u.createdAt)) + '">' + esc(rel(u.createdAt)) + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
    byId("content").innerHTML = html;
    var s = byId("search");
    if (s) s.addEventListener("input", function (e) { filter = e.target.value; var pos = e.target.selectionStart; renderUpdates(); var ns = byId("search"); if (ns) { ns.focus(); ns.selectionStart = ns.selectionEnd = pos; } });
  }

  function renderChannels() {
    var names = channelNames();
    var byName = {};
    for (var i = 0; i < data.channels.length; i++) { var p = data.channels[i]; (byName[p.channel] = byName[p.channel] || []).push(p); }
    var opts = "";
    for (var u = 0; u < data.updates.length; u++) { var up = data.updates[u]; opts += '<option value="' + esc(up.id) + '">' + esc(shortId(up.id)) + " · rtv " + esc(rtvLabel(up)) + " · " + esc(rel(up.createdAt)) + '</option>'; }

    var html = '';
    if (!data.updates.length) { byId("content").innerHTML = '<div class="card empty">Publish an update first — then you can promote/roll back channels here.</div>'; return; }
    for (var n = 0; n < names.length; n++) {
      var ch = names[n];
      var ptrs = byName[ch] || [];
      html += '<div class="card" style="margin-bottom:12px"><div class="between"><div class="row"><span class="badge b-ch">' + esc(ch) + '</span>' +
        '<span class="muted" style="font-size:12px">' + ptrs.length + ' runtime version' + (ptrs.length === 1 ? '' : 's') + '</span></div></div>';
      if (ptrs.length) {
        html += '<div style="margin-top:10px">';
        for (var q = 0; q < ptrs.length; q++) {
          var pt = ptrs[q];
          html += '<div class="asset"><span class="mono muted" title="' + esc(pt.runtimeVersion) + '">rtv ' + esc(shortId(pt.runtimeVersion)) + '</span>' +
            '<span class="mono clklink" style="cursor:pointer;color:var(--accent)" onclick="OTA.open(\\'' + esc(pt.updateId) + '\\')">' + esc(shortId(pt.updateId)) + '</span>' +
            '<span class="muted" style="font-size:12px">' + esc(rel(pt.createdAt)) + '</span></div>';
        }
        html += '</div>';
      } else { html += '<div class="muted" style="margin-top:8px;font-size:12.5px">No pointer yet.</div>'; }
      html += '<div class="row" style="margin-top:12px"><select id="sel-' + esc(ch) + '" style="flex:1">' + opts + '</select>' +
        '<button class="primary sm" onclick="OTA.rollback(\\'' + esc(ch) + '\\')">Set live</button></div></div>';
    }
    byId("content").innerHTML = html;
  }

  // ── Detail drawer ───────────────────────────────────────────────────────
  function openDetail(id) {
    var summary = findUpdate(id) || { id: id, liveOn: [] };
    byId("overlay").classList.add("show");
    byId("drawer").classList.add("show");
    byId("drawer").innerHTML = '<div class="dh"><strong class="mono">' + esc(shortId(id)) + '</strong><button class="ghost sm" onclick="OTA.close()">✕ Close</button></div><div class="db"><div class="spin"></div></div>';
    api("GET", "update?app=" + app + "&id=" + encodeURIComponent(id)).then(function (d) { renderDetail(d, summary); }).catch(function (e) {
      byId("drawer").querySelector(".db").innerHTML = '<div class="err">' + esc(e.message || "Failed to load update") + '</div>';
    });
  }
  function closeDetail() { byId("overlay").classList.remove("show"); byId("drawer").classList.remove("show"); }

  function kvRow(k, v, copyable) {
    if (v == null || v === "") v = "—";
    var vv = '<span class="v mono">' + esc(v) + '</span>';
    if (copyable && v !== "—") vv += ' <span class="copy" onclick="OTA_copy(\\'' + esc(String(v).replace(/'/g, "")) + '\\')">copy</span>';
    return '<div class="k">' + esc(k) + '</div>' + vv;
  }

  function renderDetail(d, summary) {
    var liveOn = summary.liveOn || [];
    var names = channelNames();
    var h = '';
    h += '<div class="row" style="margin-bottom:14px">';
    for (var l = 0; l < liveOn.length; l++) h += '<span class="badge b-live">live · ' + esc(liveOn[l]) + '</span>';
    if (d.forceUpdate) h += '<span class="badge b-force">mandatory</span>';
    if (!liveOn.length) h += '<span class="muted" style="font-size:12.5px">Not live on any channel</span>';
    h += '</div>';

    h += '<div class="kv">';
    h += kvRow("Update ID", d.id, true);
    h += kvRow("Created", fmt(d.createdAt), false);
    h += kvRow("Runtime", (d.runtimeVersions || []).join(", "), true);
    h += kvRow("Git commit", d.gitCommit, true);
    h += kvRow("Published", fmt(d.publishedAt), false);
    if (d.easProjectId) h += kvRow("EAS project", d.easProjectId, true);
    h += kvRow("Message", d.message, false);
    h += kvRow("Manifest URL", d.manifestUrl, true);
    h += '</div>';

    // Actions
    h += '<h3 class="sec" style="margin-top:6px">Actions</h3><div class="row">';
    for (var n = 0; n < names.length; n++) {
      var ch = names[n]; var live = false;
      for (var x = 0; x < liveOn.length; x++) if (liveOn[x].indexOf(ch + " @ ") === 0) live = true;
      h += '<button class="sm ' + (live ? 'live" disabled' : '" onclick="OTA.promote(\\'' + esc(d.id) + '\\',\\'' + esc(ch) + '\\')"') + '>' + (live ? "Live · " : "Set live · ") + esc(ch) + '</button>';
    }
    h += '<button class="sm ' + (d.forceUpdate ? '' : 'danger') + '" onclick="OTA.toggleForce(\\'' + esc(d.id) + '\\',' + (d.forceUpdate ? 'true' : 'false') + ')">' + (d.forceUpdate ? "Make optional" : "Make mandatory") + '</button>';
    h += '</div>';

    // Platforms
    var plats = d.platforms || {};
    var pkeys = Object.keys(plats);
    h += '<h3 class="sec">Platforms &amp; assets</h3>';
    if (!pkeys.length) h += '<div class="muted">No platform bundles.</div>';
    for (var pi = 0; pi < pkeys.length; pi++) {
      var pk = pkeys[pi]; var pr = plats[pk];
      h += '<div class="card" style="margin-bottom:12px"><div class="between"><div class="row"><span class="badge b-plat">' + esc(pk) + '</span>' +
        '<span class="muted mono" style="font-size:12px" title="' + esc(pr.runtimeVersion) + '">rtv ' + esc(shortId(pr.runtimeVersion)) + '</span></div>' +
        '<span class="muted" style="font-size:12px">' + (pr.assetCount || 0) + ' asset' + (pr.assetCount === 1 ? '' : 's') + '</span></div>';
      h += '<div class="asset"><span class="muted">launch bundle</span><a href="' + esc(pr.launchAsset.url) + '" target="_blank" rel="noopener">download</a></div>';
      h += '<div class="mono muted" style="font-size:11px;word-break:break-all;margin-top:4px">sha256: ' + esc(pr.launchAsset.hash) + '</div>';
      if (pr.assets && pr.assets.length) {
        h += '<div class="assetlist" style="margin-top:8px">';
        for (var a = 0; a < pr.assets.length; a++) {
          var as = pr.assets[a];
          h += '<div class="asset"><span class="mono" style="font-size:12px">' + esc((as.fileExtension || as.contentType || "asset")) + '</span>' +
            '<a href="' + esc(as.url) + '" target="_blank" rel="noopener">download</a></div>';
        }
        h += '</div>';
      }
      h += '</div>';
    }

    byId("drawer").querySelector(".db").innerHTML = h;
  }

  function load() {
    byId("err").classList.add("hidden");
    byId("content").innerHTML = "";
    byId("loading").classList.remove("hidden");
    api("GET", "state?app=" + app).then(function (d) {
      data = { channels: d.channels || [], updates: d.updates || [] };
      byId("loading").classList.add("hidden");
      setView(view);
    }).catch(handleErr);
  }

  window.OTA = {
    open: openDetail,
    close: closeDetail,
    promote: function (id, channel) {
      if (!confirm("Make update " + shortId(id) + " live on \\"" + channel + "\\"?\\n\\nClients on this channel get it on their next check (roll forward or roll back).")) return;
      api("POST", "promote", { app: app, channel: channel, updateId: id })
        .then(function (r) { toast("Live on " + channel + " (rtv " + (r.runtimeVersions || []).map(shortId).join(", ") + ")"); closeDetail(); load(); })
        .catch(function (e) { toast(e.message || "Promote failed", true); });
    },
    rollback: function (channel) {
      var sel = byId("sel-" + channel); if (!sel) return;
      OTA.promote(sel.value, channel);
    },
    toggleForce: function (id, cur) {
      var next = !cur;
      var q = next ? "Mark " + shortId(id) + " as MANDATORY? Clients will be forced to reload immediately."
                   : "Remove mandatory flag from " + shortId(id) + "? It applies silently on next launch.";
      if (!confirm(q)) return;
      api("POST", "force", { app: app, updateId: id, force: next })
        .then(function () { toast(next ? "Marked mandatory" : "Mandatory flag removed"); closeDetail(); load(); })
        .catch(function (e) { toast(e.message || "Failed", true); });
    }
  };

  // ── Wiring ────────────────────────────────────────────────────────────
  byId("loginBtn").addEventListener("click", login);
  byId("token").addEventListener("keydown", function (e) { if (e.key === "Enter") login(); });
  byId("logoutBtn").addEventListener("click", logout);
  byId("refreshBtn").addEventListener("click", load);
  byId("overlay").addEventListener("click", closeDetail);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });

  var navs = document.querySelectorAll(".navitem[data-view]");
  for (var i = 0; i < navs.length; i++) navs[i].addEventListener("click", function (e) { setView(e.currentTarget.getAttribute("data-view")); });

  var apps = document.querySelectorAll(".appswitch button");
  for (var j = 0; j < apps.length; j++) apps[j].addEventListener("click", function (e) {
    var el = e.currentTarget;
    for (var k = 0; k < apps.length; k++) apps[k].classList.remove("active");
    el.classList.add("active");
    app = el.getAttribute("data-app");
    filter = ""; closeDetail(); load();
  });

  if (token) { showApp(); load(); } else { showAuth(); }
})();
</script>
</body>
</html>`;
