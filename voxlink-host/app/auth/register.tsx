import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from "react-native";
import AppInput from "@/components/AppInput";
import { showErrorToast, showWarningToast } from "@/components/Toast";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";
import { API } from "@/services/api";

const DARK = "#111329";
const ACCENT = "#A00EE7";

const STEPS = ["Account", "Profile", "Host Info", "KYC Docs"];

export default function HostRegisterScreen() {
  const insets = useSafeAreaInsets();
  const { user, isLoggedIn, loginWithToken } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn && user) {
      router.replace("/auth/profile-setup");
    }
  }, [isLoggedIn]);

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
  loginRow: { flexDirection: "row", justifyContent: "center", marginTop: 4 },
  loginTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  loginLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
