import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Image, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import AppInput from "@/components/AppInput";
import { showSuccessToast } from "@/components/Toast";
import { router } from "expo-router";
import { API } from "@/services/api";
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
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const topPad = insets.top;

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateProfile({ name, bio });
      showSuccessToast("Your profile has been updated.", "Profile Saved");
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarPress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library to change your avatar.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setAvatarUri(asset.uri);
    try {
      setUploadingAvatar(true);
      const formData = new FormData();
      const ext = asset.uri.split(".").pop() || "jpg";
      formData.append("file", { uri: asset.uri, name: `avatar_${user?.id ?? "user"}.${ext}`, type: `image/${ext}` } as any);
      formData.append("path", `avatars/${user?.id ?? "user"}/avatar.${ext}`);
      const uploadData = await API.uploadFile(formData);
      if (uploadData?.url) {
        await updateProfile({ avatar: uploadData.url });
      }
    } catch {
      Alert.alert("Upload Failed", "Could not upload avatar. Please try again.");
      setAvatarUri(null);
    } finally {
      setUploadingAvatar(false);
    }
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
        <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.85} style={styles.avatarSection}>
          <Image
            source={{ uri: avatarUri ?? user?.avatar ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "user"}` }}
            style={[styles.avatar, { borderColor: colors.border }]}
          />
          <View style={[styles.changeAvatarBtn, { backgroundColor: colors.primary }]}>
            {uploadingAvatar ? (
              <Feather name="refresh-cw" size={14} color="#fff" />
            ) : (
              <Feather name="camera" size={16} color="#fff" />
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Display Name</Text>
            <AppInput
              variant="custom"
              inactiveBorder={colors.border}
              bgColor={colors.card}
              textColor={colors.foreground}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Bio</Text>
            <AppInput
              variant="custom"
              inactiveBorder={colors.border}
              bgColor={colors.card}
              textColor={colors.foreground}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell others about yourself..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              wrapStyle={{ minHeight: 100, paddingVertical: 12 }}
            />
          </View>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
            <AppInput
              variant="custom"
              inactiveBorder={colors.border}
              bgColor={colors.card}
              textColor={colors.mutedForeground}
              value={user?.email ?? ""}
              editable={false}
              wrapStyle={{ opacity: 0.6 }}
            />
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
