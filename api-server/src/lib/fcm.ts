// Firebase Cloud Messaging — HTTP v1 API sender
// Uses Service Account JWT to get OAuth2 access token, then sends via FCM HTTP v1
// Store service account JSON as wrangler secret: FIREBASE_SERVICE_ACCOUNT

const FCM_PROJECT_ID = 'connectme-80909';
const FCM_URL = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

interface ServiceAccount {
  private_key: string;
  client_email: string;
  token_uri?: string;
}

interface FCMMessage {
  token: string;
  notification?: { title?: string; body?: string; image?: string };
  data?: Record<string, string>;
  android?: {
    priority?: 'NORMAL' | 'HIGH';
    notification?: { channel_id?: string; sound?: string; click_action?: string };
  };
  apns?: {
    payload?: { aps?: { sound?: string; badge?: number; 'content-available'?: number } };
  };
  webpush?: {
    notification?: { icon?: string; badge?: string; requireInteraction?: boolean; vibrate?: number[] };
    fcm_options?: { link?: string };
  };
}

// Cache access token to avoid regenerating every request
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExpiry - 60) return cachedToken;

  const sa: ServiceAccount = JSON.parse(serviceAccountJson);
  const iat = now;
  const exp = iat + 3600;

  // Build JWT header + payload
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: sa.token_uri || GOOGLE_TOKEN_URL,
    iat,
    exp,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const sigInput = `${headerB64}.${payloadB64}`;

  // Import RSA private key using Web Crypto API (available in Cloudflare Workers)
  const pemKey = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(signBytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${sigInput}.${sig}`;

  // Exchange JWT for access token
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    throw new Error(`FCM OAuth2 failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokenData: any = await tokenRes.json();
  cachedToken = tokenData.access_token;
  tokenExpiry = now + (tokenData.expires_in || 3600);
  return cachedToken!;
}

/**
 * Does this FCM error mean the TOKEN is permanently dead (so we should stop
 * pushing to it and delete it)? Deliberately CONSERVATIVE: only a 404 /
 * UNREGISTERED or an explicit "registration token" message counts. A generic
 * 400 INVALID_ARGUMENT is NOT treated as a dead token — that can be a payload
 * bug, and treating it as dead would wrongly wipe every user's token. Pure +
 * unit-tested (see test/fcm.test.ts).
 */
export function isPermanentTokenError(status: number, body: string): boolean {
  if (status === 404) return true;
  const b = (body || '').toUpperCase();
  return (
    b.includes('UNREGISTERED') ||
    b.includes('REGISTRATION-TOKEN-NOT-REGISTERED') ||
    b.includes('INVALID-REGISTRATION-TOKEN') ||
    b.includes('NOT A VALID FCM REGISTRATION TOKEN')
  );
}

/** Transient FCM failures worth one retry (server/quota hiccups). */
function isTransientError(status: number): boolean {
  return status === 429 || status === 500 || status === 503;
}

