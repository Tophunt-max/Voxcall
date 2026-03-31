import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import * as Application from "expo-application";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { saveFirestoreUser } from "@/services/firestoreUser";
import { getRandomAvatarKey } from "@/utils/randomAvatar";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

WebBrowser.maybeCompleteAuthSession();

const ACCENT = "#A00EE7";
const DEVICE_ID_KEY = "@voxlink_device_id";

async function getDeviceId(): Promise<string> {
  if (Platform.OS === "android") {
    const androidId = Application.getAndroidId();
    if (androidId) return `android_${androidId}`;
  } else if (Platform.OS === "ios") {
    const vendorId = await Application.getIosIdForVendorAsync();
    if (vendorId) return `ios_${vendorId}`;
  }
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const generated = `dev_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState(false);

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? undefined,
    selectAccount: true,
  });

  useEffect(() => {
    if (response?.type === "success") {
      const accessToken = response.authentication?.accessToken;
      if (accessToken) {
        handleGoogleToken(accessToken);
      } else {
        setGoogleLoading(false);
        showErrorToast("Google sign-in failed. Please try again.");
      }
    } else if (response?.type === "error") {
      setGoogleLoading(false);
      const msg = response.error?.message || "Google sign-in failed";
      if (!msg.toLowerCase().includes("cancel")) {
        showErrorToast(msg, "Sign In Failed");
      }
    } else if (response?.type === "dismiss") {
      setGoogleLoading(false);
    }
  }, [response]);

  const handleGoogleLogin = async () => {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!clientId) {
      showErrorToast("Google Sign-In is not configured yet. Use Quick Login.", "Not Available");
      return;
    }
    setGoogleLoading(true);
    try {
      await promptAsync();
    } catch {
      setGoogleLoading(false);
    }
  };

  const handleGoogleToken = async (accessToken: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/userinfo/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("Failed to get Google profile");
      const gUser = await res.json() as { id: string; name: string; email: string; picture?: string };

      const data = await API.googleLogin(gUser.email, gUser.name, gUser.id, gUser.picture ?? null);

      const profile = {
        id: data.user.id || gUser.id,
        name: data.user.name || gUser.name,
        email: data.user.email || gUser.email,
        avatar: gUser.picture || data.user.avatar_url || null,
        coins: data.user.coins ?? 50,
        role: "user" as const,
      };

      await saveFirestoreUser({
        uid: profile.id,
        name: profile.name,
        email: profile.email,
        avatar: profile.avatar || "",
        coins: profile.coins,
        role: "user",
        loginMethod: "google",
      });

      await loginWithToken(data.token, profile);
      await AsyncStorage.removeItem("hostAppPending");
      showSuccessToast(`Welcome, ${profile.name}!`);
      router.replace("/user/screens/user");
    } catch (err: any) {
      const msg = err?.message || "Google sign-in failed";
      showErrorToast(msg, "Sign In Failed");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleQuickLogin = async () => {
    setQuickLoading(true);
    try {
      const deviceId = await getDeviceId();
      const data = await API.quickLogin(deviceId);

      const avatarKey = data.user.avatar_url || getRandomAvatarKey();
      const profile = {
        id: data.user.id,
        name: data.user.name || "VoxLink User",
        email: data.user.email || "",
        avatar: avatarKey,
        coins: data.user.coins ?? 50,
        role: "user" as const,
        is_guest: true,
      };

      await saveFirestoreUser({
        uid: profile.id,
        name: profile.name,
        email: profile.email,
        avatar: avatarKey,
        coins: profile.coins,
        role: "user",
        is_guest: true,
        loginMethod: "quick",
      });

      await loginWithToken(data.token, profile);

      if (data.is_returning) {
        showSuccessToast("Welcome back!", "Quick Login");
      }
      router.replace("/user/screens/user");
    } catch (err: any) {
      showErrorToast("Quick Login failed. Please try again.");
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
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>

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
        <Text style={s.welcomeTitle}>Welcome Back</Text>
        <Text style={s.welcomeSub}>Sign in to continue browsing hosts and chatting</Text>

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

        <View style={s.bottomLinks}>
          <TouchableOpacity onPress={() => router.push("/host/auth/host-login")} style={s.hostLink}>
            <Feather name="headphones" size={14} color={ACCENT} />
            <Text style={s.hostLinkTxt}>Are you a Host? Sign in here</Text>
          </TouchableOpacity>
        </View>
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
  backBtn: {
    alignSelf: "flex-start",
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
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
  bottomLinks: {
    alignItems: "center",
    marginTop: 8,
  },
  hostLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
  },
  hostLinkTxt: {
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
    color: ACCENT,
  },
});
