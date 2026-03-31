import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, Alert, Platform, Image } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [loading, setLoading] = useState(false);

  const topPad = insets.top;

  const handleSave = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    await updateProfile({ name, bio });
    setLoading(false);
    router.back();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled">
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="x" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Edit Profile</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.avatarSection}>
          <Image source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "user"}` }} style={[styles.avatar, { borderColor: colors.border }]} />
          <TouchableOpacity style={[styles.changeAvatarBtn, { backgroundColor: colors.primary }]}>
            <Feather name="camera" size={16} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Display Name</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} />
            </View>
          </View>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Bio</Text>
            <View style={[styles.inputWrap, styles.textAreaWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <TextInput value={bio} onChangeText={setBio} placeholder="Tell others about yourself..." placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} multiline numberOfLines={4} textAlignVertical="top" />
            </View>
          </View>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.card, opacity: 0.6 }]}>
              <TextInput value={user?.email ?? ""} editable={false} style={[styles.input, { color: colors.mutedForeground }]} />
            </View>
          </View>
        </View>

        <PrimaryButton title="Save Changes" onPress={handleSave} loading={loading} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  content: { padding: 24, gap: 24 },
  avatarSection: { alignItems: "center", position: "relative" },
  avatar: { width: 90, height: 90, borderRadius: 45, borderWidth: 2 },
  changeAvatarBtn: { position: "absolute", bottom: 0, right: "35%", width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  form: { gap: 16 },
  label: { fontSize: 13, fontFamily: "Poppins_500Medium", marginBottom: 6 },
  inputWrap: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14 },
  textAreaWrap: { minHeight: 100 },
  input: { fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0 },
});
