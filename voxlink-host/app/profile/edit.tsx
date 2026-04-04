import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Alert, ActivityIndicator
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { appendFileToFormData } from "@/utils/fileUpload";
import AppInput from "@/components/AppInput";
import { showSuccessToast, showErrorToast } from "@/components/Toast";
import { router } from "expo-router";
import { API, resolveMediaUrl } from "@/services/api";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgIcon } from "@/components/SvgIcon";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";

export default function EditHostProfileScreen() {
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
    if (!name.trim()) {
      showErrorToast("Please enter your display name.");
      return;
    }
    setLoading(true);
    try {
      await updateProfile({ name: name.trim(), bio: bio.trim() });
      showSuccessToast("Your host profile has been updated.", "Profile Saved");
      router.back();
    } catch {
      showErrorToast("Failed to save profile. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarPress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library to change your profile photo.");
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
      const ext = asset.uri.split(".").pop()?.split("?")[0] || "jpg";
      const fileName = `avatar_${user?.id ?? "host"}.${ext}`;
      await appendFileToFormData(formData, "file", asset.uri, fileName, `image/${ext}`);
      formData.append("path", `avatars/${user?.id ?? "host"}/avatar.${ext}`);
      const uploadData = await API.uploadFile(formData);
      if (uploadData?.url) {
        await updateProfile({ avatar: uploadData.url });
        showSuccessToast("Profile photo updated!", "Photo Saved");
      }
    } catch {
      Alert.alert("Upload Failed", "Could not upload your photo. Please try again.");
      setAvatarUri(null);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const displayAvatar = avatarUri
    ?? resolveMediaUrl(user?.avatar)
    ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "host"}`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Edit Host Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.85} style={styles.avatarSection}>
          <Image source={{ uri: displayAvatar }} style={[styles.avatar, { borderColor: colors.primary }]} />
          <View style={[styles.changeAvatarBtn, { backgroundColor: uploadingAvatar ? colors.muted : colors.primary }]}>
            {uploadingAvatar ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <SvgIcon name="camera" size={16} color="#fff" />
            )}
          </View>
          <Text style={[styles.changeAvatarLabel, { color: colors.mutedForeground }]}>
            {uploadingAvatar ? "Uploading..." : "Tap to change photo"}
          </Text>
        </TouchableOpacity>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Display Name</Text>
            <AppInput
              variant="custom"
              inactiveBorder={colors.border}
              bgColor={colors.card}
              textColor={colors.text}
              value={name}
              onChangeText={setName}
              placeholder="Your display name"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>

          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Bio</Text>
            <AppInput
              variant="custom"
              inactiveBorder={colors.border}
              bgColor={colors.card}
              textColor={colors.text}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell users about yourself, your expertise, and what you offer..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              wrapStyle={{ minHeight: 120, paddingVertical: 12 }}
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

          <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <SvgIcon name="info" size={14} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              To update your hourly rate or specialties, please contact host support.
            </Text>
          </View>
        </View>

        <PrimaryButton title="Save Changes" onPress={handleSave} loading={loading} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 18, fontFamily: "Poppins_600SemiBold", textAlign: "center" },
  content: { padding: 24, gap: 24 },
  avatarSection: { alignItems: "center", gap: 8 },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 2.5 },
  changeAvatarBtn: {
    position: "absolute", bottom: 28, right: "32%",
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  changeAvatarLabel: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  form: { gap: 16 },
  label: { fontSize: 13, fontFamily: "Poppins_500Medium", marginBottom: 6 },
  infoBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18 },
});
