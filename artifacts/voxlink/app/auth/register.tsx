import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, Platform, Image } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "">("");
  const [loading, setLoading] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password.trim() || !gender) {
      Alert.alert("Missing Fields", "Please fill in all fields including gender.");
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    await login({
      id: "user_" + Date.now(),
      name: name.trim(),
      email: email.trim(),
      gender,
      coins: 100,
      role: "user",
    });
    setLoading(false);
    router.replace("/auth/fill-profile");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: topPad + 20 }]}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: colors.foreground }} resizeMode="contain" />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.foreground }]}>Create Account</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Join VoxLink and start connecting</Text>

      <View style={styles.form}>
        <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="user" size={18} color={colors.mutedForeground} />
          <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} autoCapitalize="words" />
        </View>
        <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="mail" size={18} color={colors.mutedForeground} />
          <TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} keyboardType="email-address" autoCapitalize="none" />
        </View>
        <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="lock" size={18} color={colors.mutedForeground} />
          <TextInput value={password} onChangeText={setPassword} placeholder="Password (min 8 chars)" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} secureTextEntry />
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>I am</Text>
        <View style={styles.genderRow}>
          {(["male", "female", "other"] as const).map((g) => (
            <TouchableOpacity key={g} onPress={() => setGender(g)} style={[styles.genderBtn, { borderColor: gender === g ? colors.primary : colors.border, backgroundColor: gender === g ? colors.primary + "18" : colors.card }]} activeOpacity={0.75}>
              <Text style={[styles.genderText, { color: gender === g ? colors.primary : colors.mutedForeground }]}>
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <PrimaryButton title="Create Account" onPress={handleRegister} loading={loading} />
      </View>

      <TouchableOpacity onPress={() => router.replace("/auth/login")} style={styles.loginRow}>
        <Text style={[styles.loginText, { color: colors.mutedForeground }]}>Already have an account? </Text>
        <Text style={[styles.loginLink, { color: colors.primary }]}>Sign In</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, paddingBottom: 40, gap: 16 },
  backBtn: { marginBottom: 8, alignSelf: "flex-start" },
  title: { fontSize: 28, fontFamily: "Poppins_700Bold" },
  subtitle: { fontSize: 15, fontFamily: "Poppins_400Regular" },
  form: { gap: 14 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0 },
  label: { fontSize: 14, fontFamily: "Poppins_500Medium" },
  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, alignItems: "center" },
  genderText: { fontSize: 14, fontFamily: "Poppins_500Medium" },
  loginRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  loginText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
  loginLink: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
});
