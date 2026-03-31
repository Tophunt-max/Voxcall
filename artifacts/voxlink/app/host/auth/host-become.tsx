// Host Registration — Step 3: Host Info (specialties, rates, bio)
import React, { useState } from "react";
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

const DARK = "#111329";
const ACCENT = "#A00EE7";
const STEPS = ["Account", "Profile", "Host Info", "KYC Docs"];

const SPECIALTY_OPTIONS = [
  "Motivation", "Astrology", "Relationship", "Comedy",
  "Music", "Yoga", "Gaming", "Study Help", "Cooking", "Fitness",
];
const LANGUAGE_OPTIONS = ["Hindi", "English", "Tamil", "Telugu", "Kannada", "Bengali", "Marathi", "Punjabi"];

export default function HostBecomeScreen() {
  const insets = useSafeAreaInsets();
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>(["Hindi"]);
  const [bio, setBio] = useState("");
  const [audioRate, setAudioRate] = useState("5");
  const [videoRate, setVideoRate] = useState("8");
  const [experience, setExperience] = useState("");
  const [loading, setLoading] = useState(false);

  const toggle = (list: string[], setList: Function, val: string) => {
    setList((prev: string[]) =>
      prev.includes(val) ? prev.filter((x: string) => x !== val) : [...prev, val]
    );
  };

  const handleNext = () => {
    if (specialties.length === 0) {
      Alert.alert("Select Specialty", "Choose at least one specialty.");
      return;
    }
    if (!bio.trim() || bio.trim().length < 20) {
      Alert.alert("Bio Too Short", "Please write a bio of at least 20 characters.");
      return;
    }
    // Pass data via router params to KYC step
    router.push({
      pathname: "/host/auth/host-kyc",
      params: {
        specialties: JSON.stringify(specialties),
        languages: JSON.stringify(languages),
        bio: bio.trim(),
        audioRate,
        videoRate,
        experience: experience.trim(),
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={[DARK, "#2D3057"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Become a Host</Text>
        <Text style={s.headerSub}>Step 3 of 4 — Host Info</Text>
        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
              <View style={[s.stepDot, i <= 2 ? s.stepDotActive : s.stepDotInactive]}>
                {i < 2 ? (
                  <Feather name="check" size={14} color="#fff" />
                ) : (
                  <Text style={[s.stepNum, i === 2 ? s.stepNumActive : s.stepNumInactive]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[s.stepLabel, i <= 2 ? s.stepLabelActive : s.stepLabelInactive]}>{step}</Text>
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
        <Text style={s.sectionTitle}>Your Host Profile</Text>
        <Text style={s.sectionSub}>Help users understand what you offer</Text>

        <Text style={s.fieldLabel}>Specialties (pick 1–5)</Text>
        <View style={s.chipWrap}>
          {SPECIALTY_OPTIONS.map((sp) => (
            <TouchableOpacity
              key={sp}
              onPress={() => toggle(specialties, setSpecialties, sp)}
              style={[s.chip, specialties.includes(sp) && s.chipActive]}
              activeOpacity={0.75}
            >
              <Text style={[s.chipTxt, specialties.includes(sp) && s.chipTxtActive]}>{sp}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.fieldLabel}>Languages</Text>
        <View style={s.chipWrap}>
          {LANGUAGE_OPTIONS.map((lang) => (
            <TouchableOpacity
              key={lang}
              onPress={() => toggle(languages, setLanguages, lang)}
              style={[s.chip, languages.includes(lang) && s.chipActive]}
              activeOpacity={0.75}
            >
              <Text style={[s.chipTxt, languages.includes(lang) && s.chipTxtActive]}>{lang}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.fieldLabel}>Bio</Text>
        <View style={[s.inputWrap, s.textareaWrap]}>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Tell users about yourself — your expertise, personality, and what makes your calls special..."
            placeholderTextColor="#84889F"
            style={[s.input, s.textarea]}
            multiline
            numberOfLines={4}
          />
        </View>

        <Text style={s.fieldLabel}>Experience (optional)</Text>
        <View style={s.inputWrap}>
          <Feather name="briefcase" size={18} color="#84889F" />
          <TextInput
            value={experience}
            onChangeText={setExperience}
            placeholder="e.g. 3 years as life coach"
            placeholderTextColor="#84889F"
            style={s.input}
          />
        </View>

        <Text style={s.fieldLabel}>Your Call Rates (coins/min)</Text>
        <View style={s.ratesRow}>
          <View style={s.rateCard}>
            <Feather name="mic" size={18} color={DARK} />
            <Text style={s.rateLabel}>Audio</Text>
            <View style={s.rateInputWrap}>
              <TextInput
                value={audioRate}
                onChangeText={setAudioRate}
                style={s.rateInput}
                keyboardType="numeric"
              />
              <Text style={s.rateSuffix}>coins/min</Text>
            </View>
          </View>
          <View style={s.rateCard}>
            <Feather name="video" size={18} color={DARK} />
            <Text style={s.rateLabel}>Video</Text>
            <View style={s.rateInputWrap}>
              <TextInput
                value={videoRate}
                onChangeText={setVideoRate}
                style={s.rateInput}
                keyboardType="numeric"
              />
              <Text style={s.rateSuffix}>coins/min</Text>
            </View>
          </View>
        </View>

        <View style={s.noteBanner}>
          <Feather name="info" size={14} color="#84889F" />
          <Text style={s.noteTxt}>Rates are suggestions. Admin may adjust them after approval.</Text>
        </View>

        <PrimaryButton title="Continue →  KYC Documents" onPress={handleNext} loading={loading} />
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
  fieldLabel: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#111329", marginBottom: -6 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC" },
  chipActive: { borderColor: ACCENT, backgroundColor: "#F4E8FD" },
  chipTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F" },
  chipTxtActive: { color: ACCENT, fontFamily: "Poppins_500Medium" },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  textareaWrap: { alignItems: "flex-start", paddingVertical: 12 },
  input: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular", padding: 0, color: "#111329" },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  ratesRow: { flexDirection: "row", gap: 12 },
  rateCard: { flex: 1, backgroundColor: "#F8F9FC", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", padding: 14, gap: 4 },
  rateLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "#84889F" },
  rateInputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  rateInput: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#111329", padding: 0, minWidth: 40 },
  rateSuffix: { fontSize: 11, fontFamily: "Poppins_400Regular", color: "#84889F" },
  noteBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFF8E7", borderRadius: 10, padding: 12 },
  noteTxt: { flex: 1, fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F" },
});
