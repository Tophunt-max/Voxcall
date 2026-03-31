import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";
import { API } from "@/services/api";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
      Alert.alert("Missing Fields", "Please enter both email and password.");
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
        // Fully approved host — clear pending flag and go to host app
        await AsyncStorage.removeItem("hostAppPending");
        router.replace("/host/screens/host");
      } else {
        // Not yet a host — mark pending and redirect to KYC flow
        await AsyncStorage.setItem("hostAppPending", "true");
        router.replace("/host/auth/host-register");
      }
    } catch (err: any) {
      Alert.alert("Login Failed", err?.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    Alert.alert("Coming Soon", "Google Sign-In will be available in the next update.");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={["#111329", "#2D3057"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={s.hostIcoBg}>
            <Image source={require("@/assets/icons/ic_listener.png")} style={s.hostIco} tintColor="#fff" resizeMode="contain" />
          </View>
          <Text style={s.headerTitle}>Host Login</Text>
          <Text style={s.headerSub}>Manage sessions, earn coins, grow your audience</Text>
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.form, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.inputWrap}>
          <Feather name="mail" size={18} color="#84889F" />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor="#84889F"
            style={s.input}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={s.inputWrap}>
          <Feather name="lock" size={18} color="#84889F" />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#84889F"
            style={s.input}
            secureTextEntry={!showPw}
          />
          <TouchableOpacity onPress={() => setShowPw(!showPw)}>
            <Feather name={showPw ? "eye-off" : "eye"} size={18} color="#84889F" />
          </TouchableOpacity>
        </View>

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

        <TouchableOpacity onPress={() => router.push("/host/auth/host-register")} style={s.registerBtn} activeOpacity={0.8}>
          <Text style={s.registerBtnTxt}>New Host? Apply to Become a Host</Text>
          <Feather name="arrow-right" size={16} color={DARK} />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/user/auth/login")} style={s.switchRow}>
          <Text style={s.switchTxt}>Not a host? </Text>
          <Text style={s.switchLink}>User Login</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 32 },
  backBtn: { marginBottom: 16, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerCenter: { alignItems: "center", gap: 8 },
  hostIcoBg: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  hostIco: { width: 34, height: 34 },
  headerTitle: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.7)", textAlign: "center" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0, color: "#111329" },
  divRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: "#E8EAF0" },
  divTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F" },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#E8EAF0" },
  googleIco: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F0F0F0", alignItems: "center", justifyContent: "center" },
  googleTxt: { fontSize: 15, fontFamily: "Poppins_500Medium", color: "#111329" },
  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F0E4F8", borderRadius: 12, padding: 14 },
  infoTxt: { flex: 1, fontSize: 12, fontFamily: "Poppins_400Regular", color: "#111329", lineHeight: 18 },
  registerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, paddingHorizontal: 18, borderRadius: 14, backgroundColor: "#111329" },
  registerBtnTxt: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  switchTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  switchLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
