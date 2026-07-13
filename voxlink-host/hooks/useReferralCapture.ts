import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import {
  getPendingReferral, setPendingReferral, normalizeReferralCode, extractReferralFromUrl,
} from "@/utils/pendingReferral";

/**
 * Capture a referral code for host signup and keep it alive across the web
 * Google-OAuth full-page redirect. Sources, in priority order:
 *   1. The deep link / universal link the app was opened with
 *      (voxlinkhost://…?ref=CODE  or  https://voxlink.app/host?ref=CODE)
 *   2. A `?ref=` / `?referral=` query param on the web build
 *   3. A code persisted by a previous keystroke
 * Every change is persisted to storage so it survives the redirect, where
 * in-memory React state would otherwise be lost.
 *
 * Shared by the host login and register screens so both attribute referrals
 * identically. The caller reads `referralCode` and passes it to the auth API,
 * then clears it via clearPendingReferral() after a successful signup.
 */
export function useReferralCapture() {
  const [referralCode, setReferralCode] = useState("");
  const [showInput, setShowInput] = useState(false);

  const apply = useCallback((code: string) => {
    if (!code) return;
    setReferralCode(code);
    setShowInput(true);
    setPendingReferral(code);
  }, []);

  const onChange = useCallback((v: string) => {
    const norm = normalizeReferralCode(v);
    setReferralCode(norm);
    setPendingReferral(norm);
  }, []);

  useEffect(() => {
    (async () => {
      let code = "";
      try {
        code = extractReferralFromUrl(await Linking.getInitialURL());
      } catch { /* ignore */ }
      if (!code && Platform.OS === "web" && typeof window !== "undefined") {
        try {
          const p = new URLSearchParams(window.location.search);
          code = normalizeReferralCode(p.get("ref") || p.get("referral") || "");
        } catch { /* ignore */ }
      }
      if (!code) code = await getPendingReferral();
      if (code) apply(code);
    })();

    const sub = Linking.addEventListener("url", ({ url }) => {
      const code = extractReferralFromUrl(url);
      if (code) apply(code);
    });
    return () => sub.remove();
  }, [apply]);

  return { referralCode, showInput, setShowInput, onChange };
}
