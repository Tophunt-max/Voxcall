#!/usr/bin/env node
// ============================================================================
// Build an installable app binary (APK / IPA) and publish it to the OTA
// Downloads page — from YOUR machine, no GitHub Actions required.
// ============================================================================
// Two modes:
//   • default (cloud)  → `eas build --wait` on Expo's servers, then registers
//                        the artifact URL. Uses EAS build credits.
//   • --local (FREE)   → `eas build --local` runs the build on THIS machine
//                        (no EAS build credits) and uploads the binary to the
//                        OTA server. This is the cost-free path. Requires the
//                        native toolchain locally (JDK+Android SDK for Android;
//                        macOS+Xcode for iOS).
//
// Usage (from repo root or anywhere):
//   OTA_SERVER_URL="https://<ota-host>" OTA_CONSOLE_PASSWORD="<console password>" \
//   node ota-server/build.mjs --app user --platform android --profile preview --local
//
//   # or via workspace script:
//   pnpm --filter @workspace/ota-server run build-app -- --app host --platform android --local
//
// Flags:
//   --app        user | host            (required)
//   --platform   android | ios          (default: android)
//   --profile    preview | production   (default: preview)  → also the channel
//   --local      build on this machine (free, no EAS credits)
//   --server     OTA base URL           (or env OTA_SERVER_URL)
//   --password   console bearer token   (or env OTA_CONSOLE_PASSWORD)
//
// Auth: `eas` must be logged in (EXPO_TOKEN env or `eas login`) — even --local
// uses it to fetch signing credentials (not build quota). If the OTA
// server/password are omitted the build still runs; publishing is skipped.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_DIRS = { user: 'voxlink', host: 'voxlink-host' };

function argValue(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const app = argValue('app');
const platform = argValue('platform', 'android');
const profile = argValue('profile', 'preview');
const local = hasFlag('local');
const server = (argValue('server', process.env.OTA_SERVER_URL || '') || '').replace(/\/+$/, '');
const password = argValue('password', process.env.OTA_CONSOLE_PASSWORD || '');

if (!APP_DIRS[app]) {
  console.error('Usage: node ota-server/build.mjs --app <user|host> [--platform android|ios] [--profile preview|production] [--local]');
  process.exit(1);
}
if (platform !== 'android' && platform !== 'ios') {
  console.error(`Invalid --platform "${platform}" (expected android|ios).`);
  process.exit(1);
}

const appDir = path.join(REPO_ROOT, APP_DIRS[app]);

// App version metadata (used for the build record; appVersionSource is "local").
function appMeta() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8'));
    const version = j.expo?.version || '';
    const buildNumber =
      platform === 'ios'
        ? String(j.expo?.ios?.buildNumber ?? '')
        : String(j.expo?.android?.versionCode ?? '');
    return { version, buildNumber };
  } catch {
    return { version: '', buildNumber: '' };
  }
}

if (local) {
  await runLocal();
} else {
  await runCloud();
}

