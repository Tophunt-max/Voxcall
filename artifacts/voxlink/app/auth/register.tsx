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

const ACCENT = "#A00EE7";

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
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
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    await login({
      id: "user_" + Date.now(),
      name: name.trim(),
      email: email.trim(),
      gender,
      coins: 100,
      role: "user",
    });
    setLoading(false);
    router.replace("/auth/fill-profile");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={["#A00EE7", "#6A00B8"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={s.iconBg}>
            <Image
              source={require("@/assets/icons/ic_profile.png")}
              style={s.headerIco}
              tintColor="#fff"
              resizeMode="contain"
            />
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
            placeholder="Password (min 8 chars)"
            placeholderTextColor="#84889F"
            style={s.input}
            secureTextEntry={!showPw}
          />
          <TouchableOpacity onPress={() => setShowPw(!showPw)}>
            <Feather name={showPw ? "eye-off" : "eye"} size={18} color="#84889F" />
          </TouchableOpacity>
        </View>

        <Text style={s.label}>I am</Text>
        <View style={s.genderRow}>
          {(["male", "female", "other"] as const).map((g) => (
            <TouchableOpacity
              key={g}
              onPress={() => setGender(g)}
              style={[
                s.genderBtn,
                gender === g && { borderColor: ACCENT, backgroundColor: ACCENT + "18" },
              ]}
              activeOpacity={0.75}
            >
              <Text style={[s.genderTxt, gender === g && { color: ACCENT }]}>
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <PrimaryButton title="Create Account" onPress={handleRegister} loading={loading} />

        <TouchableOpacity onPress={() => router.replace("/auth/login")} style={s.loginRow}>
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
  headerIco: { width: 34, height: 34 },
  headerTitle: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.75)", textAlign: "center" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0, color: "#111329" },
  label: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#111329" },
  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", alignItems: "center" },
  genderTxt: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#84889F" },
  loginRow: { flexDirection: "row", justifyContent: "center" },
  loginTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  loginLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
