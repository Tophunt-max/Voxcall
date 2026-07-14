// ============================================================================
// VoxCall self-hosted OTA server — Expo Updates protocol v1
// ============================================================================
// Implements https://docs.expo.dev/technical-specs/expo-updates-1/ as a
// Cloudflare Worker, serving updates published to the shared R2 bucket by
// `scripts/publish.mjs`. One deployment serves BOTH apps:
//   • voxlink       → /manifest/user
//   • voxlink-host  → /manifest/host
//
// R2 layout (all under the `ota/` prefix so it never touches app media):
//   ota/updates/<app>/<updateId>/update.json     ← precomputed manifest record
//   ota/updates/<app>/<updateId>/<bundle+assets>  ← the exported files
//   ota/channels/<app>/<channel>/<runtimeVersion>.json  ← { updateId } pointer
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
      return json({ status: 'ok', service: 'voxcall-ota', protocol: PROTOCOL_VERSION });
    }
    if (path === '/assets') {
      return serveAsset(request, env, url);
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
    runtimeVersion: record.runtimeVersion,
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
