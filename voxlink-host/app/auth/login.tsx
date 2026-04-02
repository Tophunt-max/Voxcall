import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image,
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

const DARK = "#111329";
const ACCENT = "#A00EE7";

export default function HostLoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      showErrorToast("Please enter both email and password.", "Missing Fields");
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
        router.replace("/dashboard");
      } else {
        router.replace("/auth/status");
      }
    } catch (err: any) {
      showErrorToast(err?.message || "Invalid email or password.", "Login Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    showInfoToast("Google Sign-In will be available in the next update.", "Coming Soon");
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

        <PrimaryButton title="Sign In as Host" onPress={handleLogin} loading={loading} />

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>or</Text>
          <View style={s.divLine} />
        </View>

        <TouchableOpacity onPress={handleGoogleLogin} style={s.googleBtn} activeOpacity={0.8}>
          <View style={s.googleIco}>
            <Text style={{ fontSize: 16, fontFamily: "Poppins_700Bold" }}>G</Text>
          </View>
          <Text style={s.googleTxt}>Continue with Google</Text>
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
