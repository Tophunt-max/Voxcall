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
//
// Layout:
//   src/index.ts     ← this file: routing + Expo manifest/asset endpoints
//   src/shared.ts    ← shared types, constants, helpers
//   src/console/     ← the built-in web console (UI + token-gated API)
// ============================================================================

import {
  type Env,
  type AssetRecord,
  type UpdateRecord,
  PROTOCOL_VERSION,
  APPS,
  UPDATES_PREFIX,
  CHANNELS_PREFIX,
  METRICS_PREFIX,
  BUILDS_PREFIX,
  sanitize,
  json,
} from './shared';
import { handleConsoleApi, handleEasWebhook } from './console';
import { recordUpdateResult, maybeAutoRollback, pruneOld, buildDownloadUrl, type BuildRecord } from './console/store';
import { appendAudit } from './console/audit';
import { notify } from './notify';

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      return json({ status: 'ok', service: 'ota', protocol: PROTOCOL_VERSION, console: '/' });
    }
    // OTA bundle asset (exact `/assets` with ?key=). Vite's built assets live
    // under `/assets/<file>` and are served as static assets below.
    if (path === '/assets') {
      return serveAsset(request, env, url);
    }
    // Public installable-build download (APK/IPA). The key holds an unguessable
    // build UUID; served as an attachment so testers can install via a shared
    // link/QR without the console token (same model as ad-hoc/TestFlight links).
    if (path === '/download') {
      return serveDownload(request, env, url);
    }
    // Public install landing page for a build (mobile-friendly): Android taps
    // the APK; iOS installs over-the-air via an itms-services manifest plist.
    //   /install/<app>/<buildId>            → HTML page
    //   /install/<app>/<buildId>/manifest.plist → iOS OTA manifest
    {
      const im = path.match(/^\/install\/([a-z0-9_-]+)\/([a-z0-9-]+)(\/manifest\.plist)?$/i);
      if (im) return serveInstall(env, url, im[1], im[2], Boolean(im[3]));
    }
    // Client update-outcome report (best-effort health + optional auto-rollback).
    if (path === '/report') {
      return handleReport(request, env, ctx);
    }
    // EAS Build webhook — auto-publishes finished builds to Downloads. Verified
    // by HMAC signature (not the console token), so it lives before the console
    // API auth gate. Works for builds triggered anywhere (local / dashboard / CI).
    if (path === '/console/hooks/eas') {
      return handleEasWebhook(request, env, url);
    }
    // Console API (same origin as the served SPA — no CORS needed).
    if (path.startsWith('/console/api/')) {
      return handleConsoleApi(request, env, url, path, ctx);
    }
    const m = path.match(/^\/manifest\/([a-z0-9_-]+)$/i);
    if (m) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return serveManifest(request, env, url, m[1], ctx);
    }
    // Everything else → the React console (static assets), with SPA fallback.
    return serveConsoleApp(request, env);
  },

  // Daily retention sweep (cron in wrangler.toml). Prunes updates/builds older
  // than RETENTION_DAYS, always keeping live + newest. Disabled when unset.
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const days = Number(env.RETENTION_DAYS);
    if (!Number.isFinite(days) || days <= 0) return;
    for (const app of APPS) {
      const r = await pruneOld(env, app, days);
      if (r.updatesDeleted || r.buildsDeleted) {
        await notify(env, `🧹 Retention (${app}): pruned ${r.updatesDeleted} update(s), ${r.buildsDeleted} build(s) older than ${days}d.`);
      }
    }
  },
};

// Serve the built React console from static assets. On an asset miss (a
// client-side route like /updates), fall back to index.html so the SPA router
// can take over.
async function serveConsoleApp(request: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404) return res;
  const url = new URL(request.url);
  return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
}

