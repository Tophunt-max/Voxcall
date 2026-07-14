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


// ─── Web console UI ──────────────────────────────────────────────────────────
// A dependency-free single-page app served at /console. It authenticates with
// the CONSOLE_PASSWORD token (kept in sessionStorage) and talks to the
// /console/api/* endpoints above. Kept as one string so the worker needs no
// bundler/asset pipeline. NOTE: the embedded client script deliberately avoids
// backticks and ${...} so it survives being inside this template literal.
const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VoxCall OTA Console</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background: #0b0d12; color: #e7e9ee; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px;
           padding: 14px 20px; border-bottom: 1px solid #1e2230; background: #0f121a; position: sticky; top: 0; z-index: 5; }
  header h1 { font-size: 15px; margin: 0; display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #7c5cff; box-shadow: 0 0 10px #7c5cff; }
  .muted { color: #8b90a0; }
  main { max-width: 960px; margin: 0 auto; padding: 20px; }
  .card { background: #12151f; border: 1px solid #1e2230; border-radius: 14px; padding: 16px; }
  .hidden { display: none !important; }
  input, button, select { font: inherit; }
  input[type=password], input[type=text] { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #2a2f40;
           background: #0b0d12; color: #e7e9ee; }
  button { cursor: pointer; border-radius: 10px; border: 1px solid #2a2f40; background: #171b28; color: #e7e9ee;
           padding: 8px 12px; font-size: 13px; }
  button:hover:not(:disabled) { background: #1e2334; }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: #7c5cff; border-color: #7c5cff; color: #fff; }
  button.primary:hover:not(:disabled) { background: #6a49f0; }
  button.danger { background: #2a1418; border-color: #5a2530; color: #ff8a9c; }
  button.live { background: #10241a; border-color: #1f5a3a; color: #74e0a3; cursor: default; }
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; }
  .tab { padding: 6px 14px; border-radius: 999px; }
  .tab.active { background: #7c5cff; border-color: #7c5cff; color: #fff; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #8b90a0; margin: 22px 0 10px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; }
  .b-ch { background: #1c1740; color: #b9a8ff; }
  .b-plat { background: #1a1e2b; color: #9aa2b8; }
  .b-force { background: #3a1620; color: #ff8a9c; font-weight: 700; text-transform: uppercase; }
  .b-live { background: #10241a; color: #74e0a3; font-weight: 600; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .upd { padding: 14px; border: 1px solid #1e2230; border-radius: 12px; background: #12151f; margin-bottom: 10px; }
  .upd .acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px solid #1e2230; }
  .err { background: #2a1418; color: #ff8a9c; border: 1px solid #5a2530; border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #171b28; border: 1px solid #2a2f40;
           padding: 10px 16px; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.5); opacity: 0; transition: opacity .2s; }
  .toast.show { opacity: 1; }
  .empty { text-align: center; color: #8b90a0; padding: 30px 0; }
  a.link { color: #b9a8ff; }
</style>
</head>
<body>
<header>
  <h1><span class="dot"></span> VoxCall OTA Console</h1>
  <div class="row">
    <button id="refreshBtn" class="hidden">Refresh</button>
    <button id="logoutBtn" class="hidden">Sign out</button>
  </div>
</header>

<main>
  <div id="auth" class="card hidden">
    <h3 style="margin-top:0">Sign in</h3>
    <p class="muted" style="margin-top:0">Enter the console password (the CONSOLE_PASSWORD secret set on this worker).</p>
    <input id="token" type="password" placeholder="Console password" autocomplete="current-password" />
    <div class="row" style="margin-top:12px">
      <button id="loginBtn" class="primary">Unlock console</button>
    </div>
    <div id="authErr" class="err hidden" style="margin-top:12px"></div>
  </div>

  <div id="app" class="hidden">
    <div class="tabs">
      <button class="tab active" data-app="user">User app</button>
      <button class="tab" data-app="host">Host app</button>
    </div>
    <div id="err" class="err hidden"></div>
    <div id="loading" class="empty">Loading…</div>
    <div id="content" class="hidden">
      <h3>Live channels</h3>
      <div id="channels" class="grid"></div>
      <h3 id="histTitle">Update history</h3>
      <div id="updates"></div>
    </div>
  </div>
</main>

<div id="toast" class="toast"></div>

<script>
(function () {
  var TOKEN_KEY = "voxota_token";
  var token = sessionStorage.getItem(TOKEN_KEY) || "";
  var app = "user";
  var byId = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function shortId(s) { s = String(s || ""); return s.length > 12 ? s.slice(0, 10) + "…" : s; }
  function fmt(iso) { if (!iso) return "—"; var d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleString(); }

  var toastTimer;
  function toast(msg, isErr) {
    var t = byId("toast");
    t.textContent = msg;
    t.style.borderColor = isErr ? "#5a2530" : "#2a2f40";
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function api(method, sub, body) {
    var opts = { method: method, headers: { "Authorization": "Bearer " + token } };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch("/console/api/" + sub, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { var e = new Error("Unauthorized"); e.code = 401; throw e; }
        if (!r.ok) { var e2 = new Error(j.error || ("HTTP " + r.status)); e2.code = r.status; throw e2; }
        return j;
      });
    });
  }

  function showAuth(msg) {
    byId("app").classList.add("hidden");
    byId("auth").classList.remove("hidden");
    byId("refreshBtn").classList.add("hidden");
    byId("logoutBtn").classList.add("hidden");
    var ae = byId("authErr");
    if (msg) { ae.textContent = msg; ae.classList.remove("hidden"); } else { ae.classList.add("hidden"); }
    byId("token").focus();
  }

  function showApp() {
    byId("auth").classList.add("hidden");
    byId("app").classList.remove("hidden");
    byId("refreshBtn").classList.remove("hidden");
    byId("logoutBtn").classList.remove("hidden");
  }

  function login() {
    var val = byId("token").value.trim();
    if (!val) { showAuth("Password required."); return; }
    token = val;
    sessionStorage.setItem(TOKEN_KEY, token);
    showApp();
    load();
  }

  function logout() {
    token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    showAuth();
  }

  function handleErr(e) {
    if (e && e.code === 401) { logout(); showAuth("Wrong password, try again."); return; }
    if (e && e.code === 503) { showAuth(e.message); return; }
    var box = byId("err");
    box.textContent = e && e.message ? e.message : "Failed to load";
    box.classList.remove("hidden");
    byId("loading").classList.add("hidden");
  }

  function isLiveOn(u, channel) {
    for (var i = 0; i < u.liveOn.length; i++) { if (u.liveOn[i].indexOf(channel + " @ ") === 0) return true; }
    return false;
  }

  function rtvLabel(u) {
    if (!u.runtimeVersions || !u.runtimeVersions.length) return "—";
    return u.runtimeVersions.map(shortId).join(", ");
  }

  var lastChannels = [];

  function channelNames() {
    var set = {};
    for (var i = 0; i < lastChannels.length; i++) set[lastChannels[i].channel] = 1;
    var names = Object.keys(set);
    if (!names.length) names = ["production"];
    names.sort();
    return names;
  }

  function render(data) {
    lastChannels = data.channels || [];
    var updates = data.updates || [];
    byId("loading").classList.add("hidden");
    byId("err").classList.add("hidden");
    byId("content").classList.remove("hidden");

    // Channels
    var ch = byId("channels");
    if (!lastChannels.length) {
      ch.innerHTML = '<div class="empty">No channel pointers yet. Publish with <span class="mono">node ota-server/publish.mjs --app ' + esc(app) + '</span>.</div>';
    } else {
      var chHtml = "";
      for (var i = 0; i < lastChannels.length; i++) {
        var c = lastChannels[i];
        chHtml += '<div class="card">' +
          '<div class="row"><span class="badge b-ch">' + esc(c.channel) + '</span>' +
          '<span class="muted mono" title="' + esc(c.runtimeVersion) + '">rtv ' + esc(shortId(c.runtimeVersion)) + '</span></div>' +
          '<div class="mono" style="margin-top:8px">' + esc(shortId(c.updateId)) + '</div>' +
          '<div class="muted" style="font-size:12px;margin-top:4px">' + esc(fmt(c.createdAt)) + '</div>' +
          '</div>';
      }
      ch.innerHTML = chHtml;
    }

    // History
    byId("histTitle").textContent = "Update history (" + updates.length + ")";
    var up = byId("updates");
    if (!updates.length) {
      up.innerHTML = '<div class="empty">No updates published for this app yet.</div>';
      return;
    }
    var names = channelNames();
    var html = "";
    for (var j = 0; j < updates.length; j++) {
      var u = updates[j];
      html += '<div class="upd">';
      html += '<div class="row">';
      html += '<span class="mono" style="font-weight:600">' + esc(shortId(u.id)) + '</span>';
      html += '<span class="muted mono" title="' + esc((u.runtimeVersions || []).join(", ")) + '">rtv ' + esc(rtvLabel(u)) + '</span>';
      for (var p = 0; p < u.platforms.length; p++) html += '<span class="badge b-plat">' + esc(u.platforms[p]) + '</span>';
      if (u.forceUpdate) html += '<span class="badge b-force">mandatory</span>';
      for (var l = 0; l < u.liveOn.length; l++) html += '<span class="badge b-live">live · ' + esc(u.liveOn[l]) + '</span>';
      html += '</div>';
      if (u.message) html += '<div style="margin-top:8px">' + esc(u.message) + '</div>';
      html += '<div class="muted" style="font-size:12px;margin-top:6px">' + esc(fmt(u.createdAt));
      if (u.gitCommit) html += ' · <span class="mono">' + esc(String(u.gitCommit).slice(0, 8)) + '</span>';
      html += '</div>';
      html += '<div class="acts">';
      for (var n = 0; n < names.length; n++) {
        var chName = names[n];
        var live = isLiveOn(u, chName);
        html += '<button ' + (live ? 'class="live" disabled' : 'onclick="OTA.promote(\\'' + esc(u.id) + '\\',\\'' + esc(chName) + '\\')"') + '>' +
          (live ? "Live · " : "Set live · ") + esc(chName) + '</button>';
      }
      html += '<button class="' + (u.forceUpdate ? '' : 'danger') + '" style="margin-left:auto" ' +
        'onclick="OTA.toggleForce(\\'' + esc(u.id) + '\\',' + (u.forceUpdate ? 'true' : 'false') + ')">' +
        (u.forceUpdate ? "Make optional" : "Make mandatory") + '</button>';
      html += '</div></div>';
    }
    up.innerHTML = html;
  }

  function load() {
    byId("content").classList.add("hidden");
    byId("loading").classList.remove("hidden");
    byId("err").classList.add("hidden");
    api("GET", "state?app=" + app).then(render).catch(handleErr);
  }

  // Public actions used by inline onclick handlers.
  window.OTA = {
    promote: function (id, channel) {
      if (!confirm("Make update " + shortId(id) + " live on \\"" + channel + "\\"?\\n\\nClients on this channel get it on their next check. Use this to roll forward or roll back.")) return;
      api("POST", "promote", { app: app, channel: channel, updateId: id })
        .then(function (r) { toast("Live on " + channel + " (rtv " + (r.runtimeVersions || []).map(shortId).join(", ") + ")"); load(); })
        .catch(function (e) { toast(e.message || "Promote failed", true); });
    },
    toggleForce: function (id, cur) {
      var next = !cur;
      var q = next
        ? "Mark update " + shortId(id) + " as MANDATORY? Clients will be forced to reload immediately."
        : "Remove mandatory flag from " + shortId(id) + "? It will apply silently on next launch.";
      if (!confirm(q)) return;
      api("POST", "force", { app: app, updateId: id, force: next })
        .then(function () { toast(next ? "Marked mandatory" : "Mandatory flag removed"); load(); })
        .catch(function (e) { toast(e.message || "Failed", true); });
    }
  };

  // Wire up static controls.
  byId("loginBtn").addEventListener("click", login);
  byId("token").addEventListener("keydown", function (e) { if (e.key === "Enter") login(); });
  byId("logoutBtn").addEventListener("click", logout);
  byId("refreshBtn").addEventListener("click", load);
  var tabs = document.querySelectorAll(".tab");
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener("click", function (e) {
      var el = e.currentTarget;
      for (var k = 0; k < tabs.length; k++) tabs[k].classList.remove("active");
      el.classList.add("active");
      app = el.getAttribute("data-app");
      load();
    });
  }

  if (token) { showApp(); load(); } else { showAuth(); }
})();
</script>
</body>
</html>`;
