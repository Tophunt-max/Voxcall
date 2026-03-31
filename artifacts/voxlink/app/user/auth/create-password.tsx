import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Image, KeyboardAvoidingView, Platform, Alert, ScrollView
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function CreatePasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUpdate = async () => {
    if (!password || password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Error", "Passwords don't match");
      return;
    }
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setLoading(false);
    Alert.alert("Success", "Password updated successfully!", [
      { text: "Sign In", onPress: () => router.replace("/user/auth/login") }
    ]);
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

        <View style={styles.iconWrap}>
          <View style={[styles.iconBg, { backgroundColor: "#F0E4F8" }]}>
            <Image source={require("@/assets/images/icon_lock.png")} style={styles.icon} tintColor={colors.accent} resizeMode="contain" />
          </View>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Create New Password</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Your new password must be different from previously used passwords.
        </Text>

        <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="New Password"
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPass}
          />
          <TouchableOpacity onPress={() => setShowPass(v => !v)}>
            <Image source={showPass ? require("@/assets/icons/ic_eye.png") : require("@/assets/icons/ic_eye_off.png")} style={styles.eyeIcon} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>
        </View>

        <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            placeholder="Confirm Password"
            placeholderTextColor={colors.mutedForeground}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!showConfirm}
          />
          <TouchableOpacity onPress={() => setShowConfirm(v => !v)}>
            <Image source={showConfirm ? require("@/assets/icons/ic_eye.png") : require("@/assets/icons/ic_eye_off.png")} style={styles.eyeIcon} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
          onPress={handleUpdate}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>{loading ? "Updating..." : "Update Password"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, alignItems: "center" },
  backBtn: { alignSelf: "flex-start", width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  backIcon: { width: 18, height: 18 },
  iconWrap: { marginBottom: 24 },
  iconBg: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  icon: { width: 36, height: 36 },
  title: { fontSize: 26, fontFamily: "Poppins_700Bold", marginBottom: 10, textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 22, marginBottom: 32, paddingHorizontal: 10 },
  inputWrap: { flexDirection: "row", alignItems: "center", width: "100%", borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, marginBottom: 16, height: 54 },
  input: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular" },
  eyeIcon: { width: 20, height: 20 },
  btn: { width: "100%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
