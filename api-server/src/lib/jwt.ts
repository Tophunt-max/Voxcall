import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from '../types';

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
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return payload as unknown as JWTPayload;
}

export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
