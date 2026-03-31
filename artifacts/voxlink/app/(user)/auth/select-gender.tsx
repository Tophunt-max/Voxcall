import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function SelectGenderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<"male" | "female" | null>(null);
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!selected) {
      Alert.alert("Select Gender", "Please select your gender to continue");
      return;
    }
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    setLoading(false);
    router.replace("/screens/user");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 30 }]}>
      <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
        <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.text }]}>Select Your Gender</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        This helps us personalize your experience
      </Text>

      <View style={styles.cardsRow}>
        <TouchableOpacity
          onPress={() => setSelected("male")}
          style={[
            styles.genderCard,
            {
              backgroundColor: selected === "male" ? "#F0E4F8" : colors.card,
              borderColor: selected === "male" ? colors.accent : colors.border,
              ...Platform.select({
                ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
                android: { elevation: 3 },
                web: { boxShadow: "0 4px 12px rgba(0,0,0,0.08)" } as any,
              }),
            }
          ]}
          activeOpacity={0.8}
        >
          <Image source={require("@/assets/images/avatar_male.png")} style={styles.genderImg} resizeMode="contain" />
          <Text style={[styles.genderLabel, { color: selected === "male" ? colors.accent : colors.text }]}>Male</Text>
          {selected === "male" && (
            <View style={[styles.checkCircle, { backgroundColor: colors.accent }]}>
              <Image source={require("@/assets/icons/ic_check.png")} style={styles.checkIcon} tintColor="#fff" resizeMode="contain" />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setSelected("female")}
          style={[
            styles.genderCard,
            {
              backgroundColor: selected === "female" ? "#F0E4F8" : colors.card,
              borderColor: selected === "female" ? colors.accent : colors.border,
              ...Platform.select({
                ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
                android: { elevation: 3 },
                web: { boxShadow: "0 4px 12px rgba(0,0,0,0.08)" } as any,
              }),
            }
          ]}
          activeOpacity={0.8}
        >
          <Image source={require("@/assets/images/avatar_female.png")} style={styles.genderImg} resizeMode="contain" />
          <Text style={[styles.genderLabel, { color: selected === "female" ? colors.accent : colors.text }]}>Female</Text>
          {selected === "female" && (
            <View style={[styles.checkCircle, { backgroundColor: colors.accent }]}>
              <Image source={require("@/assets/icons/ic_check.png")} style={styles.checkIcon} tintColor="#fff" resizeMode="contain" />
            </View>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary, opacity: loading || !selected ? 0.7 : 1 }]}
        onPress={handleContinue}
        disabled={loading || !selected}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>{loading ? "Saving..." : "Continue"}</Text>
      </TouchableOpacity>
    </View>
  );
}

import { Platform } from "react-native";

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  backIcon: { width: 18, height: 18 },
  title: { fontSize: 26, fontFamily: "Poppins_700Bold", marginBottom: 8 },
  subtitle: { fontSize: 14, fontFamily: "Poppins_400Regular", marginBottom: 40, lineHeight: 22 },
  cardsRow: { flexDirection: "row", gap: 16, marginBottom: 48, justifyContent: "center" },
  genderCard: {
    flex: 1, borderRadius: 20, paddingVertical: 32, alignItems: "center", gap: 14,
    borderWidth: 2, position: "relative",
  },
  genderImg: { width: 100, height: 120 },
  genderLabel: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  checkCircle: { position: "absolute", top: 12, right: 12, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  checkIcon: { width: 14, height: 14 },
  btn: { width: "100%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
