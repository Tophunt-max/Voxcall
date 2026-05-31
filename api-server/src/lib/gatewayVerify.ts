// ============================================================================
// Payment gateway signature / checksum verification
// ============================================================================
//
// Each gateway signs its webhook differently. Getting this wrong on a money
// path is worse than failing closed, so every verifier here:
//   • uses a CONSTANT-TIME comparison for the final equality check, and
//   • returns `false` (never throws) on any malformed input.
//
// IMPORTANT (operational): the exact callback body format and signing scheme
// depends on the merchant's integration *version* with each provider. The
// algorithms below match the providers' published specs (PhonePe X-VERIFY /
// Standard-Checkout Authorization, Paytm AES-128-CBC checksum). Validate
// against each provider's SANDBOX with real credentials before enabling the
// gateway in production.
// ============================================================================

import { timingSafeEqual } from './hash';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Lowercase hex HMAC-SHA256. */
export async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Razorpay ────────────────────────────────────────────────────────────────
// Webhook signature = hex HMAC-SHA256(rawBody) using the webhook secret.
export async function verifyRazorpaySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqual(expected, signatureHeader.trim());
}

// ─── Stripe ───────────────────────────────────────────────────────────────────
// Stripe-Signature header: `t=<ts>,v1=<hexHmac>`. Signed payload = `${t}.${body}`.
// Rejects timestamps older than `toleranceSec` (replay protection) or implausibly
// far in the future.
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts: Record<string, string> = {};
  signatureHeader.split(',').forEach((p) => {
    const idx = p.indexOf('=');
    if (idx > 0) parts[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
  });
  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return false;
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  const age = nowSec - ts;
  if (age > toleranceSec || age < -10) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(expected, v1);
}

// ─── PhonePe ───────────────────────────────────────────────────────────────────
// Two supported schemes (depends on integration version):
//
// 1. Legacy S2S callback / X-VERIFY:
//      header `X-VERIFY: <sha256(base64Response + saltKey)>###<saltIndex>`
//    where the request body is `{ "response": "<base64>" }`.
//
// 2. Standard Checkout webhook:
//      header `Authorization: <sha256(username:password)>`
//    where username/password were configured when registering the webhook.

/** Scheme 1 — X-VERIFY over the base64 `response` string. */
export async function verifyPhonePeXVerify(
  base64Response: string,
  xVerifyHeader: string,
  saltKey: string,
): Promise<boolean> {
  if (!xVerifyHeader || !base64Response) return false;
  const hashPart = xVerifyHeader.split('###')[0]?.trim();
  if (!hashPart) return false;
  const expected = await sha256Hex(base64Response + saltKey);
  return timingSafeEqual(expected, hashPart.toLowerCase());
}

/** Scheme 2 — Standard Checkout `Authorization` header = sha256(user:pass). */
export async function verifyPhonePeAuthorization(
  authHeader: string,
  username: string,
  password: string,
): Promise<boolean> {
  if (!authHeader || !username || !password) return false;
  const expected = await sha256Hex(`${username}:${password}`);
  // Header may arrive as bare hex or prefixed; normalise to the trailing hex token.
  const token = authHeader.trim().split(/\s+/).pop() ?? '';
  return timingSafeEqual(expected, token.toLowerCase());
}

// ─── Paytm ─────────────────────────────────────────────────────────────────────
// CHECKSUMHASH = base64( AES-128-CBC( sha256(paramString + "|" + salt) + salt ) )
// with the static IV "@@@@&&&&####$$$$" and the 16-byte merchant key.
// paramString = values of all params (except CHECKSUMHASH), sorted by key,
// joined by "|", with null/"null" rendered as empty.
const PAYTM_IV = '@@@@&&&&####$$$$';

export function paytmParamString(params: Record<string, any>): string {
  return Object.keys(params)
    .filter((k) => k !== 'CHECKSUMHASH')
    .sort()
    .map((k) => {
      const v = params[k];
      return v !== null && v !== undefined && String(v).toLowerCase() !== 'null' ? String(v) : '';
    })
    .join('|');
}

async function paytmAesDecrypt(b64cipher: string, key: string): Promise<string> {
  const keyBytes = enc.encode(key);
  if (keyBytes.length !== 16) {
    // AES-128 requires a 16-byte key; Paytm merchant keys are 16 chars.
    throw new Error('Paytm merchant key must be 16 bytes for AES-128-CBC');
  }
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, [
    'decrypt',
  ]);
  const cipherBytes = Uint8Array.from(atob(b64cipher), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: enc.encode(PAYTM_IV) },
    cryptoKey,
    cipherBytes,
  );
  return dec.decode(new Uint8Array(plain));
}

export async function verifyPaytmChecksum(
  params: Record<string, any>,
  merchantKey: string,
  checksum: string,
): Promise<boolean> {
  if (!checksum || !merchantKey) return false;
  try {
    const decrypted = await paytmAesDecrypt(checksum, merchantKey);
    if (decrypted.length < 4) return false;
    const salt = decrypted.slice(-4);
    const dataString = `${paytmParamString(params)}|${salt}`;
    const expected = (await sha256Hex(dataString)) + salt;
    return timingSafeEqual(expected, decrypted);
  } catch {
    return false;
  }
}
