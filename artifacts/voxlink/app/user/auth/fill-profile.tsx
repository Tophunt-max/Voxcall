import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Image, ScrollView, Platform, Alert
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

const LANGUAGES = ["English", "Hindi", "Spanish", "French", "Arabic", "German", "Chinese", "Japanese"];

export default function FillProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [bio, setBio] = useState("");
  const [selectedLang, setSelectedLang] = useState<string[]>(["English"]);
  const [loading, setLoading] = useState(false);

  const toggleLanguage = (lang: string) => {
    setSelectedLang(prev =>
      prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
    );
  };

  const handleContinue = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Please enter your name");
      return;
    }
    setLoading(true);
    await new Promise(r => setTimeout(r, 800));
    setLoading(false);
    router.push("/user/auth/select-gender");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
        <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.text }]}>Fill Your Profile</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Complete your profile to get started</Text>

      <TouchableOpacity style={styles.avatarWrap}>
        <Image source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "new"}` }} style={styles.avatar} />
        <View style={[styles.editBadge, { backgroundColor: colors.accent }]}>
          <Image source={require("@/assets/icons/ic_edit.png")} style={styles.editIcon} resizeMode="contain" />
        </View>
      </TouchableOpacity>

      <Text style={[styles.label, { color: colors.text }]}>Full Name</Text>
      <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="Enter your name"
          placeholderTextColor={colors.mutedForeground}
          value={name}
          onChangeText={setName}
        />
      </View>

      <Text style={[styles.label, { color: colors.text }]}>Bio <Text style={{ color: colors.mutedForeground }}>(Optional)</Text></Text>
      <View style={[styles.textareaWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          style={[styles.textarea, { color: colors.text }]}
          placeholder="Tell us about yourself..."
          placeholderTextColor={colors.mutedForeground}
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      <Text style={[styles.label, { color: colors.text }]}>Language</Text>
      <View style={styles.langGrid}>
        {LANGUAGES.map(lang => (
          <TouchableOpacity
            key={lang}
            onPress={() => toggleLanguage(lang)}
            style={[
              styles.langChip,
              {
                backgroundColor: selectedLang.includes(lang) ? colors.accent : colors.surface,
                borderColor: selectedLang.includes(lang) ? colors.accent : colors.border,
              }
            ]}
          >
            {selectedLang.includes(lang) && (
              <Image source={require("@/assets/icons/ic_check.png")} style={styles.checkIcon} tintColor="#fff" resizeMode="contain" />
            )}
            <Text style={[styles.langText, { color: selectedLang.includes(lang) ? "#fff" : colors.text }]}>{lang}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
        onPress={handleContinue}
        disabled={loading}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>{loading ? "Saving..." : "Continue"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, alignItems: "center" },
  backBtn: { alignSelf: "flex-start", width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  backIcon: { width: 18, height: 18 },
  title: { fontSize: 24, fontFamily: "Poppins_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 13, fontFamily: "Poppins_400Regular", marginBottom: 28 },
  avatarWrap: { marginBottom: 28, position: "relative" },
  avatar: { width: 100, height: 100, borderRadius: 50 },
  editBadge: { position: "absolute", bottom: 0, right: 0, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  editIcon: { width: 14, height: 14, tintColor: "#fff" },
  label: { alignSelf: "flex-start", fontSize: 14, fontFamily: "Poppins_600SemiBold", marginBottom: 8 },
  inputWrap: { width: "100%", borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, height: 54, justifyContent: "center", marginBottom: 16 },
  input: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular" },
  textareaWrap: { width: "100%", borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16, minHeight: 90 },
  textarea: { fontSize: 14, fontFamily: "Poppins_400Regular", minHeight: 60 },
  langGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 28, alignSelf: "flex-start" },
  langChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  checkIcon: { width: 12, height: 12 },
  langText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  btn: { width: "100%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
