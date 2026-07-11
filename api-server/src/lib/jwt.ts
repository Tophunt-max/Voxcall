import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from '../types';

// Pin the signing algorithm everywhere. HS256 is symmetric, so `jose` would
// already reject `alg: none` and asymmetric algs with a symmetric key, but
// pinning explicitly removes any room for algorithm-confusion / downgrade
// attacks and keeps sign + verify in lockstep.
export const JWT_ALG = 'HS256' as const;

// Fail loudly if the auth secret is missing or trivially weak instead of
// silently signing/verifying with an empty (`""`) or too-short HMAC key, which
// would be brute-forceable. 32 bytes matches the value recommended in
// .dev.vars.example. Throwing here surfaces as a 401 on verify (access denied,
// safe) and a 500 on sign (login refused) — both preferable to a forgeable
// token. The check is cheap and runs per call in the Workers runtime.
function encodeSecret(secret: string | undefined | null): Uint8Array {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('JWT_SECRET is missing or too short (min 32 chars). Refusing to use a weak signing key.');
  }
  return new TextEncoder().encode(secret);
}

// JWT TTL: tokens are valid for 7 days. The earlier 2-day default forced
// the auto-refresh path to fire ~every 2 days for active users, which
// produces unnecessary `/api/auth/refresh` traffic and one extra round-trip
// on a cold-start launch every 48 hours. 7 days is the typical mobile-app
// default. Server-side revocation is still instant via the
// `users.token_invalidated_at` check (FIX #12) — we do NOT depend on the
// signing TTL to kick a banned/logged-out user, so lengthening it does not
// weaken the security model. The 30-day refresh ceiling enforced by
// `/api/auth/refresh` (FIX #18) still bounds total session lifetime.
export async function signToken(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresIn = '7d'
): Promise<string> {
  const key = encodeSecret(secret);
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload> {
  const key = encodeSecret(secret);
  // Pin the accepted algorithm so a token cannot be verified under any alg
  // other than the one we sign with.
  const { payload } = await jwtVerify(token, key, { algorithms: [JWT_ALG] });
  return payload as unknown as JWTPayload;
}

export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
