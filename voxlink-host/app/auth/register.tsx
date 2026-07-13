import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Platform, ActivityIndicator, Image, KeyboardAvoidingView,
} from "react-native";
import AppInput from "@/components/AppInput";
import { showErrorToast, showInfoToast, showWarningToast } from "@/components/Toast";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { PrimaryButton } from "@/components/PrimaryButton";
import { API } from "@/services/api";
import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";
import { useReferralCapture } from "@/hooks/useReferralCapture";
import { getPendingReferral, clearPendingReferral } from "@/utils/pendingReferral";

const BG     = "#0A0B1E";
const ACCENT = "#A00EE7";
const DARK   = "#111329";
const STEPS  = ["Account", "Profile", "Host Info", "KYC Docs"];
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

export default function HostRegisterScreen() {
  const insets = useSafeAreaInsets();
  const { user, isLoggedIn, loginWithToken } = useAuth();
  const { t } = useLanguage();
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const { referralCode, showInput, setShowInput, onChange } = useReferralCapture();

  useEffect(() => {
    if (isLoggedIn && user)
      router.replace(user.role === "host" ? "/(tabs)" : "/auth/profile-setup");
  }, [isLoggedIn]);

  const handleNext = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      showErrorToast(t.authToasts.registerMissing, t.authToasts.missingFields); return;
    }
    if (password.length < 8) {
      showWarningToast(t.authToasts.weakPasswordMsg, t.authToasts.weakPassword); return;
    }
    setLoading(true);
    try {
      const ref = (await getPendingReferral()) || referralCode || undefined;
      const data = await API.register(name.trim(), email.trim(), password, undefined, undefined, ref || undefined);
      await clearPendingReferral();
      await loginWithToken(data.token, {
        id: data.user.id, name: data.user.name, email: data.user.email,
        coins: data.user.coins ?? 0, role: data.user.role ?? "user",
      });
      if (data.signup_incomplete) {
        showInfoToast(t.authToasts.resuming, t.authToasts.welcomeBack);
      }
      router.push("/auth/profile-setup");
    } catch (err: any) {
      const msg: string = err?.message || "";
      if (msg.toLowerCase().includes("already registered")) {
        showErrorToast(t.authToasts.alreadyRegisteredMsg, t.authToasts.alreadyRegisteredTitle);
      } else {
        showErrorToast(msg || t.authToasts.createFailed);
      }
    } finally { setLoading(false); }
  };

  const handleGoogleRegister = async () => {
    setGLoading(true);
    try {
      if (Platform.OS === "web") {
        const { signInWithGoogleWeb } = await import("@/services/firebase");
        const gu = await signInWithGoogleWeb();
        if (!gu) return; // redirecting…
        await handleGoogleProfileData(gu.uid, gu.name, gu.email, gu.photo, gu.idToken);
      } else {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const signInResult = await GoogleSignin.signIn();
        const googleUser = signInResult.data?.user;
        const idToken = signInResult.data?.idToken ?? null;
        if (!googleUser?.email) throw new Error(t.authToasts.googleNoAccount);
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
      const ref = (await getPendingReferral()) || referralCode || null;
      const data = await API.googleLogin(email, name, id, photo ?? null, undefined, idToken, ref);
      await clearPendingReferral();
      const u = data.user;
      await loginWithToken(data.token, {
        id: u.id, name: u.name, email: u.email,
        avatar: photo || u.avatar_url || undefined,
        coins: u.coins ?? 0, role: u.role ?? "user",
      });
      if (u.role === "host") router.replace("/(tabs)");
      else { showInfoToast(t.authToasts.googleWelcomeProfile, t.authToasts.almostThere); router.replace("/auth/profile-setup"); }
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
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* ── Dark gradient header ── */}
      <LinearGradient colors={[BG, "#1A1C3A"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={s.backBtn} activeOpacity={0.8}>
          <Image source={require("@/assets/icons/ic_back.png")} style={s.backIcon} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Image source={require("@/assets/images/app_logo.png")} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>{t.registerScreen.title}</Text>
          <Text style={s.headerSub}>{t.registerScreen.headerSub}</Text>
        </View>

        <View style={s.steps}>
          {[t.registerScreen.stepAccount, t.registerScreen.stepProfile, t.registerScreen.stepHostInfo, t.registerScreen.stepKyc].map((step, i) => (
            <View key={STEPS[i]} style={s.stepItem}>
              <LinearGradient
                colors={i === 0 ? [ACCENT, "#6A00B8"] : ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.12)"]}
                style={s.stepCircle}
              >
                <Text style={[s.stepNum, i === 0 && s.stepNumActive]}>{i + 1}</Text>
              </LinearGradient>
              <Text style={[s.stepLabel, i === 0 && s.stepLabelActive]}>{step}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      {/* ── Form ── */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.form, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.formTitle}>{t.registerScreen.createTitle}</Text>
        <Text style={s.formSub}>{t.registerScreen.createSub}</Text>

        <AppInput
          icon={<Image source={require("@/assets/icons/ic_profile.png")} style={s.inputIcon} tintColor="#84889F" resizeMode="contain" />}
          value={name}
          onChangeText={setName}
          placeholder={t.registerScreen.namePlaceholder}
          autoCapitalize="words"
        />
        <AppInput
          icon={<Image source={require("@/assets/icons/ic_mail.png")} style={s.inputIcon} tintColor="#84889F" resizeMode="contain" />}
          value={email}
          onChangeText={setEmail}
          placeholder={t.registerScreen.emailPlaceholder}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <AppInput
          icon={<Image source={require("@/assets/icons/ic_secure.png")} style={s.inputIcon} tintColor="#84889F" resizeMode="contain" />}
          right={
            <TouchableOpacity onPress={() => setShowPw(!showPw)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Image
                source={showPw ? require("@/assets/icons/ic_eye_off.png") : require("@/assets/icons/ic_eye.png")}
                style={s.inputIcon}
                tintColor="#84889F"
                resizeMode="contain"
              />
            </TouchableOpacity>
          }
          value={password}
          onChangeText={setPassword}
          placeholder={t.registerScreen.passwordPlaceholder}
          secureTextEntry={!showPw}
        />

        {showInput ? (
          <AppInput
            icon={<Image source={require("@/assets/icons/ic_bonus.png")} style={s.inputIcon} tintColor="#84889F" resizeMode="contain" />}
            value={referralCode}
            onChangeText={onChange}
            placeholder="Referral code (optional)"
            autoCapitalize="characters"
          />
        ) : (
          <TouchableOpacity onPress={() => setShowInput(true)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={s.referralToggle}>Have a referral code?</Text>
          </TouchableOpacity>
        )}

        <PrimaryButton title={t.registerScreen.continueBtn} onPress={handleNext} loading={loading} />

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>{t.registerScreen.orSignUp}</Text>
          <View style={s.divLine} />
        </View>

        <TouchableOpacity
          onPress={handleGoogleRegister}
          style={[s.googleBtn, gLoading && { opacity: 0.6 }]}
          activeOpacity={0.8}
          disabled={gLoading}
        >
          {gLoading
            ? <ActivityIndicator size="small" color={DARK} />
            : <Image source={require("@/assets/icons/ic_google.png")} style={s.googleIcon} resizeMode="contain" />}
          <Text style={s.googleTxt}>{gLoading ? t.registerScreen.signingIn : t.registerScreen.continueGoogle}</Text>
        </TouchableOpacity>

        <View style={s.loginRow}>
          <Text style={s.loginTxt}>{t.registerScreen.alreadyRegistered}</Text>
          <TouchableOpacity onPress={() => router.replace("/auth/login")} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={s.loginLink}>{t.registerScreen.signIn}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  backIcon: { width: 20, height: 20 },
  headerCenter: { alignItems: "center", gap: 6, marginBottom: 20 },
  headerLogo: { width: 52, height: 52, borderRadius: 14, marginBottom: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.6)" },
  steps: { flexDirection: "row", justifyContent: "space-between" },
  stepItem: { alignItems: "center", gap: 5 },
  stepCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  stepNum: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "rgba(255,255,255,0.5)" },
  stepNumActive: { color: "#fff" },
  stepLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.45)" },
  stepLabelActive: { color: "rgba(200,140,255,0.9)", fontFamily: "Poppins_600SemiBold" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  formTitle: { fontSize: 21, fontFamily: "Poppins_700Bold", color: DARK },
  formSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: -6 },
  inputIcon: { width: 18, height: 18 },
  divRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: "#E8EAF0" },
  divTxt: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F" },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: "#E4E6F0", backgroundColor: "#FAFBFE",
  },
  googleIcon: { width: 22, height: 22 },
  googleTxt: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: DARK },
  referralToggle: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: ACCENT, textAlign: "center" },
  loginRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 2 },
  loginTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  loginLink: { fontSize: 14, fontFamily: "Poppins_700Bold", color: ACCENT },
});
