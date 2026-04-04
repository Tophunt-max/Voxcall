// Host Registration — Step 3: Host Info (specialties, rates, bio)
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Image,
} from "react-native";
import { showErrorToast } from "@/components/Toast";
import AppInput from "@/components/AppInput";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SvgIcon } from "@/components/SvgIcon";

const BG     = "#0A0B1E";
const DARK   = "#111329";
const ACCENT = "#A00EE7";
const STEPS  = ["Account", "Profile", "Host Info", "KYC Docs"];

const SPECIALTY_OPTIONS = [
  "Motivation", "Astrology", "Relationship", "Comedy",
  "Music", "Yoga", "Gaming", "Study Help", "Cooking", "Fitness",
];
const LANGUAGE_OPTIONS = ["Hindi", "English", "Tamil", "Telugu", "Kannada", "Bengali", "Marathi", "Punjabi"];

export default function HostBecomeScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ dob?: string }>();
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [languages, setLanguages]     = useState<string[]>(["Hindi"]);
  const [bio, setBio]                 = useState("");
  const [audioRate, setAudioRate]     = useState("5");
  const [videoRate, setVideoRate]     = useState("8");
  const [experience, setExperience]   = useState("");
  const [loading, setLoading]         = useState(false);

  const toggle = (list: string[], setList: Function, val: string) => {
    setList((prev: string[]) => prev.includes(val) ? prev.filter((x: string) => x !== val) : [...prev, val]);
  };

  const handleNext = () => {
    if (specialties.length === 0) {
      showErrorToast("Choose at least one specialty.", "Select Specialty"); return;
    }
    if (!bio.trim() || bio.trim().length < 20) {
      showErrorToast("Please write a bio of at least 20 characters.", "Bio Too Short"); return;
    }
    router.push({
      pathname: "/auth/kyc",
      params: {
        specialties: JSON.stringify(specialties),
        languages: JSON.stringify(languages),
        bio: bio.trim(),
        audioRate,
        videoRate,
        experience: experience.trim(),
        dob: params.dob ?? "",
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* ── Dark gradient header ── */}
      <LinearGradient colors={[BG, "#1A1C3A"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Image source={require("@/assets/icons/ic_back.png")} style={s.backIcon} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Image source={require("@/assets/images/app_logo.png")} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Become a Host</Text>
          <Text style={s.headerSub}>Step 3 of 4 — Host Info</Text>
        </View>

        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
              <LinearGradient
                colors={i <= 2 ? [ACCENT, "#6A00B8"] : ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.12)"]}
                style={s.stepCircle}
              >
                {i < 2 ? (
                  <Image source={require("@/assets/icons/ic_check.png")} style={s.stepCheck} tintColor="#fff" resizeMode="contain" />
                ) : (
                  <Text style={[s.stepNum, i <= 2 && s.stepNumActive]}>{i + 1}</Text>
                )}
              </LinearGradient>
              <Text style={[s.stepLabel, i <= 2 && s.stepLabelActive]}>{step}</Text>
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
        <AppInput
          placeholder="Tell users about yourself — your expertise, personality, and what makes your calls special..."
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          wrapStyle={{ minHeight: 100, paddingVertical: 12 }}
        />

        <Text style={s.fieldLabel}>Experience (optional)</Text>
        <AppInput
          icon={<SvgIcon name="briefcase" size={18} color="#84889F" />}
          placeholder="e.g. 3 years as life coach"
          value={experience}
          onChangeText={setExperience}
        />

        <Text style={s.fieldLabel}>Your Call Rates (coins/min)</Text>
        <View style={s.ratesRow}>
          {/* Audio rate */}
          <View style={s.rateCard}>
            <Image source={require("@/assets/icons/ic_mic.png")} style={s.rateIcon} tintColor={DARK} resizeMode="contain" />
            <Text style={s.rateLabel}>Audio</Text>
            <View style={s.rateInputWrap}>
              <TextInput
                value={audioRate}
                onChangeText={setAudioRate}
                style={s.rateInput}
                keyboardType="numeric"
                selectionColor={ACCENT}
                underlineColorAndroid="transparent"
              />
              <Text style={s.rateSuffix}>coins/min</Text>
            </View>
          </View>
          {/* Video rate */}
          <View style={s.rateCard}>
            <Image source={require("@/assets/icons/ic_video.png")} style={s.rateIcon} tintColor={DARK} resizeMode="contain" />
            <Text style={s.rateLabel}>Video</Text>
            <View style={s.rateInputWrap}>
              <TextInput
                value={videoRate}
                onChangeText={setVideoRate}
                style={s.rateInput}
                keyboardType="numeric"
                selectionColor={ACCENT}
                underlineColorAndroid="transparent"
              />
              <Text style={s.rateSuffix}>coins/min</Text>
            </View>
          </View>
        </View>

        <View style={s.noteBanner}>
          <SvgIcon name="info" size={14} color="#84889F" />
          <Text style={s.noteTxt}>Rates are suggestions. Admin may adjust them after approval.</Text>
        </View>

        <PrimaryButton title="Continue →  KYC Documents" onPress={handleNext} loading={loading} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  backIcon: { width: 20, height: 20 },
  headerCenter: { alignItems: "center", gap: 6, marginBottom: 20 },
  headerLogo: { width: 52, height: 52, borderRadius: 14, marginBottom: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.6)" },
  steps: { flexDirection: "row", justifyContent: "space-between" },
  stepItem: { alignItems: "center", gap: 5 },
  stepCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  stepCheck: { width: 14, height: 14 },
  stepNum: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "rgba(255,255,255,0.5)" },
  stepNumActive: { color: "#fff" },
  stepLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.45)" },
  stepLabelActive: { color: "rgba(200,140,255,0.9)", fontFamily: "Poppins_600SemiBold" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  sectionTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: DARK },
  sectionSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: -8, marginBottom: 4 },
  fieldLabel: { fontSize: 14, fontFamily: "Poppins_500Medium", color: DARK, marginBottom: -6 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC" },
  chipActive: { borderColor: ACCENT, backgroundColor: "#F4E8FD" },
  chipTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F" },
  chipTxtActive: { color: ACCENT, fontFamily: "Poppins_500Medium" },
  ratesRow: { flexDirection: "row", gap: 12 },
  rateCard: { flex: 1, backgroundColor: "#F8F9FC", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", padding: 14, gap: 4 },
  rateIcon: { width: 20, height: 20 },
  rateLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "#84889F" },
  rateInputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  rateInput: { fontSize: 20, fontFamily: "Poppins_700Bold", color: DARK, padding: 0, minWidth: 40 },
  rateSuffix: { fontSize: 11, fontFamily: "Poppins_400Regular", color: "#84889F" },
  noteBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFF8E7", borderRadius: 10, padding: 12 },
  noteTxt: { flex: 1, fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F" },
});
