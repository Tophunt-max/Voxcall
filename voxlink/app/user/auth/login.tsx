import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Platform, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import * as Application from "expo-application";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";
import { API, resolveMediaUrl } from "@/services/api";
import { getRandomAvatarUri } from "@/utils/randomAvatar";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

WebBrowser.maybeCompleteAuthSession();

const ACCENT = "#A00EE7";
const DEVICE_ID_KEY = "@voxlink_device_id";

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

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
  const [googleLoading, setGoogleLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState(false);

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
            "Google Sign-In is not configured yet.\n\nPlease use Quick Login to continue.",
            [{ text: "OK" }]
          );
          return;
        }
        await promptAsync();
      }
    } catch (err: any) {
      setGoogleLoading(false);
      const msg = err?.message || "";
      if (isNetworkError(err)) {
        showErrorToast("No internet connection. Please check your network.", "Connection Error");
      } else if (msg.includes("CONFIGURATION_NOT_FOUND") || msg.includes("configuration-not-found")) {
        Alert.alert(
          "Google Sign-In Unavailable",
          "Google Sign-In is not enabled for this app.\n\nPlease use Quick Login to continue.",
          [{ text: "OK" }]
        );
      } else if (!msg.toLowerCase().includes("cancel")) {
        showErrorToast(msg || "Google sign-in failed", "Sign In Failed");
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
      const deviceId = await getDeviceId();
      const data = await API.googleLogin(email, name, id, photo ?? null, deviceId);
      const profile = {
        id: data.user.id || id,
        name: data.user.name || name,
        email: data.user.email || email,
        avatar: photo || resolveMediaUrl(data.user.avatar_url) || null,
        coins: data.user.coins ?? 50,
        role: "user" as const,
      };
      await loginWithToken(data.token, profile);
      showSuccessToast(`Welcome, ${profile.name}!`);
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

  const handleQuickLogin = async () => {
    setQuickLoading(true);
    try {
      const deviceId = await getDeviceId();
      const data = await API.quickLogin(deviceId);
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
        showSuccessToast("Welcome back!", "Quick Login");
      } else {
        showSuccessToast("Account created! Welcome to VoxLink.", "Welcome");
      }
      router.replace("/user/screens/home");
    } catch (err: any) {
      if (isNetworkError(err)) {
        showErrorToast("No internet connection. Please check your network.", "Connection Error");
      } else {
        showErrorToast("Quick Login failed. Please try again.");
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
        <Text style={s.tagline}>Connect. Talk. Grow.</Text>
      </LinearGradient>

      <View style={[s.card, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={s.welcomeTitle}>Welcome to VoxLink</Text>
        <Text style={s.welcomeSub}>New user? We'll create your account automatically on first login</Text>

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
            {googleLoading ? "Signing in..." : "Continue with Google"}
          </Text>
        </TouchableOpacity>

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>or</Text>
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
            {quickLoading ? "Please wait..." : "Quick Login"}
          </Text>
        </TouchableOpacity>

        <Text style={s.noteText}>
          Quick Login saves your account to this device — reinstall and it's still yours
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
  noteText: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "#84889F",
    textAlign: "center",
    marginTop: -4,
    lineHeight: 18,
  },
});
