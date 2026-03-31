import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Image, KeyboardAvoidingView, Platform, ScrollView, Alert
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    if (!email.trim()) {
      Alert.alert("Error", "Please enter your email address");
      return;
    }
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setLoading(false);
    router.push({ pathname: "/user/auth/verify-otp", params: { email, mode: "forgot" } });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>

        <View style={styles.logoWrap}>
          <Image source={require("@/assets/images/app_logo.png")} style={styles.logo} resizeMode="contain" />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Forgot Password?</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Enter your registered email address. We'll send you a verification code to reset your password.
        </Text>

        <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Image source={require("@/assets/icons/ic_mail.png")} style={styles.inputIcon} tintColor={colors.mutedForeground} resizeMode="contain" />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Email Address"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
          onPress={handleSendOTP}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>{loading ? "Sending..." : "Send OTP"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()} style={styles.backToLogin}>
          <Text style={[styles.backToLoginText, { color: colors.mutedForeground }]}>
            Back to{" "}
            <Text style={{ color: colors.accent, fontFamily: "Poppins_600SemiBold" }}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, alignItems: "center" },
  backBtn: { alignSelf: "flex-start", width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  backIcon: { width: 18, height: 18 },
  logoWrap: { marginBottom: 24 },
  logo: { width: 80, height: 80 },
  title: { fontSize: 26, fontFamily: "Poppins_700Bold", marginBottom: 10, textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 22, marginBottom: 32, paddingHorizontal: 10 },
  inputWrap: { flexDirection: "row", alignItems: "center", width: "100%", borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, marginBottom: 20, height: 54 },
  inputIcon: { width: 18, height: 18, marginRight: 12 },
  input: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular" },
  btn: { width: "100%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  backToLogin: { marginTop: 8 },
  backToLoginText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
