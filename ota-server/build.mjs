#!/usr/bin/env node
// ============================================================================
// Build an installable app binary (APK / IPA) on EAS and publish it to the OTA
// Downloads page — from YOUR machine, no GitHub Actions required.
// ============================================================================
// This is the local equivalent of the build-*.yml workflows: it kicks off an
// EAS cloud build (exactly like Expo), waits for it to finish, then registers
// the resulting artifact on the OTA server so it shows up on Downloads, ready
// to download & share.
//
// Usage (from repo root or anywhere):
//   OTA_SERVER_URL="https://<ota-host>" \
//   OTA_CONSOLE_PASSWORD="<console password>" \
//   node ota-server/build.mjs --app user --platform android --profile preview
//
//   # or via workspace script:
//   pnpm --filter @workspace/ota-server run build-app -- --app host --platform ios
//
// Flags:
//   --app        user | host            (required)
//   --platform   android | ios          (default: android)
//   --profile    preview | production   (default: preview)  → also the channel
//   --server     OTA base URL           (or env OTA_SERVER_URL)
//   --password   console bearer token   (or env OTA_CONSOLE_PASSWORD)
//
// Auth: `eas` must be logged in (EXPO_TOKEN env or `eas login`). If the OTA
// server/password are omitted the build still runs; registration is skipped.
//
// NOTE: If you've configured the EAS webhook (see wrangler.toml), you don't
// even need this script — a plain `eas build` auto-publishes via the webhook.
// This script is the zero-setup alternative for one-off local builds.
// ============================================================================

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

const app = argValue('app');
const platform = argValue('platform', 'android');
const profile = argValue('profile', 'preview');
const server = (argValue('server', process.env.OTA_SERVER_URL || '') || '').replace(/\/+$/, '');
const password = argValue('password', process.env.OTA_CONSOLE_PASSWORD || '');

if (!APP_DIRS[app]) {
  console.error('Usage: node ota-server/build.mjs --app <user|host> [--platform android|ios] [--profile preview|production]');
  process.exit(1);
}
if (platform !== 'android' && platform !== 'ios') {
  console.error(`Invalid --platform "${platform}" (expected android|ios).`);
  process.exit(1);
}

const appDir = path.join(REPO_ROOT, APP_DIRS[app]);
console.log(`\n🏗  EAS build — app="${app}" (${APP_DIRS[app]})  platform=${platform}  profile=${profile}`);
console.log('   Submitting to EAS cloud and waiting for it to finish (~15-25 min)…\n');

// 1. Build on EAS and wait; --json prints the finished build array to stdout.
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

// eas build --json prints an array of build objects; grab the first.
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

console.log(`\n✅ EAS build finished.`);
console.log(`   version=${version || '?'} (${buildNumber || '?'})`);
console.log(`   artifact: ${url}\n`);

// 2. Register the build on the OTA server so it appears on Downloads.
if (!server || !password) {
  console.log('ℹ️  OTA_SERVER_URL / OTA_CONSOLE_PASSWORD not provided — skipping registration.');
  console.log('   The build is still available at the artifact URL above.');
  process.exit(0);
}

const base = url.split('?')[0];
const fileFromUrl = base.substring(base.lastIndexOf('/') + 1);
const filename = /\.(apk|aab|ipa)$/i.test(fileFromUrl)
  ? fileFromUrl
  : `${app}-${platform}-${version || 'build'}.${platform === 'ios' ? 'ipa' : 'apk'}`;

const body = {
  app,
  channel: profile,
  platform,
  version,
  buildNumber,
  notes: `Local build · ${profile}`,
  externalUrl: url,
  filename,
};

const res = await fetch(`${server}/console/api/builds`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`❌ OTA registration failed (HTTP ${res.status}): ${json.error || 'unknown error'}`);
  process.exit(1);
}
console.log(`🎉 Published to Downloads (${profile}) — testers can install it now.\n`);
