import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Platform, TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Application from "expo-application";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { API, resolveMediaUrl } from "@/services/api";
import { getRandomAvatarUri } from "@/utils/randomAvatar";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import {
  getPendingReferral, setPendingReferral, clearPendingReferral, normalizeReferralCode,
} from "@/utils/pendingReferral";

const ACCENT = "#A00EE7";
const DEVICE_ID_KEY = "@voxlink_device_id";

const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  "128169786412-amg5rqkn00omvk2c96rcgji6gh9eku00.apps.googleusercontent.com";

if (Platform.OS !== "web") {
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    offlineAccess: true,
  });
}

async function getDeviceId(): Promise<string> {
  try {
    if (Platform.OS === "android") {
      const androidId = Application.getAndroidId();
      if (androidId) return `android_${androidId}`;
    } else if (Platform.OS === "ios") {
      const vendorId = await Application.getIosIdForVendorAsync();
      if (vendorId) return `ios_${vendorId}`;
    }
  } catch {}

  // Web: persist the device id in localStorage DIRECTLY. AsyncStorage-on-web
  // proved unreliable here (the stored id wasn't read back after sign-out →
  // a fresh id was generated → Quick Login kept creating NEW guest accounts
  // instead of returning the same device's account). localStorage is
  // synchronous and survives sign-out (logout only clears the auth token/user).
  if (Platform.OS === "web") {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        let id = window.localStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
          id = `dev_${Math.random().toString(36).slice(2)}_${Date.now()}`;
          window.localStorage.setItem(DEVICE_ID_KEY, id);
        }
        // Mirror into AsyncStorage too (best-effort) for any other reader.
        AsyncStorage.setItem(DEVICE_ID_KEY, id).catch(() => {});
        return id;
      }
    } catch { /* fall through to AsyncStorage */ }
  }

  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const generated = `dev_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}

function isNetworkError(err: any): boolean {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("network") || msg.includes("fetch") || msg.includes("connection") || msg.includes("timeout");
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const { t } = useLanguage();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [showReferral, setShowReferral] = useState(false);

  // Restore a referral code across mounts / the web Google-OAuth redirect.
  // Priority: a `?ref=` (or `?referral=`) query param on web, else the value
  // persisted by a previous keystroke. Persisting is what keeps the code alive
  // through the full-page redirect, where React state would otherwise be lost.
  useEffect(() => {
    (async () => {
      let code = "";
      if (Platform.OS === "web" && typeof window !== "undefined") {
        try {
          const p = new URLSearchParams(window.location.search);
          code = normalizeReferralCode(p.get("ref") || p.get("referral") || "");
        } catch { /* ignore */ }
      }
      if (!code) code = await getPendingReferral();
      if (code) {
        setReferralCode(code);
        setShowReferral(true);
        await setPendingReferral(code);
      }
    })();
  }, []);

  const onChangeReferral = (v: string) => {
    const norm = normalizeReferralCode(v);
    setReferralCode(norm);
    // Persist every keystroke so the code survives the web OAuth redirect.
    setPendingReferral(norm);
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      if (Platform.OS === "web") {
        const { signInWithGoogleWeb } = await import("@/services/firebase");
        // Popup on desktop; auto-falls back to redirect on mobile web where
        // popups are blocked. Returns null when a redirect was started (the
        // result is handled by the getGoogleRedirectResult effect on return).
        const gu = await signInWithGoogleWeb();
        if (!gu) return; // redirecting…
        await handleGoogleProfileData(gu.uid, gu.name, gu.email, gu.photo, gu.idToken);
      } else {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const signInResult = await GoogleSignin.signIn();
        const googleUser = signInResult.data?.user;
        const idToken = signInResult.data?.idToken ?? null;
        if (!googleUser?.email) throw new Error("Could not retrieve Google account info.");
        // The backend requires a verifiable Google ID token. If the native SDK
        // returns no idToken, the OAuth config is incomplete (e.g. the build's
        // SHA-1 isn't registered for the Web client ID, or google-services.json
        // is missing) — fail with a clear message instead of a cryptic 400.
        if (!idToken) {
          throw new Error("Google sign-in did not return a token. Please update the app or try again.");
        }
        await handleGoogleProfileData(
          googleUser.id,
          googleUser.name || "User",
          googleUser.email,
          googleUser.photo ?? null,
          idToken,
        );
      }
    } catch (err: any) {
      setGoogleLoading(false);
      if (isErrorWithCode(err)) {
        if (err.code === statusCodes.SIGN_IN_CANCELLED) return;
        if (err.code === statusCodes.IN_PROGRESS) return;
        if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          showErrorToast("Google Play Services not available.", "Not Supported");
          return;
        }
      }
      if (isNetworkError(err)) {
        showErrorToast("No internet connection. Please check your network.", "Connection Error");
        return;
      }
      // Firebase web auth error codes — give actionable messages.
      const code = String(err?.code || "");
      if (code === "auth/not-configured") {
        showErrorToast("Google sign-in isn't set up on this site yet. Please use Quick Login.", "Sign-In Unavailable");
        return;
      }
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return; // user dismissed
      if (code === "auth/popup-blocked") {
        showErrorToast("Your browser blocked the sign-in popup. Allow popups for this site and try again.", "Popup Blocked");
        return;
      }
      if (code === "auth/unauthorized-domain") {
        showErrorToast("This domain isn't authorized for Google sign-in yet. Use Quick Login, or ask support to add it in Firebase.", "Sign-In Unavailable");
        return;
      }
      if (code === "auth/invalid-api-key" || code === "auth/api-key-not-valid" || code.includes("api-key")) {
        showErrorToast("Google sign-in isn't configured on this site yet. Please use Quick Login.", "Sign-In Unavailable");
        return;
      }
      showErrorToast(err?.message || "Google sign-in failed", "Sign In Failed");
    }
  };

  const handleGoogleProfileData = async (
    id: string, name: string, email: string, photo?: string | null, idToken?: string | null
  ) => {
    try {
      const deviceId = await getDeviceId();
      // Read the referral code from storage (survives the web OAuth redirect,
      // where React state is lost). The backend only attributes it to a
      // brand-new account, so passing it on a returning login is a harmless no-op.
      const ref = (await getPendingReferral()) || referralCode || null;
      const data = await API.googleLogin(email, name, id, photo ?? null, deviceId, idToken, ref);
      await clearPendingReferral();
      const profile = {
        id: data.user.id || id,
        name: data.user.name || name,
        email: data.user.email || email,
        // FIX: UserProfile.avatar is `string | undefined`, not `string | null`.
        // Coalesce null → undefined so type-safe consumers don't get a null leak.
        avatar: photo || resolveMediaUrl(data.user.avatar_url) || undefined,
        coins: data.user.coins ?? 50,
        role: "user" as const,
      };
      await loginWithToken(data.token, profile);
      showSuccessToast(t.auth.welcomeName.replace("{name}", profile.name));
      router.replace("/user/screens/home");
    } catch (err: any) {
      if (isNetworkError(err)) {
        showErrorToast("No internet connection. Please check your network.", "Connection Error");
      } else {
        showErrorToast(err?.message || "Sign-in failed. Please try again.", "Sign In Failed");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  // On web, complete a Google sign-in that fell back to a full-page redirect
  // (mobile browsers where the popup was blocked). Runs once on mount.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    (async () => {
      try {
        const { getGoogleRedirectResult } = await import("@/services/firebase");
        const gu = await getGoogleRedirectResult();
        if (gu) {
          setGoogleLoading(true);
          await handleGoogleProfileData(gu.uid, gu.name, gu.email, gu.photo, gu.idToken);
        }
      } catch {
        /* no pending redirect / not configured — ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuickLogin = async () => {
    setQuickLoading(true);
    try {
      const deviceId = await getDeviceId();
      const ref = (await getPendingReferral()) || referralCode || null;
      const data = await API.quickLogin(deviceId, ref);
      await clearPendingReferral();
      const avatarKey = resolveMediaUrl(data.user.avatar_url) || getRandomAvatarUri();
      const profile = {
        id: data.user.id,
        name: data.user.name || "VoxLink User",
        email: data.user.email || "",
        avatar: avatarKey,
        coins: data.user.coins ?? 50,
        role: "user" as const,
        is_guest: true,
      };
      await loginWithToken(data.token, profile);
      if (data.is_returning) {
        showSuccessToast(t.auth.welcomeBackToast, t.auth.quickLoginTitle);
      } else {
        showSuccessToast(t.auth.accountCreated, t.auth.welcomeTitle);
      }
      router.replace("/user/screens/home");
    } catch (err: any) {
      if (isNetworkError(err)) {
        showErrorToast(t.auth.connectionError, t.auth.connectionErrorTitle);
      } else {
        showErrorToast(t.auth.quickLoginFailed);
      }
    } finally {
      setQuickLoading(false);
    }
  };

  const isLoading = googleLoading || quickLoading;

  return (
    <View style={{ flex: 1, backgroundColor: "#F9F5FF" }}>
      <LinearGradient
        colors={["#A00EE7", "#6A00B8"]}
        style={[s.headerGradient, { paddingTop: insets.top + 16 }]}
      >
        <View style={s.logoWrap}>
          <Image
            source={require("@/assets/images/app_logo.png")}
            style={s.logo}
            resizeMode="contain"
          />
        </View>
        <Text style={s.appName}>VoxLink</Text>
        <Text style={s.tagline}>{t.auth.tagline}</Text>
      </LinearGradient>

      <View style={[s.card, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={s.welcomeTitle}>{t.auth.welcomeToVoxLink}</Text>
        <Text style={s.welcomeSub}>{t.auth.autoCreateAccount}</Text>

        <TouchableOpacity
          style={[s.googleBtn, isLoading && s.btnDisabled]}
          onPress={handleGoogleLogin}
          activeOpacity={0.85}
          disabled={isLoading}
        >
          {googleLoading ? (
            <ActivityIndicator color={ACCENT} size="small" />
          ) : (
            <Image
              source={require("@/assets/icons/ic_google.png")}
              style={s.googleIco}
              resizeMode="contain"
            />
          )}
          <Text style={s.googleTxt}>
            {googleLoading ? t.auth.signingIn : t.auth.continueWithGoogle}
          </Text>
        </TouchableOpacity>

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>{t.auth.or}</Text>
          <View style={s.divLine} />
        </View>

        <TouchableOpacity
          style={[s.quickBtn, isLoading && s.btnDisabled]}
          onPress={handleQuickLogin}
          activeOpacity={0.75}
          disabled={isLoading}
        >
          {quickLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Image
              source={require("@/assets/icons/ic_quick_login.png")}
              style={s.quickIco}
              resizeMode="contain"
            />
          )}
          <Text style={s.quickTxt}>
            {quickLoading ? t.auth.pleaseWait : t.auth.quickLogin}
          </Text>
        </TouchableOpacity>

        {showReferral ? (
          <View style={s.referralWrap}>
            <TextInput
              value={referralCode}
              onChangeText={onChangeReferral}
              placeholder="Enter referral code"
              placeholderTextColor="#84889F"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
              editable={!isLoading}
              style={s.referralInput}
            />
            <Text style={s.referralHint}>Your friend&apos;s code — apply it before you sign up.</Text>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setShowReferral(true)} disabled={isLoading} activeOpacity={0.7}>
            <Text style={s.referralToggle}>Have a referral code?</Text>
          </TouchableOpacity>
        )}

        <Text style={s.noteText}>
          {t.auth.quickLoginNote}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  headerGradient: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    marginTop: 8,
  },
  logo: { width: 56, height: 56 },
  appName: {
    fontSize: 28,
    fontFamily: "Poppins_700Bold",
    color: "#fff",
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Poppins_400Regular",
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -24,
    paddingHorizontal: 28,
    paddingTop: 32,
    gap: 14,
  },
  welcomeTitle: {
    fontSize: 22,
    fontFamily: "Poppins_700Bold",
    color: "#111329",
    textAlign: "center",
  },
  welcomeSub: {
    fontSize: 13,
    fontFamily: "Poppins_400Regular",
    color: "#84889F",
    textAlign: "center",
    marginBottom: 6,
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E8EAF0",
    backgroundColor: "#fff",
  },
  googleIco: { width: 22, height: 22 },
  googleTxt: {
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
    color: "#111329",
  },
  divRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  divLine: { flex: 1, height: 1, backgroundColor: "#E8EAF0" },
  divTxt: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "#84889F",
  },
  quickBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: ACCENT,
  },
  quickIco: {
    width: 22,
    height: 22,
    tintColor: "#fff",
  },
  quickTxt: {
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
    color: "#fff",
  },
  btnDisabled: { opacity: 0.65 },
  referralToggle: {
    fontSize: 13,
    fontFamily: "Poppins_600SemiBold",
    color: ACCENT,
    textAlign: "center",
    marginTop: 2,
  },
  referralWrap: { gap: 6, marginTop: 2 },
  referralInput: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E8EAF0",
    backgroundColor: "#fff",
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
    color: "#111329",
    letterSpacing: 1,
  },
  referralHint: {
    fontSize: 11,
    fontFamily: "Poppins_400Regular",
    color: "#84889F",
    textAlign: "center",
  },
  noteText: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "#84889F",
    textAlign: "center",
    marginTop: -4,
    lineHeight: 18,
  },
});
