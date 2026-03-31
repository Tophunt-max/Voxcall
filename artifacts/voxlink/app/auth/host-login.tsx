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

const DARK = "#111329";
const ACCENT = "#A00EE7";

export default function HostLoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Missing Fields", "Please enter both email and password.");
      return;
    }
    if (isRegister && !name.trim()) {
      Alert.alert("Missing Name", "Please enter your display name.");
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    const displayName = isRegister
      ? name.trim()
      : email.split("@")[0].replace(/[^a-z]/gi, " ").trim() || "Host";
    await login({
      id: "host_" + Date.now(),
      name: displayName,
      email: email.trim(),
      coins: 0,
      role: "host",
    });
    setLoading(false);
    router.replace("/screens/host");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* Dark header */}
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
        {/* Toggle tabs */}
        <View style={s.tabs}>
          <TouchableOpacity
            onPress={() => setIsRegister(false)}
            style={[s.tab, !isRegister && s.tabActive]}
            activeOpacity={0.8}
          >
            <Text style={[s.tabTxt, !isRegister && s.tabTxtActive]}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIsRegister(true)}
            style={[s.tab, isRegister && s.tabActive]}
            activeOpacity={0.8}
          >
            <Text style={[s.tabTxt, isRegister && s.tabTxtActive]}>Register</Text>
          </TouchableOpacity>
        </View>

        {isRegister && (
          <View style={s.inputWrap}>
            <Feather name="user" size={18} color="#84889F" />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your display name"
              placeholderTextColor="#84889F"
              style={s.input}
              autoCapitalize="words"
            />
          </View>
        )}

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

        {!isRegister && (
          <TouchableOpacity style={s.forgotRow} onPress={() => router.push("/auth/forgot-password")}>
            <Text style={s.forgotTxt}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        <View style={s.btnWrap}>
          <PrimaryButton
            title={isRegister ? "Create Host Account" : "Sign In as Host"}
            onPress={handleLogin}
            loading={loading}
          />
        </View>

        {/* Info banner */}
        <View style={s.infoBanner}>
          <Feather name="info" size={16} color={DARK} />
          <Text style={s.infoTxt}>
            As a host, you will earn coins per minute from calls. Your host dashboard will track all earnings and session history.
          </Text>
        </View>

        <TouchableOpacity onPress={() => router.back()} style={s.switchRow}>
          <Text style={s.switchTxt}>Not a host? </Text>
          <Text style={s.switchLink}>Login as User</Text>
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
  tabs: { flexDirection: "row", backgroundColor: "#F5F5F7", borderRadius: 12, padding: 4, marginBottom: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  tabActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabTxt: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#84889F" },
  tabTxtActive: { color: "#111329", fontFamily: "Poppins_600SemiBold" },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0, color: "#111329" },
  forgotRow: { alignSelf: "flex-end", marginTop: -4 },
  forgotTxt: { fontSize: 13, fontFamily: "Poppins_500Medium", color: ACCENT },
  btnWrap: { marginTop: 4 },
  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#F0E4F8", borderRadius: 12, padding: 14, marginTop: 4 },
  infoTxt: { flex: 1, fontSize: 12, fontFamily: "Poppins_400Regular", color: "#111329", lineHeight: 18 },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  switchTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  switchLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
