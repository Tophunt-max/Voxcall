import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Image, KeyboardAvoidingView, Platform, Alert
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function VerifyOtpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email: string; mode: string }>();
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(59);
  const inputRefs = useRef<TextInput[]>([]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setInterval(() => setResendTimer(v => v - 1), 1000);
    return () => clearInterval(t);
  }, [resendTimer]);

  const handleOtpChange = (text: string, index: number) => {
    const newOtp = [...otp];
    newOtp[index] = text;
    setOtp(newOtp);
    if (text && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < 6) {
      Alert.alert("Error", "Please enter the complete 6-digit OTP");
      return;
    }
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setLoading(false);
    if (params.mode === "forgot") {
      router.push({ pathname: "/auth/create-password", params: { email: params.email } });
    } else {
      router.push({ pathname: "/auth/fill-profile" });
    }
  };

  const handleResend = () => {
    setResendTimer(59);
    setOtp(["", "", "", "", "", ""]);
    Alert.alert("OTP Sent", "A new OTP has been sent to your email.");
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <View style={[styles.iconBg, { backgroundColor: "#F0E4F8" }]}>
            <Image source={require("@/assets/icons/ic_mail.png")} style={styles.icon} tintColor={colors.accent} resizeMode="contain" />
          </View>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Verify OTP</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          We've sent a 6-digit verification code to{"\n"}
          <Text style={{ color: colors.text, fontFamily: "Poppins_600SemiBold" }}>{params.email || "your email"}</Text>
        </Text>

        <View style={styles.otpRow}>
          {otp.map((digit, i) => (
            <TextInput
              key={i}
              ref={r => { if (r) inputRefs.current[i] = r; }}
              style={[
                styles.otpBox,
                {
                  backgroundColor: colors.surface,
                  borderColor: digit ? colors.accent : colors.border,
                  color: colors.text,
                }
              ]}
              value={digit}
              onChangeText={t => handleOtpChange(t.slice(-1), i)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
              keyboardType="numeric"
              maxLength={1}
              textAlign="center"
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
          onPress={handleVerify}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>{loading ? "Verifying..." : "Verify OTP"}</Text>
        </TouchableOpacity>

        <View style={styles.resendRow}>
          <Text style={[styles.resendLabel, { color: colors.mutedForeground }]}>Didn't receive code? </Text>
          {resendTimer > 0 ? (
            <Text style={[styles.resendTimer, { color: colors.accent }]}>Resend in {resendTimer}s</Text>
          ) : (
            <TouchableOpacity onPress={handleResend}>
              <Text style={[styles.resendBtn, { color: colors.accent }]}>Resend OTP</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, alignItems: "center" },
  backBtn: { alignSelf: "flex-start", width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  backIcon: { width: 18, height: 18 },
  iconWrap: { marginBottom: 24 },
  iconBg: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  icon: { width: 36, height: 36 },
  title: { fontSize: 26, fontFamily: "Poppins_700Bold", marginBottom: 10, textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 22, marginBottom: 32 },
  otpRow: { flexDirection: "row", gap: 10, marginBottom: 32 },
  otpBox: { width: 48, height: 56, borderRadius: 12, borderWidth: 2, fontSize: 22, fontFamily: "Poppins_700Bold" },
  btn: { width: "100%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  resendRow: { flexDirection: "row", alignItems: "center" },
  resendLabel: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  resendTimer: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  resendBtn: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
});
