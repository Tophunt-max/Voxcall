// Robust web Google sign-in.
//
// `signInWithPopup` is unreliable on MOBILE web browsers (popups get blocked,
// and Cross-Origin-Opener-Policy can break the popup<->opener handshake), which
// is the most common reason "Google sign-in does nothing" on a phone. So we try
// the popup first and, when the environment can't do popups, fall back to
// `signInWithRedirect`. The redirect result is picked up on the next load via
// `getGoogleRedirectResult()`.

import { auth } from "./firebase";

export interface GoogleWebUser {
  uid: string;
  name: string;
  email: string;
  photo: string | null;
  idToken: string;
}

async function toUser(user: any): Promise<GoogleWebUser> {
  const idToken = await user.getIdToken();
  return {
    uid: user.uid,
    name: user.displayName || "User",
    email: user.email || "",
    photo: user.photoURL ?? null,
    idToken,
  };
}

/**
 * Start web Google sign-in. Returns the signed-in user on the popup path, or
 * `null` when it fell back to a full-page redirect (the page will navigate away
 * and the result is delivered via getGoogleRedirectResult on return).
 * Throws `{ code: "auth/not-configured" }` if Firebase isn't set up.
 */
export async function signInWithGoogleWeb(): Promise<GoogleWebUser | null> {
  if (!auth) throw { code: "auth/not-configured" };
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    return await toUser(result.user);
  } catch (err: any) {
    const code = String(err?.code || "");
    // Popups unavailable/blocked (typical on mobile web) → redirect instead.
    if (
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment" ||
      code === "auth/cancelled-popup-request"
    ) {
      await signInWithRedirect(auth, provider);
      return null; // page navigates; result handled on return
    }
    throw err;
  }
}

/** Call on mount: returns the redirected Google user, or null if none. */
export async function getGoogleRedirectResult(): Promise<GoogleWebUser | null> {
  if (!auth) return null;
  const { getRedirectResult } = await import("firebase/auth");
  const result = await getRedirectResult(auth);
  if (result?.user) return await toUser(result.user);
  return null;
}
