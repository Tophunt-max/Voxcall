import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, KeyboardAvoidingView, Platform, ScrollView
} from "react-native";
import AppInput from "@/components/AppInput";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { API } from "@/services/api";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) {
      showErrorToast("Please enter your email address.");
      return;
    }
    setLoading(true);
    try {
      await API.forgotPassword(email.trim().toLowerCase());
      setSent(true);
      showSuccessToast("OTP sent to your email.", "Email Sent");
    } catch (err: any) {
      showErrorToast(err?.message || "Email not found. Please check and try again.");
    } finally {
      setLoading(false);
    }
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

        {sent ? (
          <>
            <View style={[styles.successIcon, { backgroundColor: "#E8F8EC" }]}>
              <Feather name="check-circle" size={40} color="#0BAF23" />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Email Sent!</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              We've sent password reset instructions to{"\n"}<Text style={{ color: colors.primary, fontFamily: "Poppins_600SemiBold" }}>{email}</Text>.{"\n\n"}Please check your inbox and follow the link to reset your password.
            </Text>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={() => router.replace("/auth/login")}
              activeOpacity={0.85}
            >
              <Text style={styles.btnText}>Back to Sign In</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.text }]}>Forgot Password?</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Enter your registered email address. We'll send you instructions to reset your password.
            </Text>

            <AppInput
              variant="custom"
              inactiveBorder={colors.border}
              bgColor={colors.surface}
              textColor={colors.text}
              icon={<Image source={require("@/assets/icons/ic_mail.png")} style={styles.inputIcon} tintColor={colors.mutedForeground} resizeMode="contain" />}
              placeholder="Email Address"
              placeholderTextColor={colors.mutedForeground}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              wrapStyle={{ width: "100%", marginBottom: 20 }}
            />

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
              onPress={handleSend}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.btnText}>{loading ? "Sending..." : "Send Reset Link"}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.back()} style={styles.backToLogin}>
              <Text style={[styles.backToLoginText, { color: colors.mutedForeground }]}>
                Back to{" "}
                <Text style={{ color: colors.accent, fontFamily: "Poppins_600SemiBold" }}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          </>
        )}
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
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  title: { fontSize: 26, fontFamily: "Poppins_700Bold", marginBottom: 10, textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 22, marginBottom: 32, paddingHorizontal: 10 },
  inputIcon: { width: 18, height: 18, marginRight: 12 },
  btn: { width: "100%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  backToLogin: { marginTop: 8 },
  backToLoginText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
