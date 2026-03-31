// Host Registration — Step 2: Profile Info
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";

const DARK = "#111329";
const ACCENT = "#A00EE7";
const STEPS = ["Account", "Profile", "Host Info", "KYC Docs"];
const GENDERS: Array<{ label: string; value: string }> = [
  { label: "Male", value: "male" },
  { label: "Female", value: "female" },
  { label: "Other", value: "other" },
];

export default function HostProfileSetupScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState(user?.gender ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [loading, setLoading] = useState(false);

  const handleNext = async () => {
    if (!displayName.trim() || !dob.trim() || !gender || !phone.trim()) {
      Alert.alert("Missing Fields", "Please fill in all required fields.");
      return;
    }
    if (!/^\d{10,15}$/.test(phone.replace(/[\s\-\+]/g, ""))) {
      Alert.alert("Invalid Phone", "Please enter a valid mobile number.");
      return;
    }
    setLoading(true);
    await updateProfile({ name: displayName.trim(), gender: gender as any, phone: phone.trim() });
    setLoading(false);
    router.push("/host/auth/host-become");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={[DARK, "#2D3057"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Become a Host</Text>
        <Text style={s.headerSub}>Step 2 of 4 — Your Profile</Text>
        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
              <View style={[s.stepDot, i <= 1 ? s.stepDotActive : s.stepDotInactive]}>
                {i < 1 ? (
                  <Feather name="check" size={14} color="#fff" />
                ) : (
                  <Text style={[s.stepNum, i === 1 ? s.stepNumActive : s.stepNumInactive]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[s.stepLabel, i <= 1 ? s.stepLabelActive : s.stepLabelInactive]}>{step}</Text>
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
        <Text style={s.sectionTitle}>Your Profile Info</Text>
        <Text style={s.sectionSub}>This will be visible to users calling you</Text>

        <View style={s.inputWrap}>
          <Feather name="user" size={18} color="#84889F" />
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Display name"
            placeholderTextColor="#84889F"
            style={s.input}
            autoCapitalize="words"
          />
        </View>

        <View style={s.inputWrap}>
          <Feather name="calendar" size={18} color="#84889F" />
          <TextInput
            value={dob}
            onChangeText={setDob}
            placeholder="Date of birth (DD/MM/YYYY)"
            placeholderTextColor="#84889F"
            style={s.input}
            keyboardType="numeric"
          />
        </View>

        <View style={s.inputWrap}>
          <Feather name="phone" size={18} color="#84889F" />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Mobile number"
            placeholderTextColor="#84889F"
            style={s.input}
            keyboardType="phone-pad"
          />
        </View>

        <Text style={s.fieldLabel}>Gender</Text>
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

        <PrimaryButton title="Continue →  Host Info" onPress={handleNext} loading={loading} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  backBtn: { marginBottom: 12, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff", marginBottom: 4 },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.7)", marginBottom: 20 },
  steps: { flexDirection: "row" },
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
  fieldLabel: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#111329", marginBottom: -6 },
  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E8EAF0", alignItems: "center", backgroundColor: "#F8F9FC" },
  genderBtnActive: { borderColor: ACCENT, backgroundColor: "#F4E8FD" },
  genderTxt: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#84889F" },
  genderTxtActive: { color: ACCENT },
});
