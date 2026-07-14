#!/usr/bin/env node
// ============================================================================
// Publish an OTA update to the self-hosted VoxCall updates server.
// ============================================================================
// Runs `expo export`, hashes every file the way the Expo Updates protocol
// expects, uploads the bundle + assets to R2 (via wrangler), writes the
// precomputed manifest record, then flips the channel pointer LAST so a client
// never sees a half-uploaded update.
//
// Usage (from repo root or anywhere):
//   node ota-server/publish.mjs --app user  [--channel production] [--force] [--message "..."]
//   node ota-server/publish.mjs --app host
//   # or via workspace script:
//   pnpm --filter @workspace/ota-server run publish-update -- --app user --force
//
// Auth: wrangler must be authenticated — either `wrangler login` or a
// CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID) in the environment (same as CI).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OTA_DIR = __dirname; // ota-server/ (wrangler config lives here)
const REPO_ROOT = path.resolve(OTA_DIR, '..');
const BUCKET = 'voxcall';

const APP_DIRS = { user: 'voxlink', host: 'voxlink-host' };

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', mov: 'video/quicktime',
  json: 'application/json', js: 'application/javascript', hbc: 'application/javascript',
  lottie: 'application/json', txt: 'text/plain', db: 'application/octet-stream',
};

function argValue(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}
function gitInfo() {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
    const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: REPO_ROOT }).toString().trim();
    return { commit, subject };
  } catch {
    return { commit: null, subject: null };
  }
}
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256b64url = (buf) => b64url(crypto.createHash('sha256').update(buf).digest());
const md5hex = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const mimeFor = (ext) => MIME[String(ext || '').toLowerCase().replace(/^\./, '')] || 'application/octet-stream';
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');

const app = argValue('app');
if (!APP_DIRS[app]) {
  console.error('Usage: publish.mjs --app <user|host> [--channel production] [--runtime-version X] [--force] [--rollout N] [--message "..."]\n  runtimeVersion is taken from the app.json policy (appVersion | fingerprint); --runtime-version overrides it.\n  --rollout N stages the release to ~N% of devices (default 100); widen it later from the console.');
  process.exit(1);
}
const channel = argValue('channel', 'production');
// `--force` marks the update MANDATORY — the client shows a blocking updater
// and reloads immediately instead of applying silently on the next restart.
const forceUpdate = hasFlag('force');
// `--rollout N` stages the release to ~N% of devices (deterministic per install).
// Widen it later from the console's Channels tab; omit for a full 100% release.
const rolloutArg = argValue('rollout', null);
const rollout = rolloutArg ? Math.max(1, Math.min(100, Math.round(Number(rolloutArg)) || 100)) : 100;
const git = gitInfo();
const message = argValue('message', git.subject || '');
const appDir = path.join(REPO_ROOT, APP_DIRS[app]);
const appJson = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8'));
const version = appJson.expo?.version || '1.0.0';
const projectId = appJson.expo?.extra?.eas?.projectId;
// runtimeVersion is resolved PER PLATFORM (see resolveRuntimeVersion below) so
// the "fingerprint" policy — where iOS and Android can hash differently — works
// end-to-end. `--runtime-version X` still forces an explicit value for both.
const rtvOverride = argValue('runtime-version', null);
const rtvPolicy =
  typeof appJson.expo?.runtimeVersion === 'string'
    ? 'explicit'
    : appJson.expo?.runtimeVersion?.policy || 'appVersion';

const updateId = crypto.randomUUID();
const createdAt = new Date().toISOString();
const distDir = path.join(appDir, '.ota-export');

console.log(`\n📦 OTA publish — app="${app}" (${APP_DIRS[app]})`);
console.log(`   channel=${channel}  updateId=${updateId}`);
console.log(`   runtimeVersion=${rtvOverride ? `${rtvOverride} (cli override)` : `<per-platform · policy=${rtvPolicy}>`}`);
console.log(`   force=${forceUpdate}${rollout < 100 ? `  rollout=${rollout}%` : ''}${message ? `  message="${message}"` : ''}${git.commit ? `  git=${git.commit}` : ''}\n`);

// Resolve the runtimeVersion for a platform, honoring app.json's policy exactly
// like Expo's own build tooling:
//   • explicit string        → that string (both platforms identical)
//   • policy "appVersion"     → expo.version (default; both identical)
//   • policy "fingerprint"    → @expo/fingerprint hash of the native layer,
//                               computed per platform (iOS/Android may differ)
// A build embeds the SAME runtimeVersion, and a client only accepts a manifest
// whose runtimeVersion matches — this is the native/JS compatibility guarantee.
const _rtvCache = {};
function resolveRuntimeVersion(platform) {
  if (rtvOverride) return rtvOverride;
  if (_rtvCache[platform]) return _rtvCache[platform];
  const rv = appJson.expo?.runtimeVersion;
  let resolved;
  if (typeof rv === 'string') {
    resolved = rv;
  } else if ((rv?.policy || 'appVersion') === 'fingerprint') {
    resolved = computeFingerprint(platform);
  } else {
    // appVersion (default) — nativeVersion isn't computable here, so fall back
    // to the app version, which is also the safe default for managed apps.
    resolved = version;
  }
  _rtvCache[platform] = resolved;
  return resolved;
}

