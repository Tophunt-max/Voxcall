// ============================================================================
// Signed media URLs — privacy gate for PRIVATE R2 objects
// ============================================================================
//
// Public objects (avatars, banners, host gallery) are served openly by
// GET /api/files/:key. But some objects are PRIVATE:
//   • chat-media/…  — media sent inside a 1:1 chat
//   • kyc/…         — Aadhaar / identity documents
// These must not be readable just by guessing the (predictable) key. Instead
// the serve route requires a short-lived HMAC signature that only the server
// can mint, and only mints it for authorised readers:
//   • chat media → the chat history/send endpoints (room participants only)
//   • KYC docs   → the admin host-application endpoints (admins only)
//
// The signature is HMAC-SHA256(secret, "voxmedia:v1:<key>:<exp>"), compared in
// constant time. `secret` is the Worker's JWT_SECRET (domain-separated by the
// prefix so a media signature can never collide with a JWT use). Every verifier
// fails CLOSED — any malformed / missing / expired input returns false.
// ============================================================================

import { hmacSha256Hex } from './gatewayVerify';
import { timingSafeEqual } from './hash';

const PREFIX = 'voxmedia:v1:';

/** Prefixes whose objects require a valid signature to be served. */
export const PRIVATE_PREFIXES = ['chat-media/', 'kyc/'] as const;

export function isPrivateKey(key: string): boolean {
  return PRIVATE_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Pull the storage key out of a stored media reference, which may be an
 * absolute URL (`https://host/api/files/<key>?…`), a relative path
 * (`/api/files/<key>`), or already a bare key (`chat-media/…`). Query/hash are
 * stripped. Returns null if it isn't a recognisable file reference.
 */
export function extractFileKey(urlOrKey: string | null | undefined): string | null {
  if (!urlOrKey) return null;
  const noQuery = String(urlOrKey).split(/[?#]/)[0];
  const m = noQuery.match(/\/api\/files\/(.+)$/);
  if (m) return m[1];
  // Bare key (not a URL, no leading slash).
  if (!/^https?:\/\//i.test(noQuery) && !noQuery.startsWith('/')) return noQuery;
  return null;
}

/** Mint an { exp, sig } pair for a key. */
export async function signMediaKey(
  key: string,
  secret: string,
  ttlSec: number,
  now: number = Math.floor(Date.now() / 1000),
): Promise<{ exp: number; sig: string }> {
  const exp = now + Math.max(1, Math.floor(ttlSec));
  const sig = await hmacSha256Hex(secret, `${PREFIX}${key}:${exp}`);
  return { exp, sig };
}

/** Build a signed RELATIVE file URL: `/api/files/<key>?exp=…&sig=…`. */
export async function signedFileUrl(
  key: string,
  secret: string,
  ttlSec: number,
  now?: number,
): Promise<string> {
  const { exp, sig } = await signMediaKey(key, secret, ttlSec, now);
  return `/api/files/${key}?exp=${exp}&sig=${sig}`;
}

/**
 * Re-sign a stored media reference so a client gets a fresh, valid signed URL.
 * Only PRIVATE keys are signed; a public or unrecognised reference is returned
 * unchanged (so this is safe to run over mixed/legacy data).
 */
export async function resignIfPrivate(
  urlOrKey: string | null | undefined,
  secret: string,
  ttlSec: number,
  now?: number,
): Promise<string | null | undefined> {
  const key = extractFileKey(urlOrKey);
  if (!key || !isPrivateKey(key)) return urlOrKey ?? null;
  return signedFileUrl(key, secret, ttlSec, now);
}

/**
 * Verify a key's signature. Constant-time; fails closed on any bad/missing/
 * expired input.
 */
export async function verifyMediaSig(
  key: string,
  exp: string | number | null | undefined,
  sig: string | null | undefined,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (exp === null || exp === undefined || !sig) return false;
  const expNum = typeof exp === 'number' ? exp : parseInt(String(exp), 10);
  if (!Number.isFinite(expNum) || expNum < now) return false;
  const expected = await hmacSha256Hex(secret, `${PREFIX}${key}:${expNum}`);
  return timingSafeEqual(expected, String(sig).toLowerCase());
}
