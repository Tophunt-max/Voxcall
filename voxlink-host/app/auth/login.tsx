import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Platform, Alert, ActivityIndicator,
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
const ACCENT_LIGHT = "#C84BF5";
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
        router.replace("/(tabs)");
      } else {
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
    <LinearGradient
      colors={["#0D0F22", "#181A38", "#0D0F22"]}
      style={{ flex: 1 }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 36 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <View style={s.hero}>
          <LinearGradient
            colors={[ACCENT, "#6A0DAD"]}
            style={s.iconRing}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Feather name="headphones" size={30} color="#fff" />
          </LinearGradient>

          <Text style={s.brandName}>VoxLink Host</Text>
          <Text style={s.brandTagline}>Manage sessions · Earn coins · Grow your audience</Text>

          <View style={s.badgeRow}>
            <View style={s.badge}>
              <Feather name="shield" size={11} color={ACCENT_LIGHT} />
              <Text style={s.badgeTxt}>KYC Verified</Text>
            </View>
            <View style={s.badge}>
              <Feather name="zap" size={11} color={ACCENT_LIGHT} />
              <Text style={s.badgeTxt}>Host Platform</Text>
            </View>
          </View>
        </View>

        {/* ── Form Card ── */}
        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>Welcome back</Text>
            <Text style={s.cardSub}>Sign in to your host account</Text>
          </View>

          <View style={s.fields}>
            <AppInput
              icon={<Feather name="mail" size={17} color="#6B6E8E" />}
              value={email}
              onChangeText={setEmail}
              placeholder="Email address"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <AppInput
              icon={<Feather name="lock" size={17} color="#6B6E8E" />}
              right={
                <TouchableOpacity
                  onPress={() => setShowPw(!showPw)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name={showPw ? "eye-off" : "eye"} size={17} color="#6B6E8E" />
                </TouchableOpacity>
              }
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry={!showPw}
            />

            <TouchableOpacity
              onPress={() => router.push("/auth/forgot-password")}
              style={s.forgotRow}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={s.forgotTxt}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          <PrimaryButton title="Sign In as Host" onPress={handleLogin} loading={loading} />

          <View style={s.divRow}>
            <View style={s.divLine} />
            <Text style={s.divTxt}>or continue with</Text>
            <View style={s.divLine} />
          </View>

          <TouchableOpacity
            onPress={handleGoogleLogin}
            style={[s.googleBtn, googleLoading && { opacity: 0.6 }]}
            activeOpacity={0.85}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color="#555" />
            ) : (
              <View style={s.googleLogo}>
                <Text style={s.googleG}>G</Text>
              </View>
            )}
            <Text style={s.googleTxt}>
              {googleLoading ? "Signing in..." : "Continue with Google"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Info Banner ── */}
        <View style={s.infoBanner}>
          <View style={s.infoDot}>
            <Feather name="info" size={13} color={ACCENT_LIGHT} />
          </View>
          <Text style={s.infoTxt}>
            New hosts must complete KYC verification before going live. It only takes a few minutes.
          </Text>
        </View>

        {/* ── Register CTA ── */}
        <TouchableOpacity
          onPress={() => router.push("/auth/register")}
          style={s.registerBtn}
          activeOpacity={0.88}
        >
          <LinearGradient
            colors={[ACCENT, "#6A0DAD"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.registerGrad}
          >
            <View style={s.registerLeft}>
              <View style={s.registerIcon}>
                <Feather name="user-plus" size={16} color="#fff" />
              </View>
              <View>
                <Text style={s.registerTitle}>New Host?</Text>
                <Text style={s.registerSub}>Apply & start earning</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.75)" />
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    gap: 18,
  },

  /* Hero */
  hero: {
    alignItems: "center",
    paddingVertical: 12,
    gap: 8,
  },
  iconRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 12,
  },
  brandName: {
    fontSize: 26,
    fontFamily: "Poppins_700Bold",
    color: "#fff",
    letterSpacing: 0.2,
  },
  brandTagline: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(160,14,231,0.18)",
    borderWidth: 1,
    borderColor: "rgba(160,14,231,0.35)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeTxt: {
    fontSize: 11,
    fontFamily: "Poppins_500Medium",
    color: ACCENT_LIGHT,
  },

  /* Card */
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 22,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  cardHead: {
    gap: 2,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 21,
    fontFamily: "Poppins_700Bold",
    color: DARK,
  },
  cardSub: {
    fontSize: 13,
    fontFamily: "Poppins_400Regular",
    color: "#84889F",
  },
  fields: {
    gap: 10,
  },
  forgotRow: {
    alignSelf: "flex-end",
    marginTop: 2,
  },
  forgotTxt: {
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
    color: ACCENT,
  },

  /* Divider */
  divRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  divLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#EDEEF4",
  },
  divTxt: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "#A0A3B5",
  },

  /* Google */
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E4E6F0",
    backgroundColor: "#FAFAFA",
  },
  googleLogo: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E8EAF0",
  },
  googleG: {
    fontSize: 14,
    fontFamily: "Poppins_700Bold",
    color: "#4285F4",
  },
  googleTxt: {
    fontSize: 14,
    fontFamily: "Poppins_500Medium",
    color: "#2E3050",
  },

  /* Info Banner */
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "rgba(160,14,231,0.12)",
    borderWidth: 1,
    borderColor: "rgba(160,14,231,0.25)",
    borderRadius: 16,
    padding: 14,
  },
  infoDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(160,14,231,0.22)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  infoTxt: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "rgba(255,255,255,0.78)",
    lineHeight: 19,
  },

  /* Register CTA */
  registerBtn: {
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 16,
    elevation: 8,
  },
  registerGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  registerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  registerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  registerTitle: {
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
    color: "#fff",
    lineHeight: 20,
  },
  registerSub: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "rgba(255,255,255,0.72)",
  },
});