// Shell out to the expo-updates CLI, which prints the fingerprint as a JSON
// line ({ hash, sources }). Using the CLI (rather than requiring @expo/fingerprint
// directly) keeps this robust across expo-updates versions and pnpm hoisting.
function computeFingerprint(platform) {
  console.log(`   • computing ${platform} fingerprint (npx expo-updates fingerprint:generate) …`);
  let out;
  try {
    out = execFileSync('npx', ['expo-updates', 'fingerprint:generate', '--platform', platform], {
      cwd: appDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (e) {
    console.error(
      `❌ Failed to compute the ${platform} fingerprint. Ensure the app's dependencies are installed ` +
        `(pnpm install) so \`expo-updates fingerprint:generate\` can run.`,
    );
    throw e;
  }
  const line = out.trim().split('\n').filter(Boolean).pop() || '';
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`Could not parse fingerprint output for ${platform}: ${line}`);
  }
  if (!parsed || typeof parsed.hash !== 'string' || !parsed.hash) {
    throw new Error(`Fingerprint output for ${platform} had no hash.`);
  }
  return parsed.hash;
}

// 1. Export the JS bundle + assets for native platforms.
fs.rmSync(distDir, { recursive: true, force: true });
console.log('▶ expo export …');
execFileSync('npx', ['expo', 'export', '--platform', 'android', '--platform', 'ios', '--output-dir', distDir], {
  cwd: appDir,
  stdio: 'inherit',
});

// 2. Read the Metro export metadata.
const metadata = JSON.parse(fs.readFileSync(path.join(distDir, 'metadata.json'), 'utf8'));
const fileMeta = metadata.fileMetadata || {};

const storagePrefix = `ota/updates/${app}/${updateId}`;
const uploads = new Map(); // storageKey → { localPath, contentType }
const platforms = {};

for (const platform of ['android', 'ios']) {
  const pm = fileMeta[platform];
  if (!pm || !pm.bundle) continue;

  // The runtimeVersion the client on this platform will send + must match.
  const platformRuntimeVersion = resolveRuntimeVersion(platform);

  // launchAsset = the JS/Hermes bundle.
  const bundleAbs = path.join(distDir, pm.bundle);
  const bundleBuf = fs.readFileSync(bundleAbs);
  const bundleStorageKey = `${storagePrefix}/${pm.bundle}`;
  uploads.set(bundleStorageKey, { localPath: bundleAbs, contentType: 'application/javascript' });
  const launchAsset = {
    key: md5hex(bundleBuf),
    contentType: 'application/javascript',
    hash: sha256b64url(bundleBuf),
    storageKey: bundleStorageKey,
  };

  const assets = (pm.assets || []).map((a) => {
    const abs = path.join(distDir, a.path);
    const buf = fs.readFileSync(abs);
    const storageKey = `${storagePrefix}/${a.path}`;
    const contentType = mimeFor(a.ext);
    uploads.set(storageKey, { localPath: abs, contentType });
    const ext = a.ext ? `.${String(a.ext).replace(/^\./, '')}` : undefined;
    return { key: md5hex(buf), contentType, hash: sha256b64url(buf), ...(ext ? { fileExtension: ext } : {}), storageKey };
  });

  platforms[platform] = { runtimeVersion: platformRuntimeVersion, launchAsset, assets };
}

if (Object.keys(platforms).length === 0) {
  console.error('❌ No android/ios entries in export metadata — nothing to publish.');
  process.exit(1);
}

// Distinct runtimeVersions across the platforms we exported. Under appVersion
// this is a single value; under fingerprint it may be one per platform. We
// write one channel pointer per distinct runtimeVersion so every matching
// build finds this update. The record's top-level runtimeVersion is a display
// value (worker serves the per-platform one from platforms[p].runtimeVersion).
const runtimeVersions = [...new Set(Object.values(platforms).map((p) => p.runtimeVersion))];
const primaryRuntimeVersion = platforms.ios?.runtimeVersion ?? runtimeVersions[0];

// 3. Precomputed manifest record (what the Worker reads at request time).
// Everything under `extra` is surfaced to the client as `manifest.extra`
// (Updates.manifest.extra) — that's how the app reads forceUpdate/message/etc.
const extra = {
  ...(projectId ? { eas: { projectId } } : {}),
  forceUpdate,
  message,
  gitCommit: git.commit,
  publishedAt: createdAt,
};
const record = { id: updateId, createdAt, runtimeVersion: primaryRuntimeVersion, extra, platforms };
const recordPath = path.join(distDir, 'update.json');
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
uploads.set(`${storagePrefix}/update.json`, { localPath: recordPath, contentType: 'application/json' });

// 4. Upload every object (bundle + assets + record) to R2.
const entries = [...uploads.entries()];
console.log(`\n▶ Uploading ${entries.length} objects to R2 (${BUCKET}) …`);
let done = 0;
for (const [key, meta] of entries) {
  putObject(key, meta.localPath, meta.contentType);
  done++;
  if (done % 10 === 0 || done === entries.length) console.log(`   ${done}/${entries.length}`);
}

// 5. Flip the channel pointer(s) LAST — makes the update go live atomically.
// One pointer per distinct runtimeVersion (fingerprint policy can yield two).
for (const rtv of runtimeVersions) {
  const pointerLocal = path.join(distDir, `pointer-${sanitize(rtv)}.json`);
  fs.writeFileSync(pointerLocal, JSON.stringify({ updateId, createdAt, runtimeVersion: rtv, rollout }));
  putObject(`ota/channels/${app}/${sanitize(channel)}/${sanitize(rtv)}.json`, pointerLocal, 'application/json');
}

console.log(`\n✅ Published ${updateId} → channel "${channel}"${rollout < 100 ? ` (staged rollout ${rollout}%)` : ''}.`);
console.log(`   runtimeVersion(s): ${runtimeVersions.join(', ')}`);
console.log('   Clients on a matching runtimeVersion + channel get it on their next update check.\n');

function putObject(key, localPath, contentType) {
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', localPath, '--content-type', contentType, '--remote'],
    { cwd: OTA_DIR, stdio: ['ignore', 'ignore', 'inherit'] },
  );
}
