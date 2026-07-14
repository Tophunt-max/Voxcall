// ============================================================================
// EAS Build webhook — POST /console/hooks/eas
// ============================================================================
// Lets EAS Build auto-publish finished builds to the Downloads page no matter
// HOW the build was triggered: a local `eas build`, the expo.dev dashboard, or
// CI. This is the GitHub-Actions-independent, "just like Expo" path.
//
// Setup (run ONCE — see wrangler.toml / README):
//   wrangler secret put EAS_WEBHOOK_SECRET                     # any long random string
//   cd voxlink      && eas webhook:create --event BUILD \
//     --url "https://<ota-host>/console/hooks/eas?app=user" --secret "<same secret>"
//   cd voxlink-host && eas webhook:create --event BUILD \
//     --url "https://<ota-host>/console/hooks/eas?app=host" --secret "<same secret>"
//
// Security: EAS signs the RAW request body with HMAC-SHA1 (hex) using the
// secret and sends it in the `expo-signature` header. We recompute it and do a
// constant-time compare before trusting anything. When the secret is unset the
// endpoint is disabled (503) so the worker never exposes an open write surface.
// ============================================================================

import { type Env, APPS, json } from '../shared';
import { registerBuild, buildDownloadUrl } from './store';

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

// Constant-time compare of two equal-length hex strings.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha1Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return toHex(sig);
}

interface EasBuildWebhook {
  platform?: string;
  status?: string;
  buildDetailsPageUrl?: string;
  projectName?: string;
  artifacts?: { buildUrl?: string; applicationArchiveUrl?: string };
  metadata?: {
    appVersion?: string;
    appBuildVersion?: string;
    buildProfile?: string;
    channel?: string;
    appName?: string;
    appIdentifier?: string;
  };
}

// The webhook URL should carry ?app=user|host (each Expo project gets its own
// webhook). Fall back to inferring from the project/app names just in case.
function resolveApp(url: URL, p: EasBuildWebhook): string | null {
  const q = (url.searchParams.get('app') || '').trim();
  if (APPS.has(q)) return q;
  const hay = `${p.projectName ?? ''} ${p.metadata?.appName ?? ''} ${p.metadata?.appIdentifier ?? ''}`.toLowerCase();
  if (hay.includes('host')) return 'host';
  if (hay.includes('voxlink') || hay.includes('vixcall') || hay.includes('user')) return 'user';
  return null;
}

function filenameFor(downloadUrl: string, app: string, platform: string, version: string): string {
  try {
    const base = new URL(downloadUrl).pathname.split('/').pop() || '';
    if (/\.(apk|aab|ipa)$/i.test(base)) return base;
  } catch {
    /* ignore malformed url */
  }
  return `${app}-${platform}-${version || 'build'}.${platform === 'ios' ? 'ipa' : 'apk'}`;
}

export async function handleEasWebhook(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.EAS_WEBHOOK_SECRET) {
    return json({ error: 'EAS webhook disabled — set the EAS_WEBHOOK_SECRET secret to enable it.' }, 503);
  }

  // Verify the signature over the EXACT bytes EAS sent (raw body).
  const raw = await request.text();
  const header = request.headers.get('expo-signature') || '';
  const provided = (header.startsWith('sha1=') ? header.slice(5) : header).trim().toLowerCase();
  if (!provided) return json({ error: 'Missing expo-signature header' }, 401);
  const expected = await hmacSha1Hex(env.EAS_WEBHOOK_SECRET, raw);
  if (!timingSafeEqual(provided, expected)) return json({ error: 'Invalid signature' }, 401);

  let payload: EasBuildWebhook;
  try {
    payload = JSON.parse(raw) as EasBuildWebhook;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const status = String(payload.status ?? '').toLowerCase();
  const platform = String(payload.platform ?? '').toLowerCase();
  const downloadUrl = (payload.artifacts?.applicationArchiveUrl || payload.artifacts?.buildUrl || '').trim();

  // Acknowledge (200) non-actionable events without registering a build so EAS
  // treats them as delivered and doesn't retry.
  if (status !== 'finished') return json({ ok: true, skipped: `status=${status || 'unknown'}` });
  if (platform !== 'android' && platform !== 'ios') return json({ ok: true, skipped: `platform=${platform || 'unknown'}` });
  if (!/^https:\/\/\S+$/i.test(downloadUrl)) return json({ ok: true, skipped: 'no artifact url' });

  const app = resolveApp(url, payload);
  if (!app) {
    return json({ error: 'Could not determine app — add ?app=user or ?app=host to the webhook URL.' }, 400);
  }

  const md = payload.metadata ?? {};
  const channel = (md.buildProfile || md.channel || 'production').trim() || 'production';
  const version = (md.appVersion || '').trim();

  const rec = await registerBuild(env, app, {
    channel,
    platform,
    version,
    buildNumber: (md.appBuildVersion || '').trim(),
    notes: `EAS build · ${md.buildProfile || channel}${payload.buildDetailsPageUrl ? ` · ${payload.buildDetailsPageUrl}` : ''}`,
    externalUrl: downloadUrl,
    filename: filenameFor(downloadUrl, app, platform, version),
    bundleId: (md.appIdentifier || '').trim() || undefined,
  });

  return json({ ok: true, build: { ...rec, downloadUrl: buildDownloadUrl(rec, url.origin) } });
}
