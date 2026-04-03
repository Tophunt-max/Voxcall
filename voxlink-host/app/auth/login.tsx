import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image, Platform, Alert, ActivityIndicator,
} from "react-native";
import AppInput from "@/components/AppInput";
import { showErrorToast, showInfoToast } from "@/components/Toast";
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
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

function isNetworkError(err: any): boolean {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("network") || msg.includes("fetch") || msg.includes("connection") || msg.includes("timeout");
}

export default function HostLoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
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

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      showErrorToast("Please enter both email and password.", "Missing Fields");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      showErrorToast("Please enter a valid email address.", "Invalid Email");
      return;
    }
    setLoading(true);
    try {
      const data = await API.login(email.trim(), password);
      const userData = data.user;
      await loginWithToken(data.token, {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        avatar: userData.avatar_url,
        coins: userData.coins ?? 0,
        role: userData.role ?? "user",
        gender: userData.gender,
        phone: userData.phone,
        bio: userData.bio,
      });
      if (userData.role === "host") {
        router.replace("/(tabs)");
      } else {
        showInfoToast(
          "Your account is not a host account. If you applied, check your application status below.",
          "Not a Host"
        );
        router.replace("/auth/status");
      }
    } catch (err: any) {
      showErrorToast(err?.message || "Invalid email or password.", "Login Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
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
        gender: userData.gender,
        phone: userData.phone,
        bio: userData.bio,
      });
      if (userData.role === "host") {
        // Existing approved host → go to dashboard
        router.replace("/(tabs)");
      } else {
        // New or unapproved user → redirect to complete host profile & KYC
        showInfoToast(
          "Welcome! Please complete your host profile and KYC to start earning.",
          "Almost There"
        );
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
        <View style={s.headerCenter}>
          <View style={s.hostIcoBg}>
            <Feather name="headphones" size={30} color="#fff" />
          </View>
          <Text style={s.headerTitle}>VoxLink Host</Text>
          <Text style={s.headerSub}>Manage sessions, earn coins, grow your audience</Text>
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.form, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.formTitle}>Sign in to Host</Text>

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
          placeholder="Password"
          secureTextEntry={!showPw}
        />

        <TouchableOpacity onPress={() => router.push("/auth/forgot-password")} style={{ alignSelf: "flex-end", marginTop: -4 }}>
          <Text style={{ fontSize: 13, fontFamily: "Poppins_500Medium", color: ACCENT }}>Forgot Password?</Text>
        </TouchableOpacity>

        <PrimaryButton title="Sign In as Host" onPress={handleLogin} loading={loading} />

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>or</Text>
          <View style={s.divLine} />
        </View>

        <TouchableOpacity
          onPress={handleGoogleLogin}
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

        <View style={s.infoBanner}>
          <Feather name="info" size={16} color={DARK} />
          <Text style={s.infoTxt}>
            New to hosting? Register below — you'll go through a quick KYC verification to start earning.
          </Text>
        </View>

        <TouchableOpacity onPress={() => router.push("/auth/register")} style={s.registerBtn} activeOpacity={0.8}>
          <Text style={s.registerBtnTxt}>New Host? Apply to Become a Host</Text>
          <Feather name="arrow-right" size={16} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 32 },
  headerCenter: { alignItems: "center", gap: 8 },
  hostIcoBg: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  headerTitle: { fontSize: 26, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.7)", textAlign: "center" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  formTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", color: DARK, marginBottom: 4 },
  divRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: "#E8EAF0" },
  divTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F" },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#E8EAF0" },
  googleIco: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F0F0F0", alignItems: "center", justifyContent: "center" },
  googleTxt: { fontSize: 15, fontFamily: "Poppins_500Medium", color: DARK },
  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F0E4F8", borderRadius: 12, padding: 14 },
  infoTxt: { flex: 1, fontSize: 12, fontFamily: "Poppins_400Regular", color: DARK, lineHeight: 18 },
  registerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, paddingHorizontal: 18, borderRadius: 14, backgroundColor: DARK },
  registerBtnTxt: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#fff" },
});