// ─── Manifest endpoint (the Expo Updates request) ───────────────────────────
async function serveManifest(request: Request, env: Env, url: URL, app: string, ctx: ExecutionContext): Promise<Response> {
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
  const clientId = request.headers.get('eas-client-id') || '';

  // Best-effort adoption metric: remember which update this device is currently
  // running (one object per install, overwritten each check). Fire-and-forget —
  // it must never add latency to, or fail, the manifest response.
  if (clientId) {
    ctx.waitUntil(recordAdoption(env, app, clientId, currentUpdateId, runtimeVersion, platform));
  }

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
  let pointer: { updateId?: string; rollout?: number; rollBackToEmbedded?: boolean; commitTime?: string };
  try {
    pointer = (await pointerObj.json()) as typeof pointer;
  } catch {
    return noUpdate(commonHeaders);
  }
  // Kill-switch: tell the client to revert to the bundle embedded in its build.
  if (pointer.rollBackToEmbedded) {
    return serveDirective(
      request,
      env,
      { type: 'rollBackToEmbedded', parameters: { commitTime: pointer.commitTime || new Date().toISOString() } },
      commonHeaders,
    );
  }
  if (!pointer.updateId) return noUpdate(commonHeaders);

  // 2. Already on the latest? Tell the client there's nothing new.
  if (currentUpdateId && currentUpdateId === pointer.updateId) return noUpdate(commonHeaders);

  // 2b. Staged rollout. When the pointer targets only a fraction of devices,
  // decide deterministically per device: hash(EAS-Client-ID + updateId) → 0..99.
  // A device in the bucket gets the update; one outside stays on what it has
  // (204). The mapping is stable, so bumping the % only ever ADDS devices — a
  // device that once qualified never loses the update on a later check.
  const rollout = typeof pointer.rollout === 'number' ? pointer.rollout : 100;
  if (rollout < 100) {
    // expo-updates sends a persistent per-install id; fall back to the current
    // update id, and fail-open (serve) only if we truly have no identifier.
    const bucketId = clientId || currentUpdateId || '';
    if (bucketId && hashPercent(`${bucketId}:${pointer.updateId}`) >= rollout) {
      return noUpdate(commonHeaders);
    }
  }

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

// Serve an Expo Updates "directive" (e.g. rollBackToEmbedded) as multipart/mixed.
// Signed with the same key as manifests when the client asks for a signature.
async function serveDirective(
  request: Request,
  env: Env,
  directive: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  const bodyStr = JSON.stringify(directive);
  let signaturePart = '';
  if (request.headers.get('expo-expect-signature')) {
    if (!env.CODE_SIGNING_PRIVATE_KEY) {
      return json({ error: 'Code signing requested but server has no signing key' }, 500);
    }
    try {
      const sig = await signRsaSha256(bodyStr, env.CODE_SIGNING_PRIVATE_KEY);
      const keyid = env.CODE_SIGNING_KEY_ID || 'root';
      signaturePart = `expo-signature: sig="${sig}", keyid="${keyid}", alg="rsa-v1_5-sha256"\r\n`;
    } catch {
      return json({ error: 'Directive signing failed' }, 500);
    }
  }
  const boundary = `voxcall-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="directive"\r\n` +
    `Content-Type: application/json\r\n` +
    signaturePart +
    `\r\n` +
    bodyStr +
    `\r\n` +
    `--${boundary}--\r\n`;
  return new Response(body, {
    status: 200,
    headers: { ...headers, 'content-type': `multipart/mixed; boundary=${boundary}` },
  });
}

// ─── Client update-outcome report → health + optional auto-rollback ─────────
async function handleReport(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const app = String(body.app ?? '');
  const updateId = String(body.updateId ?? '').trim();
  const status = String(body.status ?? '').toLowerCase();
  if (!APPS.has(app)) return json({ error: 'invalid app' }, 400);
  if (!updateId) return json({ ok: true }); // running the embedded bundle — nothing to record
  const outcome = status === 'error' || status === 'fail' || status === 'failed' ? 'error' : 'ok';
  const message = typeof body.message === 'string' ? body.message : undefined;
  const health = await recordUpdateResult(env, app, updateId, outcome, message);
  if (outcome === 'error') {
    const rolled = await maybeAutoRollback(env, app, updateId, health);
    if (rolled.length) {
      ctx.waitUntil(
        notify(
          env,
          `⚠️ Auto-rollback (${app}): update ${updateId.slice(0, 8)} failed ${health.err}/${health.ok + health.err} — rolled back: ${rolled.join(', ')}`,
        ),
      );
      ctx.waitUntil(
        appendAudit(env, { app, action: 'auto-rollback', actor: 'auto', detail: { updateId, channels: rolled, health } }),
      );
    }
  }
  return json({ ok: true });
}

// ─── Public install landing page for a build ─────────────────────────────────
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

async function serveInstall(env: Env, url: URL, app: string, buildId: string, plist: boolean): Promise<Response> {
  if (!APPS.has(app)) return new Response('Unknown app', { status: 404 });
  const rec = await readBuild(env, app, buildId);
  if (!rec) return new Response('Build not found', { status: 404 });
  const dl = buildDownloadUrl(rec, url.origin);
  const version = rec.version || '';
  const bundleId = rec.bundleId || `com.voxcall.${app}`;
  const title = `VoxCall ${app === 'host' ? 'Host' : 'User'}`;

  // iOS OTA manifest (itms-services). Requires an ad-hoc-signed .ipa on a
  // registered device; App Store builds won't install this way.
  if (plist) {
    const pl =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
      `<plist version="1.0"><dict><key>items</key><array><dict>` +
      `<key>assets</key><array><dict>` +
      `<key>kind</key><string>software-package</string>` +
      `<key>url</key><string>${esc(dl)}</string>` +
      `</dict></array>` +
      `<key>metadata</key><dict>` +
      `<key>bundle-identifier</key><string>${esc(bundleId)}</string>` +
      `<key>bundle-version</key><string>${esc(version || '1.0.0')}</string>` +
      `<key>kind</key><string>software</string>` +
      `<key>title</key><string>${esc(title)}</string>` +
      `</dict></dict></array></dict></plist>`;
    return new Response(pl, { headers: { 'content-type': 'application/xml', 'cache-control': 'no-store' } });
  }

  const isIos = rec.platform === 'ios';
  const plistUrl = `${url.origin}/install/${app}/${buildId}/manifest.plist`;
  const iosHref = `itms-services://?action=download-manifest&url=${encodeURIComponent(plistUrl)}`;
  const primaryHref = isIos ? iosHref : dl;
  const meta = [rec.platform === 'ios' ? 'iOS' : 'Android', version && `v${version}${rec.buildNumber ? ` (${rec.buildNumber})` : ''}`, rec.channel]
    .filter(Boolean)
    .join(' · ');

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Install ${esc(title)}</title><style>` +
    `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;` +
    `font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;` +
    `background:radial-gradient(900px 500px at 100% -10%,rgba(124,92,255,.18),transparent 60%),#0a0b12;color:#e6e8f2}` +
    `.card{width:100%;max-width:380px;margin:20px;padding:28px;border-radius:20px;background:linear-gradient(180deg,#12131c,#0d0e16);` +
    `border:1px solid #22243a;box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center}` +
    `.logo{width:64px;height:64px;border-radius:18px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;` +
    `background:linear-gradient(135deg,#7c5cff,#5b8cff);font-size:28px;font-weight:800;color:#fff}` +
    `h1{font-size:20px;margin:0 0 4px}.meta{color:#9aa0b8;font-size:13px;margin-bottom:22px}` +
    `.btn{display:block;width:100%;padding:15px;border-radius:14px;font-size:16px;font-weight:600;text-decoration:none;color:#fff;` +
    `background:linear-gradient(135deg,#7c5cff,#5b8cff);box-shadow:0 10px 30px rgba(124,92,255,.35)}` +
    `.hint{margin-top:16px;font-size:12px;color:#7e849c;line-height:1.5}a.alt{color:#9d7bff}` +
    `</style></head><body><div class="card">` +
    `<div class="logo">V</div><h1>${esc(title)}</h1><div class="meta">${esc(meta)}</div>` +
    `<a class="btn" href="${esc(primaryHref)}">${isIos ? 'Install on iPhone' : 'Download &amp; install APK'}</a>` +
    `<div class="hint">` +
    (isIos
      ? `Open this page in Safari on the device. After tapping Install, allow the app in Settings › General › VPN &amp; Device Management. Ad-hoc builds only install on registered devices.`
      : `If the install is blocked, allow "Install unknown apps" for your browser, then open the downloaded file.`) +
    `<br><br><a class="alt" href="${esc(dl)}">Direct download link</a></div>` +
    `</div></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function readBuild(env: Env, app: string, buildId: string): Promise<BuildRecord | null> {
  const safe = sanitize(buildId);
  const obj = await env.STORAGE.get(`${BUILDS_PREFIX}/${app}/${safe}/build.json`);
  if (!obj) return null;
  try {
    return (await obj.json()) as BuildRecord;
  } catch {
    return null;
  }
}

// Best-effort adoption record: one R2 object per install (overwritten each
// check) whose customMetadata carries the update it's running. The console
// tallies these by listing with customMetadata — no per-object reads, and one
// object per device means counts never inflate with stale entries. Any failure
// is swallowed; metrics must never affect update delivery.
async function recordAdoption(
  env: Env,
  app: string,
  clientId: string,
  currentUpdateId: string | null,
  runtimeVersion: string,
  platform: string,
): Promise<void> {
  try {
    const key = `${METRICS_PREFIX}/${app}/clients/${sanitize(clientId)}`;
    await env.STORAGE.put(key, '', {
      customMetadata: {
        u: currentUpdateId || 'embedded',
        rv: runtimeVersion,
        p: platform,
        t: String(Date.now()),
      },
    });
  } catch {
    // ignore — best-effort telemetry
  }
}

// Map a string to a stable bucket 0..99 (FNV-1a 32-bit). Used for staged
// rollout: the same device+update always lands in the same bucket, so raising
// the rollout percentage only ever adds devices, never revokes.
function hashPercent(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h % 100;
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

// ─── Build download endpoint ─────────────────────────────────────────────────
// Serves an uploaded installable build (APK/IPA) from R2 as an attachment.
// Restricted to the ota/builds/ prefix so it can never read other R2 objects.
async function serveDownload(_request: Request, env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get('key');
  if (!key || !key.startsWith('ota/builds/') || key.includes('..')) {
    return json({ error: 'Invalid download key' }, 400);
  }
  const obj = await env.STORAGE.get(key);
  if (!obj) return json({ error: 'Build not found' }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  const rawName = url.searchParams.get('name') || key.split('/').pop() || 'download';
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  headers.set('content-disposition', `attachment; filename="${safeName}"`);
  headers.set('cache-control', 'private, max-age=300');
  headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

// ─── Code signing helpers ────────────────────────────────────────────────────
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
