import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { appendFileToFormData } from "@/utils/fileUpload";
import { alertDialog } from "@/utils/dialog";
import AppInput from "@/components/AppInput";
import { showSuccessToast, showErrorToast } from "@/components/Toast";
import { router } from "expo-router";
import { API, resolveMediaUrl } from "@/services/api";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { PrimaryButton } from "@/components/PrimaryButton";

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuth();
  const { t } = useLanguage();
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
      showSuccessToast(t.editProfile.updated, t.editProfile.savedTitle);
      router.back();
    } catch (e: any) {
      // Don't fail silently — the spinner stopping with no feedback looks like
      // the save "worked". Tell the user so they can retry.
      showErrorToast(e?.message || t.editProfile.saveFailedMsg, t.editProfile.saveFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarPress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      alertDialog(t.editProfile.permissionTitle, t.editProfile.permissionMsg);
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
      const fileName = `avatar_${user?.id ?? "user"}.${ext}`;
      await appendFileToFormData(formData, "file", asset.uri, fileName, `image/${ext}`);
      formData.append("path", `avatars/${user?.id ?? "user"}/avatar.${ext}`);
      // Use the dedicated avatar endpoint (NOT uploadFile → /api/upload/media):
      // it stores under avatars/, sets avatar_url server-side, and deletes the
      // previous avatar blob. uploadFile would orphan every old avatar in R2.
      const uploadData = await API.updateAvatar(formData);
      if (uploadData?.url) {
        // Match profile.tsx — store a fully-resolved URL so the avatar still
        // loads if the server returns a relative path.
        await updateProfile({ avatar: resolveMediaUrl(uploadData.url) || uploadData.url });
      }
    } catch {
      alertDialog(t.editProfile.uploadFailed, t.editProfile.uploadFailedMsg);
      setAvatarUri(null);
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled">
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Image source={require("@/assets/icons/ic_close.png")} style={{ width: 22, height: 22 }} tintColor={colors.foreground} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>{t.profile.editProfile}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.85} style={styles.avatarSection}>
          <Image
            source={{ uri: avatarUri ?? resolveMediaUrl(user?.avatar) ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "user"}` }}
            style={[styles.avatar, { borderColor: colors.border }]}
          />
          <View style={[styles.changeAvatarBtn, { backgroundColor: colors.primary }]}>
            <Image
              source={require("@/assets/icons/ic_photo.png")}
              style={{ width: uploadingAvatar ? 14 : 16, height: uploadingAvatar ? 14 : 16, opacity: uploadingAvatar ? 0.5 : 1 }}
              tintColor="#fff"
              resizeMode="contain"
            />
          </View>
        </TouchableOpacity>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{t.editProfile.displayName}</Text>
            <AppInput
              variant="custom"
              inactiveBorder={colors.border}
              bgColor={colors.card}
              textColor={colors.foreground}
              value={name}
              onChangeText={setName}
              placeholder={t.editProfile.namePlaceholder}
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{t.profile.bio}</Text>
            <AppInput
              variant="custom"
              inactiveBorder={colors.border}
              bgColor={colors.card}
              textColor={colors.foreground}
              value={bio}
              onChangeText={setBio}
              placeholder={t.editProfile.bioPlaceholder}
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              wrapStyle={{ minHeight: 100, paddingVertical: 12 }}
            />
          </View>
          <View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{t.profile.email}</Text>
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

        <PrimaryButton title={t.editProfile.saveChanges} onPress={handleSave} loading={loading} />
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


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
