import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Platform, ActivityIndicator, Image, KeyboardAvoidingView,
} from "react-native";
import AppInput from "@/components/AppInput";
import { showErrorToast, showInfoToast } from "@/components/Toast";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { API } from "@/services/api";
import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";

const BG      = "#0A0B1E";
const ACCENT  = "#A00EE7";
const ACCENT2 = "#7B0FBF";
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "128169786412-amg5rqkn00omvk2c96rcgji6gh9eku00.apps.googleusercontent.com";

if (Platform.OS !== "web") {
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    offlineAccess: true,
  });
}

function isNetworkError(err: any) {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("network") || msg.includes("fetch") || msg.includes("connection") || msg.includes("timeout");
}

export default function HostLoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [gLoading, setGLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      showErrorToast(t.authToasts.loginMissing, t.authToasts.missingFields); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showErrorToast(t.authToasts.invalidEmailMsg, t.authToasts.invalidEmail); return;
    }
    setLoading(true);
    try {
      const data = await API.login(email.trim(), password);
      const u = data.user;
      await loginWithToken(data.token, {
        id: u.id, name: u.name, email: u.email,
        avatar: u.avatar_url, coins: u.coins ?? 0,
        role: u.role ?? "user", gender: u.gender,
        phone: u.phone, bio: u.bio,
      });
      router.replace(u.role === "host" ? "/(tabs)" : "/auth/status");
    } catch (err: any) {
      showErrorToast(err?.message || t.authToasts.loginFailedMsg, t.authToasts.loginFailed);
    } finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    setGLoading(true);
    try {
      if (Platform.OS === "web") {
        const { signInWithGoogleWeb } = await import("@/services/firebase");
        // Popup on desktop; auto-falls back to redirect on mobile web.
        const gu = await signInWithGoogleWeb();
        if (!gu) return; // redirecting…
        await handleGoogleProfileData(gu.uid, gu.name, gu.email, gu.photo, gu.idToken);
      } else {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const signInResult = await GoogleSignin.signIn();
        const googleUser = signInResult.data?.user;
        const idToken = signInResult.data?.idToken ?? null;
        if (!googleUser?.email) throw new Error(t.authToasts.googleNoAccount);
        // Backend requires a verifiable Google ID token; a null token means the
        // native OAuth config is incomplete (SHA-1 / google-services.json /
        // Web client ID). Fail clearly instead of sending a doomed request.
        if (!idToken) {
          throw new Error(t.authToasts.googleNoToken);
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
      setGLoading(false);
      if (isErrorWithCode(err)) {
        if (err.code === statusCodes.SIGN_IN_CANCELLED) return;
        if (err.code === statusCodes.IN_PROGRESS) return;
        if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          showErrorToast(t.authToasts.playServices, t.authToasts.notSupported); return;
        }
      }
      if (isNetworkError(err)) showErrorToast(t.authToasts.noInternet, t.authToasts.connectionError);
      else showErrorToast(err?.message || t.authToasts.googleFailed, t.authToasts.signInFailed);
    }
  };

  const handleGoogleProfileData = async (id: string, name: string, email: string, photo?: string | null, idToken?: string | null) => {
    try {
      const data = await API.googleLogin(email, name, id, photo ?? null, undefined, idToken);
      const u = data.user;
      await loginWithToken(data.token, {
        id: u.id, name: u.name, email: u.email,
        avatar: photo || u.avatar_url || undefined,
        coins: u.coins ?? 0, role: u.role ?? "user",
        gender: u.gender, phone: u.phone, bio: u.bio,
      });
      if (u.role === "host") router.replace("/(tabs)");
      else {
        showInfoToast(t.authToasts.googleWelcomeHost, t.authToasts.almostThere);
        router.replace("/auth/profile-setup");
      }
    } catch (err: any) {
      if (isNetworkError(err)) showErrorToast(t.authToasts.noInternet, t.authToasts.connectionError);
      else showErrorToast(err?.message || t.authToasts.signInFailedRetry, t.authToasts.signInFailed);
    } finally { setGLoading(false); }
  };

  // Complete a web Google sign-in that fell back to a full-page redirect.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    (async () => {
      try {
        const { getGoogleRedirectResult } = await import("@/services/firebase");
        const gu = await getGoogleRedirectResult();
        if (gu) {
          setGLoading(true);
          await handleGoogleProfileData(gu.uid, gu.name, gu.email, gu.photo, gu.idToken);
        }
      } catch { /* none / not configured */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top hero ── */}
        <View style={[s.hero, { paddingTop: insets.top + 28 }]}>
          <View style={s.logoWrap}>
            <Image
              source={require("@/assets/images/app_logo.png")}
              style={s.logoImg}
              resizeMode="contain"
            />
          </View>

          <Text style={s.brand}>VoxLink Host</Text>
          <Text style={s.tagline}>{t.loginScreen.tagline}</Text>

          <View style={s.chips}>
            {[
              { img: require("@/assets/icons/ic_secure.png"), label: t.loginScreen.chipKyc },
              { img: require("@/assets/icons/ic_coin.png"),   label: t.loginScreen.chipEarn },
              { img: require("@/assets/icons/ic_star.png"),   label: t.loginScreen.chipPlatform },
            ].map((c) => (
              <View key={c.label} style={s.chip}>
                <Image source={c.img} style={s.chipIcon} tintColor="rgba(200,130,255,0.9)" resizeMode="contain" />
                <Text style={s.chipTxt}>{c.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── White bottom card ── */}
        <View style={s.card}>
          <View style={s.handle} />

          <Text style={s.cardTitle}>{t.loginScreen.welcomeBack}</Text>
          <Text style={s.cardSub}>{t.loginScreen.subtitle}</Text>

          <View style={s.fields}>
            <AppInput
              icon={<Image source={require("@/assets/icons/ic_mail.png")} style={s.inputIcon} tintColor="#9B9FB8" resizeMode="contain" />}
              value={email}
              onChangeText={setEmail}
              placeholder={t.loginScreen.emailPlaceholder}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <AppInput
              icon={<Image source={require("@/assets/icons/ic_secure.png")} style={s.inputIcon} tintColor="#9B9FB8" resizeMode="contain" />}
              right={
                <TouchableOpacity onPress={() => setShowPw(!showPw)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Image
                    source={showPw ? require("@/assets/icons/ic_eye_off.png") : require("@/assets/icons/ic_eye.png")}
                    style={s.inputIcon}
                    tintColor="#9B9FB8"
                    resizeMode="contain"
                  />
                </TouchableOpacity>
              }
              value={password}
              onChangeText={setPassword}
              placeholder={t.loginScreen.passwordPlaceholder}
              secureTextEntry={!showPw}
            />
          </View>

          <TouchableOpacity
            onPress={() => router.push("/auth/forgot-password")}
            style={s.forgotRow}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={s.forgotTxt}>{t.auth.forgotPassword}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleLogin} activeOpacity={0.88} disabled={loading} style={s.signInBtnWrap}>
            <LinearGradient
              colors={[ACCENT, ACCENT2]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.signInBtn}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.signInTxt}>{t.loginScreen.signIn}</Text>}
            </LinearGradient>
          </TouchableOpacity>

          <View style={s.divRow}>
            <View style={s.divLine} />
            <Text style={s.divTxt}>{t.loginScreen.orContinue}</Text>
            <View style={s.divLine} />
          </View>

          <TouchableOpacity
            onPress={handleGoogleLogin}
            style={[s.googleBtn, gLoading && { opacity: 0.6 }]}
            activeOpacity={0.85}
            disabled={gLoading}
          >
            {gLoading
              ? <ActivityIndicator size="small" color="#555" />
              : <Image source={require("@/assets/icons/ic_google.png")} style={s.googleIcon} resizeMode="contain" />}
            <Text style={s.googleTxt}>{gLoading ? t.loginScreen.signingIn : t.loginScreen.continueGoogle}</Text>
          </TouchableOpacity>

          <View style={s.registerRow}>
            <Text style={s.registerTxt}>{t.loginScreen.newPrompt}</Text>
            <TouchableOpacity onPress={() => router.push("/auth/register")} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={s.registerLink}>{t.loginScreen.applyNow}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  hero: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 10,
  },
  logoWrap: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: "rgba(160,14,231,0.15)",
    borderWidth: 1.5, borderColor: "rgba(160,14,231,0.35)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 6,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5, shadowRadius: 20, elevation: 14,
  },
  logoImg: { width: 52, height: 52, borderRadius: 14 },
  brand: { fontSize: 28, fontFamily: "Poppins_700Bold", color: "#FFFFFF", letterSpacing: 0.2 },
  tagline: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.5)", textAlign: "center" },
  chips: { flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap", justifyContent: "center" },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(160,14,231,0.14)",
    borderWidth: 1, borderColor: "rgba(160,14,231,0.3)",
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  chipIcon: { width: 13, height: 13 },
  chipTxt: { fontSize: 11, fontFamily: "Poppins_500Medium", color: "rgba(210,160,255,0.95)" },

  card: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40,
    gap: 14, flex: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 20, elevation: 10,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E0E3F0", alignSelf: "center", marginBottom: 12 },
  cardTitle: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#0A0B1E" },
  cardSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: -6 },
  fields: { gap: 12 },
  inputIcon: { width: 18, height: 18 },
  forgotRow: { alignSelf: "flex-end", marginTop: -4 },
  forgotTxt: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: ACCENT },

  signInBtnWrap: {
    borderRadius: 16, overflow: "hidden",
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 8,
  },
  signInBtn: { paddingVertical: 16, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  signInTxt: { fontSize: 16, fontFamily: "Poppins_700Bold", color: "#fff", letterSpacing: 0.3 },

  divRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  divLine: { flex: 1, height: 1, backgroundColor: "#EDEEF4" },
  divTxt: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#A0A3B5" },

  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: "#E4E6F0", backgroundColor: "#FAFBFE",
  },
  googleIcon: { width: 22, height: 22 },
  googleTxt: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#2E3050" },

  registerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 4 },
  registerTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  registerLink: { fontSize: 14, fontFamily: "Poppins_700Bold", color: ACCENT },
});
