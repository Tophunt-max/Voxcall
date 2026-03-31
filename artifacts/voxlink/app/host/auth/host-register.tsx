// Host Registration — Step 1: Create Account
// If user is already logged in, skip to step 2
import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert,
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
      // Already logged in — skip to profile step
      router.replace("/host/auth/host-profile-setup");
    }
  }, [isLoggedIn]);

  const handleNext = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert("Missing Fields", "Please fill in all fields.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Weak Password", "Password must be at least 6 characters.");
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
        role: "user",
      });
      await AsyncStorage.setItem("hostAppPending", "true");
      router.push("/host/auth/host-profile-setup");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not create account. Email may already be in use.");
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

        {/* Step indicators */}
        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
              <View style={[s.stepDot, i === 0 ? s.stepDotActive : s.stepDotInactive]}>
                <Text style={[s.stepNum, i === 0 ? s.stepNumActive : s.stepNumInactive]}>{i + 1}</Text>
              </View>
              <Text style={[s.stepLabel, i === 0 ? s.stepLabelActive : s.stepLabelInactive]}>{step}</Text>
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
        <Text style={s.sectionTitle}>Create your account</Text>
        <Text style={s.sectionSub}>You'll use these credentials to sign in later</Text>

        <View style={s.inputWrap}>
          <Feather name="user" size={18} color="#84889F" />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Full name"
            placeholderTextColor="#84889F"
            style={s.input}
            autoCapitalize="words"
          />
        </View>

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
            placeholder="Password (min 6 chars)"
            placeholderTextColor="#84889F"
            style={s.input}
            secureTextEntry={!showPw}
          />
          <TouchableOpacity onPress={() => setShowPw(!showPw)}>
            <Feather name={showPw ? "eye-off" : "eye"} size={18} color="#84889F" />
          </TouchableOpacity>
        </View>

        <PrimaryButton title="Continue →  Profile Setup" onPress={handleNext} loading={loading} />

        <TouchableOpacity onPress={() => router.push("/host/auth/host-login")} style={s.loginRow}>
          <Text style={s.loginTxt}>Already registered? </Text>
          <Text style={s.loginLink}>Sign In</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  backBtn: { marginBottom: 12, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff", marginBottom: 4 },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.7)", marginBottom: 20 },
  steps: { flexDirection: "row", gap: 0 },
  stepItem: { flex: 1, alignItems: "center", gap: 4 },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotActive: { backgroundColor: "#A00EE7" },
  stepDotInactive: { backgroundColor: "rgba(255,255,255,0.15)" },
  stepNum: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  stepNumActive: { color: "#fff" },
  stepNumInactive: { color: "rgba(255,255,255,0.5)" },
  stepLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", textAlign: "center" },
  stepLabelActive: { color: "#fff" },
  stepLabelInactive: { color: "rgba(255,255,255,0.4)" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  sectionTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: "#111329" },
  sectionSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: -8, marginBottom: 4 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0, color: "#111329" },
  loginRow: { flexDirection: "row", justifyContent: "center" },
  loginTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  loginLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
