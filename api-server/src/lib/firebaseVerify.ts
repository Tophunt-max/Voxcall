// Firebase ID token verifier.
//
// Firebase JWTs (the kind returned by Firebase Web SDK's `user.getIdToken()`)
// are signed by Google's `securetoken@system.gserviceaccount.com` service
// account, NOT by the OAuth/OIDC service. So Google's `tokeninfo` endpoint
// rejects them with "Invalid Google ID token".
//
// The JWKS for those signing keys is published at the URL below. We verify
// signature, issuer, and audience against the project ID encoded in the
// token's own `iss` claim — and if FIREBASE_SERVICE_ACCOUNT is configured
// we also enforce that the project matches our own (preventing tokens
// minted by a different Firebase project from logging into our backend).

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export interface FirebaseIdTokenClaims extends JWTPayload {
  sub: string;          // Firebase user UID
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  user_id?: string;     // some Firebase tokens use user_id instead of sub
  firebase?: { sign_in_provider?: string; identities?: Record<string, unknown> };
}

export async function verifyFirebaseIdToken(
  token: string,
  expectedProjectId: string
): Promise<FirebaseIdTokenClaims> {
  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${expectedProjectId}`,
    audience: expectedProjectId,
  });
  // jose checks signature, exp, nbf, iat, iss, aud — but NOT sub presence.
  if (!payload.sub && typeof (payload as any).user_id !== 'string') {
    throw new Error('Firebase ID token missing subject');
  }
  return payload as FirebaseIdTokenClaims;
}

// Pull the project_id out of FIREBASE_SERVICE_ACCOUNT JSON without needing
// to parse the whole credential. Returns null if the env var is missing or
// malformed — caller can decide whether that's fatal.
export function projectIdFromServiceAccount(serviceAccountJson: string | undefined): string | null {
  if (!serviceAccountJson) return null;
  try {
    const sa = JSON.parse(serviceAccountJson);
    return typeof sa.project_id === 'string' ? sa.project_id : null;
  } catch {
    return null;
  }
}

// Decode a JWT *without* verifying it, returning just the parsed payload.
// Used to peek at the issuer claim so we can route the token to the right
// verification path. Never trust these claims for authentication — they
// are only valid after the corresponding verifier accepts the token.
export function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const json = atob(padded + '='.repeat(padLen));
    return JSON.parse(json);
  } catch {
    return null;
  }
}