// ─── FREE local build → upload binary ────────────────────────────────────────
async function runLocal() {
  const ext = platform === 'ios' ? 'ipa' : profile === 'production' ? 'aab' : 'apk';
  const outFile = path.join(REPO_ROOT, `.build-${app}-${platform}.${ext}`);
  console.log(`\n🏗  Local build (FREE, no EAS credits) — app="${app}" platform=${platform} profile=${profile}`);
  console.log('   Running `eas build --local` on this machine…\n');

  try {
    execFileSync(
      'eas',
      ['build', '--platform', platform, '--profile', profile, '--local', '--non-interactive', '--output', outFile],
      { cwd: appDir, stdio: 'inherit' },
    );
  } catch (e) {
    console.error('\n❌ Local build failed. See the log above.');
    process.exit(e.status || 1);
  }
  if (!fs.existsSync(outFile)) {
    console.error(`❌ Expected artifact not found at ${outFile}.`);
    process.exit(1);
  }
  const { size } = fs.statSync(outFile);
  const { version, buildNumber } = appMeta();
  console.log(`\n✅ Built ${outFile} (${(size / 1048576).toFixed(1)} MB)  version=${version || '?'} (${buildNumber || '?'})`);

  if (!server || !password) {
    console.log('ℹ️  OTA_SERVER_URL / OTA_CONSOLE_PASSWORD not provided — skipping upload. Artifact kept above.');
    process.exit(0);
  }
  if (size > 100 * 1048576) {
    console.warn(`⚠️  Artifact is ${(size / 1048576).toFixed(0)} MB — larger than the ~100 MB Workers upload limit; upload may fail.`);
  }

  const filename = `voxcall-${app}-${platform}-${version || 'build'}.${ext}`;
  const contentType = ext === 'apk' ? 'application/vnd.android.package-archive' : 'application/octet-stream';
  const qs = new URLSearchParams({
    app, platform, channel: profile, version, buildNumber,
    notes: `Local build · ${profile}`, filename,
  }).toString();

  const res = await fetch(`${server}/console/api/builds/upload?${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${password}`, 'Content-Type': contentType },
    body: fs.readFileSync(outFile),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`❌ OTA upload failed (HTTP ${res.status}): ${json.error || 'unknown error'}`);
    process.exit(1);
  }
  console.log(`🎉 Uploaded to Downloads (${profile}) — testers can install it now.\n`);
}

// ─── Cloud build (EAS credits) → register artifact URL ───────────────────────
async function runCloud() {
  console.log(`\n🏗  EAS cloud build — app="${app}" platform=${platform} profile=${profile}`);
  console.log('   Submitting to EAS and waiting (~15-25 min). Tip: add --local to build FREE on this machine.\n');

  let out;
  try {
    out = execFileSync(
      'eas',
      ['build', '--platform', platform, '--profile', profile, '--non-interactive', '--wait', '--json'],
      { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    console.error('\n❌ EAS build failed. See the log above / track it on https://expo.dev.');
    process.exit(e.status || 1);
  }

  let build;
  try {
    const parsed = JSON.parse(out.trim());
    build = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    console.error('❌ Could not parse EAS JSON output.');
    console.error(out);
    process.exit(1);
  }

  const url = build?.artifacts?.applicationArchiveUrl || build?.artifacts?.buildUrl || '';
  const version = build?.appVersion || '';
  const buildNumber = build?.appBuildVersion || '';
  const status = build?.status || '';

  if (status && String(status).toUpperCase() !== 'FINISHED') {
    console.error(`❌ EAS build status is "${status}" (expected FINISHED).`);
    process.exit(1);
  }
  if (!url) {
    console.error('❌ No artifact download URL in the EAS output — nothing to register.');
    process.exit(1);
  }

  console.log(`\n✅ EAS build finished. version=${version || '?'} (${buildNumber || '?'})\n   artifact: ${url}\n`);

  if (!server || !password) {
    console.log('ℹ️  OTA_SERVER_URL / OTA_CONSOLE_PASSWORD not provided — skipping registration.');
    process.exit(0);
  }

  const base = url.split('?')[0];
  const fileFromUrl = base.substring(base.lastIndexOf('/') + 1);
  const filename = /\.(apk|aab|ipa)$/i.test(fileFromUrl)
    ? fileFromUrl
    : `${app}-${platform}-${version || 'build'}.${platform === 'ios' ? 'ipa' : 'apk'}`;

  const res = await fetch(`${server}/console/api/builds`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app, channel: profile, platform, version, buildNumber,
      notes: `Local build · ${profile}`, externalUrl: url, filename,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`❌ OTA registration failed (HTTP ${res.status}): ${json.error || 'unknown error'}`);
    process.exit(1);
  }
  console.log(`🎉 Published to Downloads (${profile}) — testers can install it now.\n`);
}
