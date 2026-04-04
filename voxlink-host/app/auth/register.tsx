import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Platform, Alert, ActivityIndicator, Image,
} from "react-native";
import AppInput from "@/components/AppInput";
import { showErrorToast, showInfoToast, showWarningToast } from "@/components/Toast";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";
import { API } from "@/services/api";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";

WebBrowser.maybeCompleteAuthSession();

const BG     = "#0A0B1E";
const ACCENT = "#A00EE7";
const DARK   = "#111329";
const STEPS  = ["Account", "Profile", "Host Info", "KYC Docs"];
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

function isNetworkError(err: any) {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("network") || msg.includes("fetch") || msg.includes("connection") || msg.includes("timeout");
}

export default function HostRegisterScreen() {
  const insets = useSafeAreaInsets();
  const { user, isLoggedIn, loginWithToken } = useAuth();
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [gLoading, setGLoading] = useState(false);

  const [, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID || "not-configured",
    selectAccount: true,
  });

  useEffect(() => {
    if (isLoggedIn && user)
      router.replace(user.role === "host" ? "/(tabs)" : "/auth/profile-setup");
  }, [isLoggedIn]);

  useEffect(() => {
    if (!response) return;
    if (response.type === "success") {
      const tok = response.authentication?.accessToken;
      if (tok) handleGoogleToken(tok);
      else { setGLoading(false); showErrorToast("Google sign-in failed. Try again."); }
    } else if (response.type === "error") {
      setGLoading(false);
      const msg = response.error?.message || "";
      if (!msg.toLowerCase().includes("cancel")) showErrorToast(msg || "Google sign-in failed", "Sign In Failed");
    } else if (response.type === "dismiss") { setGLoading(false); }
  }, [response]);

  const handleNext = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      showErrorToast("Please fill in all fields.", "Missing Fields"); return;
    }
    if (password.length < 8) {
      showWarningToast("Password must be at least 8 characters.", "Weak Password"); return;
    }
    setLoading(true);
    try {
      const data = await API.register(name.trim(), email.trim(), password);
      await loginWithToken(data.token, {
        id: data.user.id, name: data.user.name, email: data.user.email,
        coins: data.user.coins ?? 0, role: data.user.role ?? "user",
      });
      router.push("/auth/profile-setup");
    } catch (err: any) {
      showErrorToast(err?.message || "Could not create account. Email may already be in use.");
    } finally { setLoading(false); }
  };

  const handleGoogleRegister = async () => {
    setGLoading(true);
    try {
      if (Platform.OS === "web") {
        const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
        const { auth } = await import("@/services/firebase");
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        const u = result.user;
        await handleGoogleProfileData(u.uid, u.displayName || "User", u.email || "", u.photoURL);
      } else {
        if (!GOOGLE_WEB_CLIENT_ID) {
          setGLoading(false);
          Alert.alert("Setup Required", "Google Sign-In is not configured yet.\n\nPlease use email/password.", [{ text: "OK" }]);
          return;
        }
        await promptAsync();
      }
    } catch (err: any) {
      setGLoading(false);
      if (isNetworkError(err)) showErrorToast("No internet connection.", "Connection Error");
      else if (!err?.message?.toLowerCase().includes("cancel"))
        showErrorToast(err?.message || "Google sign-in failed", "Sign In Failed");
    }
  };

  const handleGoogleToken = async (accessToken: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/userinfo/v2/me", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error("Failed to get Google profile");
      const g = await res.json() as { id: string; name: string; email: string; picture?: string };
      await handleGoogleProfileData(g.id, g.name, g.email, g.picture ?? null);
    } catch (err: any) {
      if (isNetworkError(err)) showErrorToast("No internet connection.", "Connection Error");
      else showErrorToast(err?.message || "Google sign-in failed", "Sign In Failed");
    } finally { setGLoading(false); }
  };

  const handleGoogleProfileData = async (id: string, name: string, email: string, photo?: string | null) => {
    try {
      const data = await API.googleLogin(email, name, id, photo ?? null);
      const u = data.user;
      await loginWithToken(data.token, {
        id: u.id, name: u.name, email: u.email,
        avatar: photo || u.avatar_url || undefined,
        coins: u.coins ?? 0, role: u.role ?? "user",
      });
      if (u.role === "host") router.replace("/(tabs)");
      else { showInfoToast("Welcome! Please complete your profile to apply as a host.", "Almost There"); router.replace("/auth/profile-setup"); }
    } catch (err: any) {
      if (isNetworkError(err)) showErrorToast("No internet connection.", "Connection Error");
      else showErrorToast(err?.message || "Sign-in failed. Please try again.", "Sign In Failed");
    } finally { setGLoading(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* ── Dark gradient header ── */}
      <LinearGradient colors={[BG, "#1A1C3A"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Image source={require("@/assets/icons/ic_back.png")} style={s.backIcon} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Image source={require("@/assets/images/app_logo.png")} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Become a Host</Text>
          <Text style={s.headerSub}>Complete 4 steps to start earning</Text>
        </View>

        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
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
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.form, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.formTitle}>Create Your Account</Text>
        <Text style={s.formSub}>This will be your VoxLink Host login</Text>

        <AppInput
          icon={<Image source={require("@/assets/icons/ic_profile.png")} style={s.inputIcon} tintColor="#84889F" resizeMode="contain" />}
          value={name}
          onChangeText={setName}
          placeholder="Full name"
          autoCapitalize="words"
        />
        <AppInput
          icon={<Image source={require("@/assets/icons/ic_mail.png")} style={s.inputIcon} tintColor="#84889F" resizeMode="contain" />}
          value={email}
          onChangeText={setEmail}
          placeholder="Email address"
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
          placeholder="Password (8+ characters)"
          secureTextEntry={!showPw}
        />

        <PrimaryButton title="Continue" onPress={handleNext} loading={loading} />

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>or sign up with</Text>
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
          <Text style={s.googleTxt}>{gLoading ? "Signing in..." : "Continue with Google"}</Text>
        </TouchableOpacity>

        <View style={s.loginRow}>
          <Text style={s.loginTxt}>Already registered? </Text>
          <TouchableOpacity onPress={() => router.replace("/auth/login")} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={s.loginLink}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  loginRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 2 },
  loginTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  loginLink: { fontSize: 14, fontFamily: "Poppins_700Bold", color: ACCENT },
});
