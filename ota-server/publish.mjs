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
  console.error('Usage: publish.mjs --app <user|host> [--channel production] [--runtime-version X] [--force] [--message "..."]');
  process.exit(1);
}
const channel = argValue('channel', 'production');
// `--force` marks the update MANDATORY — the client shows a blocking updater
// and reloads immediately instead of applying silently on the next restart.
const forceUpdate = hasFlag('force');
const git = gitInfo();
const message = argValue('message', git.subject || '');
const appDir = path.join(REPO_ROOT, APP_DIRS[app]);
const appJson = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8'));
const version = appJson.expo?.version || '1.0.0';
const runtimeVersion = argValue('runtime-version', version); // matches app.json runtimeVersion policy "appVersion"
const projectId = appJson.expo?.extra?.eas?.projectId;

const updateId = crypto.randomUUID();
const createdAt = new Date().toISOString();
const distDir = path.join(appDir, '.ota-export');

console.log(`\n📦 OTA publish — app="${app}" (${APP_DIRS[app]})`);
console.log(`   runtimeVersion=${runtimeVersion}  channel=${channel}  updateId=${updateId}`);
console.log(`   force=${forceUpdate}${message ? `  message="${message}"` : ''}${git.commit ? `  git=${git.commit}` : ''}\n`);

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

  platforms[platform] = { launchAsset, assets };
}

if (Object.keys(platforms).length === 0) {
  console.error('❌ No android/ios entries in export metadata — nothing to publish.');
  process.exit(1);
}

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
const record = { id: updateId, createdAt, runtimeVersion, extra, platforms };
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

// 5. Flip the channel pointer LAST — makes the update go live atomically.
const pointerLocal = path.join(distDir, 'pointer.json');
fs.writeFileSync(pointerLocal, JSON.stringify({ updateId, createdAt, runtimeVersion }));
putObject(`ota/channels/${app}/${sanitize(channel)}/${sanitize(runtimeVersion)}.json`, pointerLocal, 'application/json');

console.log(`\n✅ Published ${updateId} → channel "${channel}" (runtimeVersion ${runtimeVersion}).`);
console.log('   Clients on this runtimeVersion + channel get it on their next update check.\n');

function putObject(key, localPath, contentType) {
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', localPath, '--content-type', contentType, '--remote'],
    { cwd: OTA_DIR, stdio: ['ignore', 'ignore', 'inherit'] },
  );
}