export async function sendFCM(
  serviceAccountJson: string,
  message: FCMMessage
): Promise<{ success: boolean; error?: string; invalidToken?: boolean }> {
  try {
    const accessToken = await getAccessToken(serviceAccountJson);
    // One retry on a transient error (429/5xx) — FCM occasionally 503s under
    // load; a single short backoff recovers most of these without stalling the
    // request path.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(FCM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message }),
      });

      if (res.ok) return { success: true };

      const err = await res.text();
      if (isTransientError(res.status) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      console.error('[FCM] Send failed:', res.status, err);
      return { success: false, error: err, invalidToken: isPermanentTokenError(res.status, err) };
    }
    return { success: false, error: 'exhausted retries' };
  } catch (e: any) {
    console.error('[FCM] sendFCM error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Null out FCM tokens that FCM told us are permanently dead, so we never push
 * to them again. Best-effort; never throws.
 */
export async function pruneFcmTokens(db: D1Database, deadTokens: string[]): Promise<number> {
  const unique = Array.from(new Set(deadTokens.filter((t) => !!t)));
  if (unique.length === 0) return 0;
  try {
    const placeholders = unique.map(() => '?').join(',');
    const res = await db
      .prepare(`UPDATE users SET fcm_token = NULL WHERE fcm_token IN (${placeholders})`)
      .bind(...unique)
      .run();
    return Number(res.meta?.changes) || 0;
  } catch (e) {
    console.warn('[FCM] pruneFcmTokens failed:', e);
    return 0;
  }
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Dead tokens that were nulled out in D1 (only when `db` was supplied). */
  pruned?: number;
}

export async function sendFCMPush(
  serviceAccountJson: string | undefined,
  tokens: string | string[],
  title: string,
  body: string,
  data?: Record<string, string>,
  db?: D1Database,
): Promise<PushResult> {
  if (!serviceAccountJson) {
    console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT not configured');
    return { sent: 0, failed: 0 };
  }

  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const valid = tokenList.filter((t) => !!t && t.length > 10);
  if (valid.length === 0) return { sent: 0, failed: 0 };

  // Pre-warm the OAuth token once so the parallel sends below all reuse the
  // cached access token instead of each racing to mint a new one on a cold
  // isolate. A failure here means nothing can send — fail the whole batch.
  try {
    await getAccessToken(serviceAccountJson);
  } catch (e) {
    console.error('[FCM] access-token fetch failed; dropping push batch:', e);
    return { sent: 0, failed: valid.length };
  }

  const buildMsg = (token: string): FCMMessage => ({
    token,
    notification: { title, body },
    data: data ?? {},
    android: {
      priority: 'HIGH',
      notification: {
        channel_id: data?.type === 'incoming_call' ? 'calls' : 'default',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          // FIX BUG-11: content-available wakes the app in background for incoming calls.
          // Without this, iOS won't deliver data-only push to the app process,
          // so the host app never shows the incoming call screen when backgrounded.
          ...(data?.type === 'incoming_call' ? { 'content-available': 1 } : {}),
        },
      },
    },
    webpush: {
      notification: {
        icon: '/assets/images/icon.png',
        badge: '/assets/images/icon.png',
        requireInteraction: data?.type === 'incoming_call',
        vibrate: data?.type === 'incoming_call' ? [200, 100, 200, 100, 200] : [200],
      },
    },
  });

  // Send in parallel — independent per-token requests, so one slow/failed
  // device never blocks the others (previously fully sequential).
  const results = await Promise.all(
    valid.map(async (token) => ({ token, res: await sendFCM(serviceAccountJson, buildMsg(token)) })),
  );

  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];
  for (const { token, res } of results) {
    if (res.success) sent++;
    else {
      failed++;
      if (res.invalidToken) deadTokens.push(token);
    }
  }

  // Reliability: evict permanently-dead tokens so we stop wasting sends on them
  // (and stop inflating the failure count on every future notification).
  let pruned = 0;
  if (db && deadTokens.length > 0) {
    pruned = await pruneFcmTokens(db, deadTokens);
  }

  return { sent, failed, pruned };
}

// Fetch FCM tokens for a list of user IDs from D1
export async function getFCMTokens(
  db: D1Database,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => '?').join(',');
  const result = await db
    .prepare(
      `SELECT fcm_token FROM users WHERE id IN (${placeholders}) AND fcm_token IS NOT NULL AND fcm_token != ''`
    )
    .bind(...userIds)
    .all<{ fcm_token: string }>();
  const tokens = result.results.map((r) => r.fcm_token).filter((t) => !!t);
  // FIX #24: dedupe to avoid pushing the same notification multiple times when
  // the same fcm_token is shared across user rows (e.g. test/duplicate accounts
  // on one device). Set preserves first-seen order, which is good enough.
  return Array.from(new Set(tokens));
}
