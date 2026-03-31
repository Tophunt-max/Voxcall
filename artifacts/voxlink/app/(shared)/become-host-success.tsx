import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function BecomeHostSuccessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}>
      <View style={styles.content}>
        <Image source={require("@/assets/images/request_sent.png")} style={styles.heroImg} resizeMode="contain" />

        <Text style={[styles.title, { color: colors.text }]}>Request Sent!</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Your host application has been submitted successfully. Our team will review your request and get back to you within 2-3 business days.
        </Text>

        <View style={[styles.infoCard, { backgroundColor: "#F0E4F8" }]}>
          <Image source={require("@/assets/icons/ic_notify.png")} style={styles.infoIcon} tintColor={colors.accent} resizeMode="contain" />
          <Text style={[styles.infoText, { color: colors.text }]}>You'll receive an email notification once your application is reviewed.</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary }]}
        onPress={() => router.replace("/screens/user")}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>Back to Home</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between" },
  content: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  heroImg: { width: 200, height: 180, marginBottom: 8 },
  title: { fontSize: 26, fontFamily: "Poppins_700Bold", textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 22, paddingHorizontal: 10 },
  infoCard: { borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, width: "100%" },
  infoIcon: { width: 24, height: 24 },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 20 },
  btn: { width: "100%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
