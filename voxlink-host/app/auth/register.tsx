import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Platform, Alert, ActivityIndicator,
} from "react-native";
import AppInput from "@/components/AppInput";
import { showErrorToast, showInfoToast, showWarningToast } from "@/components/Toast";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";
import { API } from "@/services/api";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";

WebBrowser.maybeCompleteAuthSession();

const DARK = "#111329";
const ACCENT = "#A00EE7";
const STEPS = ["Account", "Profile", "Host Info", "KYC Docs"];
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

function isNetworkError(err: any): boolean {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("network") || msg.includes("fetch") || msg.includes("connection") || msg.includes("timeout");
}

export default function HostRegisterScreen() {
  const insets = useSafeAreaInsets();
  const { user, isLoggedIn, loginWithToken } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID || "not-configured",
    selectAccount: true,
  });

  useEffect(() => {
    if (isLoggedIn && user) {
      router.replace("/auth/profile-setup");
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!response) return;
    if (response.type === "success") {
      const accessToken = response.authentication?.accessToken;
      if (accessToken) {
        handleGoogleToken(accessToken);
      } else {
        setGoogleLoading(false);
        showErrorToast("Google sign-in failed. Try again.");
      }
    } else if (response.type === "error") {
      setGoogleLoading(false);
      const msg = response.error?.message || "";
      if (!msg.toLowerCase().includes("cancel")) {
        showErrorToast(msg || "Google sign-in failed", "Sign In Failed");
      }
    } else if (response.type === "dismiss") {
      setGoogleLoading(false);
    }
  }, [response]);

  const handleNext = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      showErrorToast("Please fill in all fields.", "Missing Fields");
      return;
    }
    if (password.length < 8) {
      showWarningToast("Password must be at least 8 characters.", "Weak Password");
      return;
    }
    setLoading(true);
    try {
      const data = await API.register(name.trim(), email.trim(), password);
      await loginWithToken(data.token, {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        coins: data.user.coins ?? 0,
        role: data.user.role ?? "user",
      });
      router.push("/auth/profile-setup");
    } catch (err: any) {
      showErrorToast(err?.message || "Could not create account. Email may already be in use.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRegister = async () => {
    setGoogleLoading(true);
    try {
      if (Platform.OS === "web") {
        const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
        const { auth } = await import("@/services/firebase");
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider);
        const u = result.user;
        await handleGoogleProfileData(u.uid, u.displayName || "User", u.email || "", u.photoURL);
      } else {
        if (!GOOGLE_WEB_CLIENT_ID) {
          setGoogleLoading(false);
          Alert.alert(
            "Setup Required",
            "Google Sign-In is not configured yet.\n\nPlease use email/password to continue.",
            [{ text: "OK" }]
          );
          return;
        }
        await promptAsync();
      }
    } catch (err: any) {
      setGoogleLoading(false);
      if (isNetworkError(err)) {
        showErrorToast("No internet connection. Please check your network.", "Connection Error");
      } else if (!err?.message?.toLowerCase().includes("cancel")) {
        showErrorToast(err?.message || "Google sign-in failed", "Sign In Failed");
      }
    }
  };

  const handleGoogleToken = async (accessToken: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/userinfo/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("Failed to get Google profile");
      const gUser = await res.json() as { id: string; name: string; email: string; picture?: string };
      await handleGoogleProfileData(gUser.id, gUser.name, gUser.email, gUser.picture ?? null);
    } catch (err: any) {
      if (isNetworkError(err)) {
        showErrorToast("No internet connection. Please check your network.", "Connection Error");
      } else {
        showErrorToast(err?.message || "Google sign-in failed", "Sign In Failed");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleProfileData = async (
    id: string, name: string, email: string, photo?: string | null
  ) => {
    try {
      const data = await API.googleLogin(email, name, id, photo ?? null);
      const userData = data.user;
      await loginWithToken(data.token, {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        avatar: photo || userData.avatar_url || undefined,
        coins: userData.coins ?? 0,
        role: userData.role ?? "user",
      });
      if (userData.role === "host") {
        // Already an approved host — go to dashboard
        router.replace("/(tabs)");
      } else {
        // New or pending user — complete host profile & KYC
        showInfoToast("Welcome! Please complete your profile to apply as a host.", "Almost There");
        router.replace("/auth/profile-setup");
      }
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

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={[DARK, "#2D3057"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Become a Host</Text>
        <Text style={s.headerSub}>Complete 4 steps to start hosting</Text>

        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
              <View style={[s.stepCircle, i === 0 && s.stepActive]}>
                <Text style={[s.stepNum, i === 0 && s.stepNumActive]}>{i + 1}</Text>
              </View>
              <Text style={[s.stepLabel, i === 0 && { color: "#fff" }]}>{step}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.form, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.sectionTitle}>Create Your Account</Text>
        <Text style={s.sectionSub}>This will be your VoxLink Host login</Text>

        <AppInput
          icon={<Feather name="user" size={18} color="#84889F" />}
          value={name}
          onChangeText={setName}
          placeholder="Full name"
          autoCapitalize="words"
        />
        <AppInput
          icon={<Feather name="mail" size={18} color="#84889F" />}
          value={email}
          onChangeText={setEmail}
          placeholder="Email address"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <AppInput
          icon={<Feather name="lock" size={18} color="#84889F" />}
          right={
            <TouchableOpacity onPress={() => setShowPw(!showPw)}>
              <Feather name={showPw ? "eye-off" : "eye"} size={18} color="#84889F" />
            </TouchableOpacity>
          }
          value={password}
          onChangeText={setPassword}
          placeholder="Password (8+ characters)"
          secureTextEntry={!showPw}
        />

        <PrimaryButton title="Continue →" onPress={handleNext} loading={loading} />

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>or sign up with</Text>
          <View style={s.divLine} />
        </View>

        <TouchableOpacity
          onPress={handleGoogleRegister}
          style={[s.googleBtn, googleLoading && { opacity: 0.6 }]}
          activeOpacity={0.8}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <ActivityIndicator size="small" color={DARK} />
          ) : (
            <View style={s.googleIco}>
              <Text style={{ fontSize: 16, fontFamily: "Poppins_700Bold" }}>G</Text>
            </View>
          )}
          <Text style={s.googleTxt}>
            {googleLoading ? "Signing in..." : "Continue with Google"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace("/auth/login")} style={s.loginRow}>
          <Text style={s.loginTxt}>Already registered? </Text>
          <Text style={s.loginLink}>Sign In</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  backBtn: { marginBottom: 16, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#fff", textAlign: "center" },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.7)", textAlign: "center", marginBottom: 16 },
  steps: { flexDirection: "row", justifyContent: "space-between" },
  stepItem: { alignItems: "center", gap: 4 },
  stepCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  stepActive: { backgroundColor: "#fff" },
  stepNum: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "rgba(255,255,255,0.7)" },
  stepNumActive: { color: DARK },
  stepLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.5)" },
  form: { paddingHorizontal: 24, paddingTop: 24, gap: 14 },
  sectionTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", color: DARK },
  sectionSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: -6 },
  divRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: "#E8EAF0" },
  divTxt: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F" },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#E8EAF0" },
  googleIco: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F0F0F0", alignItems: "center", justifyContent: "center" },
  googleTxt: { fontSize: 15, fontFamily: "Poppins_500Medium", color: DARK },
  loginRow: { flexDirection: "row", justifyContent: "center", marginTop: 4 },
  loginTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  loginLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
