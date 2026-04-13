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

export async function sendFCM(
  serviceAccountJson: string,
  message: FCMMessage
): Promise<{ success: boolean; error?: string }> {
  try {
    const accessToken = await getAccessToken(serviceAccountJson);
    const res = await fetch(FCM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[FCM] Send failed:', res.status, err);
      return { success: false, error: err };
    }

    return { success: true };
  } catch (e: any) {
    console.error('[FCM] sendFCM error:', e);
    return { success: false, error: e.message };
  }
}

export interface PushResult {
  sent: number;
  failed: number;
}

export async function sendFCMPush(
  serviceAccountJson: string | undefined,
  tokens: string | string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<PushResult> {
  if (!serviceAccountJson) {
    console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT not configured');
    return { sent: 0, failed: 0 };
  }

  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const valid = tokenList.filter((t) => !!t && t.length > 10);
  if (valid.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const token of valid) {
    const msg: FCMMessage = {
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
    };

    const result = await sendFCM(serviceAccountJson, msg);
    if (result.success) sent++;
    else failed++;
  }

  return { sent, failed };
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
  return result.results.map((r) => r.fcm_token).filter((t) => !!t);
}
