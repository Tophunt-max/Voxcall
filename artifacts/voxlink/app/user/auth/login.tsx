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

const ACCENT = "#A00EE7";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Missing Fields", "Please enter both email and password.");
      return;
    }
    setLoading(true);
    try {
      const data = await API.login(email.trim(), password);
      await loginWithToken(data.token, {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        avatar: data.user.avatar_url,
        coins: data.user.coins ?? 0,
        role: data.user.role ?? "user",
        gender: data.user.gender,
        phone: data.user.phone,
        bio: data.user.bio,
      });
      await AsyncStorage.removeItem("hostAppPending");
      router.replace("/user/screens/user");
    } catch (err: any) {
      Alert.alert("Login Failed", err?.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setGuestLoading(true);
    try {
      const data = await API.guestLogin();
      await loginWithToken(data.token, {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        coins: data.user.coins ?? 50,
        role: "user",
        is_guest: true,
      });
      router.replace("/user/screens/user");
    } catch (err: any) {
      Alert.alert("Error", "Could not start guest session. Please try again.");
    } finally {
      setGuestLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    Alert.alert("Coming Soon", "Google Sign-In will be available in the next update.");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={["#A00EE7", "#6A00B8"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={s.userIcoBg}>
            <Image source={require("@/assets/icons/ic_profile.png")} style={s.userIco} tintColor="#fff" resizeMode="contain" />
          </View>
          <Text style={s.headerTitle}>User Login</Text>
          <Text style={s.headerSub}>Browse hosts, book calls and chat</Text>
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
            autoComplete="email"
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
            autoComplete="password"
          />
          <TouchableOpacity onPress={() => setShowPw(!showPw)}>
            <Feather name={showPw ? "eye-off" : "eye"} size={18} color="#84889F" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.forgotRow}>
          <Text style={s.forgotTxt}>Forgot password?</Text>
        </TouchableOpacity>

        <PrimaryButton title="Sign In" onPress={handleLogin} loading={loading} />

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>or continue with</Text>
          <View style={s.divLine} />
        </View>

        {/* Google Login */}
        <TouchableOpacity onPress={handleGoogleLogin} style={s.googleBtn} activeOpacity={0.8}>
          <Image source={{ uri: "https://www.svgrepo.com/show/475656/google-color.svg" }} style={s.googleIco} />
          <Text style={s.googleTxt}>Continue with Google</Text>
        </TouchableOpacity>

        {/* Guest Login */}
        <TouchableOpacity
          onPress={handleGuestLogin}
          style={s.guestBtn}
          activeOpacity={0.75}
          disabled={guestLoading}
        >
          <Feather name="user" size={18} color="#84889F" />
          <Text style={s.guestTxt}>{guestLoading ? "Please wait..." : "Continue as Guest"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/user/auth/register")} style={s.signupRow}>
          <Text style={s.signupTxt}>Don't have an account? </Text>
          <Text style={s.signupLink}>Sign Up</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/host/auth/host-login")} style={s.switchRow}>
          <Text style={s.switchTxt}>Are you a host? </Text>
          <Text style={s.switchLink}>Host Login</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 32 },
  backBtn: { marginBottom: 16, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerCenter: { alignItems: "center", gap: 8 },
  userIcoBg: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  userIco: { width: 34, height: 34 },
  headerTitle: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.75)", textAlign: "center" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0, color: "#111329" },
  forgotRow: { alignSelf: "flex-end", marginTop: -4 },
  forgotTxt: { fontSize: 13, fontFamily: "Poppins_500Medium", color: ACCENT },
  divRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: "#E8EAF0" },
  divTxt: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F" },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#E8EAF0", backgroundColor: "#fff" },
  googleIco: { width: 22, height: 22 },
  googleTxt: { fontSize: 15, fontFamily: "Poppins_500Medium", color: "#111329" },
  guestBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0" },
  guestTxt: { fontSize: 15, fontFamily: "Poppins_500Medium", color: "#84889F" },
  signupRow: { flexDirection: "row", justifyContent: "center" },
  signupTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  signupLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: ACCENT },
  switchRow: { flexDirection: "row", justifyContent: "center" },
  switchTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  switchLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#111329" },
});
