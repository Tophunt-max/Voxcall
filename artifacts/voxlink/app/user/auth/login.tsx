import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { saveFirestoreUser } from "@/services/firestoreUser";
import { getRandomAvatarKey } from "@/utils/randomAvatar";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ACCENT = "#A00EE7";
const GOOGLE_WEB_CLIENT_ID = "128169786412-web-client-placeholder";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      let googleUser: { name: string; email: string; photo?: string | null; id: string } | null = null;

      if (Platform.OS === "web") {
        const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
        const { auth } = await import("@/services/firebase");
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider);
        const u = result.user;
        googleUser = {
          id: u.uid,
          name: u.displayName || "User",
          email: u.email || "",
          photo: u.photoURL,
        };
      } else {
        try {
          const { GoogleSignin, statusCodes } = await import(
            "@react-native-google-signin/google-signin"
          );
          GoogleSignin.configure({
            webClientId: GOOGLE_WEB_CLIENT_ID,
            offlineAccess: true,
          });
          await GoogleSignin.hasPlayServices();
          const userInfo = await GoogleSignin.signIn();
          const u = userInfo.data?.user;
          if (!u) throw new Error("Google sign in cancelled");
          googleUser = {
            id: u.id,
            name: u.name || "User",
            email: u.email,
            photo: u.photo,
          };
        } catch (err: any) {
          if (err.code === "SIGN_IN_CANCELLED" || err.message?.includes("cancel")) {
            setGoogleLoading(false);
            return;
          }
          throw err;
        }
      }

      if (!googleUser) throw new Error("Could not get Google user");

      const avatarKey = getRandomAvatarKey();
      const avatarUrl = googleUser.photo || null;

      const data = await API.googleLogin(
        googleUser.email,
        googleUser.name,
        googleUser.id,
        avatarUrl
      );

      const profile = {
        id: data.user.id || googleUser.id,
        name: data.user.name || googleUser.name,
        email: data.user.email || googleUser.email,
        avatar: avatarUrl || data.user.avatar_url,
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
      if (!msg.includes("cancel") && !msg.includes("Cancel")) {
        showErrorToast(msg, "Sign In Failed");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setGuestLoading(true);
    try {
      const data = await API.guestLogin();
      const avatarKey = getRandomAvatarKey();

      const profile = {
        id: data.user.id,
        name: data.user.name || "Guest User",
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
        loginMethod: "guest",
      });

      await loginWithToken(data.token, profile);
      router.replace("/user/screens/user");
    } catch (err: any) {
      showErrorToast("Could not start guest session. Please try again.");
    } finally {
      setGuestLoading(false);
    }
  };

  const isLoading = googleLoading || guestLoading;

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
          style={[s.guestBtn, isLoading && s.btnDisabled]}
          onPress={handleGuestLogin}
          activeOpacity={0.75}
          disabled={isLoading}
        >
          {guestLoading ? (
            <ActivityIndicator color="#84889F" size="small" />
          ) : (
            <View style={s.guestIcoBg}>
              <Feather name="user" size={18} color="#84889F" />
            </View>
          )}
          <Text style={s.guestTxt}>
            {guestLoading ? "Please wait..." : "Continue as Guest"}
          </Text>
        </TouchableOpacity>

        <Text style={s.noteText}>
          Guest accounts get 50 free coins to try calls
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
  guestBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E8EAF0",
    backgroundColor: "#FAFAFA",
  },
  guestIcoBg: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F0F0F5",
    alignItems: "center",
    justifyContent: "center",
  },
  guestTxt: {
    fontSize: 15,
    fontFamily: "Poppins_500Medium",
    color: "#555770",
  },
  btnDisabled: { opacity: 0.65 },
  noteText: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "#84889F",
    textAlign: "center",
    marginTop: -4,
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
