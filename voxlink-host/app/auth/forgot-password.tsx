import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from "react-native";
import AppInput from "@/components/AppInput";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { API } from "@/services/api";

const BG     = "#0A0B1E";
const ACCENT = "#A00EE7";
const DARK   = "#111329";

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail]       = useState("");
  const [otp, setOtp]           = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startCooldown = () => {
    setCooldown(60);
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) { clearInterval(timerRef.current!); timerRef.current = null; return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSend = async () => {
    if (!email.trim()) { showErrorToast("Please enter your email address."); return; }
    setLoading(true);
    try {
      await API.forgotPassword(email.trim().toLowerCase());
      setSent(true);
      startCooldown();
      showSuccessToast("OTP sent to your email.", "Email Sent");
    } catch (err: any) {
      showErrorToast(err?.message || "Email not found. Please check and try again.");
    } finally { setLoading(false); }
  };

  const handleReset = async () => {
    if (!otp.trim() || otp.trim().length < 6) {
      showErrorToast("Please enter the OTP sent to your email."); return;
    }
    if (!password || password.length < 8) {
      showErrorToast("Password must be at least 8 characters.", "Weak Password"); return;
    }
    if (password !== confirm) {
      showErrorToast("Passwords don't match.", "Mismatch"); return;
    }
    setLoading(true);
    try {
      await API.resetPassword(email.trim().toLowerCase(), otp.trim(), password);
      showSuccessToast("Password updated successfully! Please sign in.", "Success");
      router.replace("/auth/login");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to reset password. The OTP may have expired.");
    } finally { setLoading(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Dark top section ── */}
          <View style={[s.top, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
              <Image source={require("@/assets/icons/ic_back.png")} style={s.backIcon} tintColor="rgba(255,255,255,0.85)" resizeMode="contain" />
            </TouchableOpacity>

            <View style={s.topCenter}>
              {sent ? (
                <View style={s.sentIconWrap}>
                  <LinearGradient colors={["#22C55E33", "#22C55E11"]} style={s.sentIconBg}>
                    <Image source={require("@/assets/icons/ic_mail.png")} style={s.sentIcon} tintColor="#22C55E" resizeMode="contain" />
                  </LinearGradient>
                </View>
              ) : (
                <View style={s.logoWrap}>
                  <Image source={require("@/assets/images/app_logo.png")} style={s.logoImg} resizeMode="contain" />
                </View>
              )}
              <Text style={s.topTitle}>{sent ? "Check Your Email" : "Forgot Password?"}</Text>
              <Text style={s.topSub}>
                {sent
                  ? `We sent a 6-digit OTP to\n${email}\n\nEnter the code and set a new password.`
                  : "Enter your registered email. We'll send an OTP to reset your password."}
              </Text>
            </View>
          </View>

          {/* ── White card ── */}
          <View style={[s.card, { paddingBottom: insets.bottom + 36 }]}>
            <View style={s.handle} />

            {sent ? (
              <>
                <Text style={s.cardTitle}>Reset Password</Text>
                <AppInput
                  placeholder="Enter OTP Code"
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  icon={<Image source={require("@/assets/icons/ic_check.png")} style={s.inputIcon} tintColor="#9B9FB8" resizeMode="contain" />}
                />
                <AppInput
                  placeholder="New Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPass}
                  icon={<Image source={require("@/assets/icons/ic_secure.png")} style={s.inputIcon} tintColor="#9B9FB8" resizeMode="contain" />}
                  right={
                    <TouchableOpacity onPress={() => setShowPass(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Image source={showPass ? require("@/assets/icons/ic_eye_off.png") : require("@/assets/icons/ic_eye.png")} style={s.inputIcon} tintColor="#9B9FB8" resizeMode="contain" />
                    </TouchableOpacity>
                  }
                />
                <AppInput
                  placeholder="Confirm New Password"
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry={!showConf}
                  icon={<Image source={require("@/assets/icons/ic_secure.png")} style={s.inputIcon} tintColor="#9B9FB8" resizeMode="contain" />}
                  right={
                    <TouchableOpacity onPress={() => setShowConf(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Image source={showConf ? require("@/assets/icons/ic_eye_off.png") : require("@/assets/icons/ic_eye.png")} style={s.inputIcon} tintColor="#9B9FB8" resizeMode="contain" />
                    </TouchableOpacity>
                  }
                />
                <TouchableOpacity style={[s.primaryBtnWrap, loading && { opacity: 0.7 }]} onPress={handleReset} disabled={loading} activeOpacity={0.85}>
                  <LinearGradient colors={[ACCENT, "#6A00B8"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.primaryBtn}>
                    <Text style={s.primaryBtnTxt}>{loading ? "Resetting..." : "Reset Password"}</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { if (cooldown > 0 || loading) return; startCooldown(); handleSend(); }}
                  style={s.resendRow}
                  disabled={loading || cooldown > 0}
                >
                  <Text style={s.resendTxt}>
                    Didn't receive it?{" "}
                    {cooldown > 0
                      ? <Text style={s.resendCooldown}>Resend in {cooldown}s</Text>
                      : <Text style={s.resendLink}>Resend OTP</Text>}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.cardTitle}>Find your account</Text>
                <AppInput
                  icon={<Image source={require("@/assets/icons/ic_mail.png")} style={s.inputIcon} tintColor="#9B9FB8" resizeMode="contain" />}
                  placeholder="Email Address"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TouchableOpacity style={[s.primaryBtnWrap, loading && { opacity: 0.7 }]} onPress={handleSend} disabled={loading} activeOpacity={0.85}>
                  <LinearGradient colors={[ACCENT, "#6A00B8"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.primaryBtn}>
                    <Text style={s.primaryBtnTxt}>{loading ? "Sending..." : "Send OTP"}</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.back()} style={s.backToLogin}>
                  <Text style={s.backToLoginTxt}>
                    Back to <Text style={s.backToLoginLink}>Sign In</Text>
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingBottom: 32 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  backIcon: { width: 20, height: 20 },
  topCenter: { alignItems: "center", gap: 10 },
  logoWrap: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: "rgba(160,14,231,0.15)",
    borderWidth: 1.5, borderColor: "rgba(160,14,231,0.3)",
    alignItems: "center", justifyContent: "center",
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45, shadowRadius: 18, elevation: 12,
  },
  logoImg: { width: 46, height: 46, borderRadius: 12 },
  sentIconWrap: { marginBottom: 4 },
  sentIconBg: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#22C55E40",
  },
  sentIcon: { width: 38, height: 38 },
  topTitle: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#fff", textAlign: "center" },
  topSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 20 },

  card: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    paddingHorizontal: 24, paddingTop: 16, flex: 1, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 10,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E0E3F0", alignSelf: "center", marginBottom: 10 },
  cardTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: DARK },
  inputIcon: { width: 18, height: 18 },

  primaryBtnWrap: {
    borderRadius: 16, overflow: "hidden",
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38, shadowRadius: 14, elevation: 8, marginTop: 4,
  },
  primaryBtn: { paddingVertical: 16, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  primaryBtnTxt: { fontSize: 16, fontFamily: "Poppins_700Bold", color: "#fff", letterSpacing: 0.3 },

  resendRow: { alignItems: "center" },
  resendTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  resendCooldown: { fontFamily: "Poppins_600SemiBold", color: "#84889F" },
  resendLink: { fontFamily: "Poppins_600SemiBold", color: ACCENT },

  backToLogin: { alignItems: "center", marginTop: 4 },
  backToLoginTxt: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  backToLoginLink: { fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
