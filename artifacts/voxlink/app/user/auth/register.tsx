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

const ACCENT = "#A00EE7";
const GENDERS: Array<{ label: string; value: "male" | "female" | "other" }> = [
  { label: "Male", value: "male" },
  { label: "Female", value: "female" },
  { label: "Other", value: "other" },
];

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [gender, setGender] = useState<"male" | "female" | "other" | "">("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password.trim() || !gender) {
      Alert.alert("Missing Fields", "Please fill in all fields including gender.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Weak Password", "Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      const data = await API.register(name.trim(), email.trim(), password, gender);
      await loginWithToken(data.token, {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        coins: data.user.coins ?? 100,
        role: "user",
        gender,
      });
      router.replace("/user/auth/fill-profile");
    } catch (err: any) {
      Alert.alert("Registration Failed", err?.message || "Could not create account. Email may already be in use.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRegister = () => {
    Alert.alert("Coming Soon", "Google Sign-Up will be available in the next update.");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={["#A00EE7", "#6A00B8"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={s.iconBg}>
            <Feather name="user-plus" size={28} color="#fff" />
          </View>
          <Text style={s.headerTitle}>Create Account</Text>
          <Text style={s.headerSub}>Join VoxLink and start connecting</Text>
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.form, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={handleGoogleRegister} style={s.googleBtn} activeOpacity={0.8}>
          <View style={s.googleIco}>
            <Text style={{ fontSize: 18 }}>G</Text>
          </View>
          <Text style={s.googleTxt}>Sign up with Google</Text>
        </TouchableOpacity>

        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divTxt}>or sign up with email</Text>
          <View style={s.divLine} />
        </View>

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

        <Text style={s.label}>Gender</Text>
        <View style={s.genderRow}>
          {GENDERS.map((g) => (
            <TouchableOpacity
              key={g.value}
              onPress={() => setGender(g.value)}
              style={[s.genderBtn, gender === g.value && s.genderBtnActive]}
              activeOpacity={0.75}
            >
              <Text style={[s.genderTxt, gender === g.value && s.genderTxtActive]}>{g.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <PrimaryButton title="Create Account" onPress={handleRegister} loading={loading} />

        <TouchableOpacity onPress={() => router.back()} style={s.loginRow}>
          <Text style={s.loginTxt}>Already have an account? </Text>
          <Text style={s.loginLink}>Sign In</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 32 },
  backBtn: { marginBottom: 16, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerCenter: { alignItems: "center", gap: 8 },
  iconBg: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.75)", textAlign: "center" },
  form: { paddingHorizontal: 24, paddingTop: 24, gap: 14 },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#E8EAF0" },
  googleIco: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#E8EAF0", alignItems: "center", justifyContent: "center" },
  googleTxt: { fontSize: 15, fontFamily: "Poppins_500Medium", color: "#111329" },
  divRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1, backgroundColor: "#E8EAF0" },
  divTxt: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F" },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0, color: "#111329" },
  label: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#111329", marginBottom: -6 },
  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E8EAF0", alignItems: "center", backgroundColor: "#F8F9FC" },
  genderBtnActive: { borderColor: "#A00EE7", backgroundColor: "#F4E8FD" },
  genderTxt: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#84889F" },
  genderTxtActive: { color: "#A00EE7" },
  loginRow: { flexDirection: "row", justifyContent: "center" },
  loginTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  loginLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#A00EE7" },
});
