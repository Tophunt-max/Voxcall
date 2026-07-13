import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";

// A referral code the new user entered on the login screen (or that arrived via
// a `?ref=` query on web). Persisted so it survives the full-page Google OAuth
// redirect on web, where in-memory React state is lost. Consumed by the
// google-login / quick-login calls and cleared once a brand-new account is
// created. The backend only ever attributes it to a genuinely NEW account, so
// leaving a stale value around is harmless.
const PENDING_REFERRAL_KEY = "@voxlink_pending_referral";

/** Normalize a raw code: trim + uppercase, cap length, allow only sane chars. */
export function normalizeReferralCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 40);
}

export async function setPendingReferral(code: string | null | undefined): Promise<void> {
  try {
    const norm = normalizeReferralCode(code);
    if (norm) await AsyncStorage.setItem(PENDING_REFERRAL_KEY, norm);
    else await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    /* best-effort */
  }
}

export async function getPendingReferral(): Promise<string> {
  try {
    return normalizeReferralCode(await AsyncStorage.getItem(PENDING_REFERRAL_KEY));
  } catch {
    return "";
  }
}

export async function clearPendingReferral(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Pull a referral code out of a deep link / universal link, e.g.
 *   voxlink://open?ref=ABC123   or   https://voxlink.app/?ref=ABC123
 * Accepts both `ref` and `referral` query params. Returns "" when absent.
 */
export function extractReferralFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const { queryParams } = Linking.parse(url);
    const raw = queryParams?.ref ?? queryParams?.referral;
    return normalizeReferralCode(Array.isArray(raw) ? raw[0] : (raw as string | undefined));
  } catch {
    return "";
  }
}

/** Build the shareable invite link that carries a referral code. */
export function buildInviteUrl(code: string): string {
  const norm = normalizeReferralCode(code);
  return `https://voxlink.app/?ref=${encodeURIComponent(norm)}`;
}
