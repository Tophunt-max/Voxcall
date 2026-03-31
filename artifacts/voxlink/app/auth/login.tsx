import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, Platform, Image } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Missing Fields", "Please enter both email and password.");
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    await login({
      id: "user_" + Date.now(),
      name: email.split("@")[0].replace(/[^a-z]/gi, " ").trim() || "User",
      email: email.trim(),
      coins: 150,
      role: "user",
    });
    setLoading(false);
    router.replace("/(tabs)");
  };

  const handleGuestLogin = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    await login({
      id: "guest_" + Date.now(),
      name: "Guest User",
      email: "guest@voxlink.app",
      coins: 50,
      role: "user",
    });
    setLoading(false);
    router.replace("/(tabs)");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: topPad + 40, paddingBottom: bottomPad + 20 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Image
          source={require("@/assets/images/app_logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={[styles.appName, { color: colors.text }]}>VoxLink</Text>
        <Text style={[styles.tagline, { color: colors.mutedForeground }]}>Connect. Listen. Grow.</Text>
      </View>

      <View style={styles.form}>
        <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="mail" size={18} color={colors.mutedForeground} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
        </View>
        <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="lock" size={18} color={colors.mutedForeground} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            secureTextEntry={!showPw}
            autoComplete="password"
          />
          <TouchableOpacity onPress={() => setShowPw(!showPw)}>
            <Feather name={showPw ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.forgotRow} onPress={() => router.push("/auth/forgot-password")}>
          <Text style={[styles.forgotText, { color: colors.primary }]}>Forgot password?</Text>
        </TouchableOpacity>

        <PrimaryButton title="Sign In" onPress={handleLogin} loading={loading} />

        <View style={styles.divRow}>
          <View style={[styles.divLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.divText, { color: colors.mutedForeground }]}>or</Text>
          <View style={[styles.divLine, { backgroundColor: colors.border }]} />
        </View>

        <TouchableOpacity onPress={handleGuestLogin} style={[styles.guestBtn, { borderColor: colors.border }]} activeOpacity={0.75}>
          <Feather name="user" size={18} color={colors.mutedForeground} />
          <Text style={[styles.guestText, { color: colors.mutedForeground }]}>Continue as Guest</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => router.push("/auth/register")} style={styles.signupRow}>
        <Text style={[styles.signupText, { color: colors.mutedForeground }]}>Don't have an account? </Text>
        <Text style={[styles.signupLink, { color: colors.primary }]}>Sign Up</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, gap: 28 },
  header: { alignItems: "center", gap: 8 },
  logo: { width: 80, height: 80 },
  appName: { fontSize: 32, fontFamily: "Poppins_700Bold" },
  tagline: { fontSize: 15, fontFamily: "Poppins_400Regular" },
  form: { gap: 14 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0 },
  forgotRow: { alignSelf: "flex-end" },
  forgotText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  divRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divLine: { flex: 1, height: 1 },
  divText: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  guestBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1 },
  guestText: { fontSize: 15, fontFamily: "Poppins_500Medium" },
  signupRow: { flexDirection: "row", justifyContent: "center" },
  signupText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
  signupLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
});
