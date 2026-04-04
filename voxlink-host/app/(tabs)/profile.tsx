import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Platform, Alert, Switch, ActivityIndicator
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { appendFileToFormData } from "@/utils/fileUpload";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useLanguage } from "@/context/LanguageContext";
import { LANGUAGES } from "@/localization";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

export default function HostProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, updateProfile } = useAuth();
  const { permissions, requestNotifications, openSettings } = usePermissions();
  const { language } = useLanguage();
  const currentLangLabel = LANGUAGES.find((l) => l.code === language)?.name ?? "English";

  const [isOnline, setIsOnline] = useState(false);
  const [hostStats, setHostStats] = useState({ calls: "—", rating: "—" });
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showNotifDialog, setShowNotifDialog] = useState(false);

  const topPad = insets.top;
  const bottomPad = insets.bottom;
  const uniqueId = user?.id?.slice(0, 8).toUpperCase() ?? "00000000";

  const notificationsGranted = permissions.notifications.status === "granted";
  const notifBlocked =
    permissions.notifications.status === "blocked" ||
    (permissions.notifications.status === "denied" && !permissions.notifications.canAskAgain);

  useEffect(() => {
    API.getEarnings()
      .then((data: any) => {
        const h = data.host ?? {};
        setHostStats({
          calls: String(data.transactions?.length ?? 0),
          rating: h.rating ? Number(h.rating).toFixed(1) : "—",
        });
      })
      .catch(() => {});
  }, []);

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out", style: "destructive",
        onPress: async () => { await logout(); router.replace("/auth/login"); }
      }
    ]);
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

  const handleNotifToggle = (value: boolean) => {
    if (value) {
      if (notifBlocked || !notificationsGranted) {
        setShowNotifDialog(true);
      }
    } else {
      Alert.alert(
        "Turn Off Notifications",
        "To disable notifications, go to your phone's Settings and turn off notifications for VoxLink Host.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: openSettings },
        ]
      );
    }
  };

  const displayAvatar = avatarUri
    ?? resolveMediaUrl(user?.avatar)
    ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "host"}`;

  const CHEVRON_ROTATE = { transform: [{ rotate: "180deg" }] } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: bottomPad + 90 }}
      showsVerticalScrollIndicator={false}
    >
      <PermissionDialog
        visible={showNotifDialog}
        config={{ ...PERMISSION_CONFIGS.notifications, isBlocked: notifBlocked }}
        onAllow={async () => {
          if (notifBlocked) {
            openSettings();
          } else {
            await requestNotifications();
          }
          setShowNotifDialog(false);
        }}
        onDeny={() => setShowNotifDialog(false)}
      />

      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>My Profile</Text>
        <TouchableOpacity onPress={() => router.push("/settings")} style={[styles.settingsBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_settings.png")} style={styles.settingsIcon} tintColor={colors.primary} resizeMode="contain" />
        </TouchableOpacity>
      </View>

      <View style={[styles.profileCard, { backgroundColor: colors.card, ...Platform.select({ web: { boxShadow: "0 2px 12px rgba(0,0,0,0.07)" } as any, ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 3 } }) }]}>
        <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.85} style={styles.avatarOuter}>
          <View style={[styles.dottedBorder, { borderColor: colors.primary }]}>
            <Image source={{ uri: displayAvatar }} style={styles.avatar} />
          </View>
          <View style={[styles.cameraBtn, { backgroundColor: uploadingAvatar ? colors.muted : colors.primary }]}>
            {uploadingAvatar ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Image source={require("@/assets/icons/ic_edit.png")} style={styles.cameraIcon} tintColor="#fff" resizeMode="contain" />
            )}
          </View>
        </TouchableOpacity>

        <Text style={[styles.name, { color: colors.text }]}>{user?.name ?? "Host"}</Text>
        <Text style={[styles.role, { color: colors.accent }]}>Professional Host</Text>
        <View style={[styles.idBadge, { backgroundColor: "#F0E4F8" }]}>
          <Image source={require("@/assets/icons/ic_id_badge.png")} style={styles.idIcon} tintColor="#9D82B6" resizeMode="contain" />
          <Text style={[styles.idText, { color: "#9D82B6" }]}>ID: {uniqueId}</Text>
        </View>

        <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
          {[
            { label: "Calls", val: hostStats.calls },
            { label: "Rating", val: hostStats.rating },
            { label: "Coins", val: String(user?.coins ?? 0) }
          ].map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={[styles.statDiv, { backgroundColor: colors.border }]} />}
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: colors.text }]}>{s.val}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={[styles.menuItem, { borderBottomColor: colors.border }]}>
          <View style={[styles.menuIcon, { backgroundColor: isOnline ? "#E8F5E9" : colors.surface }]}>
            <Image source={require("@/assets/icons/ic_available.png")} style={styles.menuIconImg} tintColor={isOnline ? "#0BAF23" : colors.text} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Online Status</Text>
          <Switch
            value={isOnline}
            onValueChange={async (v) => {
              setIsOnline(v);
              try { await API.setHostOnline(v); } catch { setIsOnline(!v); showErrorToast("Failed to update online status."); }
            }}
            trackColor={{ false: colors.border, true: "#0BAF23" }}
            thumbColor="#fff"
          />
        </View>
        <View style={[styles.menuItem, { borderBottomColor: colors.border }]}>
          <View style={[styles.menuIcon, { backgroundColor: notificationsGranted ? "#E8F5E9" : colors.surface }]}>
            <Image source={require("@/assets/icons/ic_notify.png")} style={styles.menuIconImg} tintColor={notificationsGranted ? "#0BAF23" : colors.text} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Push Notifications</Text>
          <Switch
            value={notificationsGranted}
            onValueChange={handleNotifToggle}
            trackColor={{ false: colors.border, true: "#0BAF23" }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Account</Text>
        {[
          { icon: require("@/assets/icons/ic_edit.png"), label: "Edit Profile", onPress: () => router.push("/profile/edit") },
          { icon: require("@/assets/icons/ic_settings.png"), label: "Settings", onPress: () => router.push("/settings") },
          { icon: require("@/assets/icons/ic_language.png"), label: "Language", value: currentLangLabel, onPress: () => router.push("/language") },
        ].map((m, i) => (
          <TouchableOpacity key={i} style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={m.onPress} activeOpacity={0.75}>
            <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
              <Image source={m.icon} style={styles.menuIconImg} tintColor={colors.text} resizeMode="contain" />
            </View>
            <Text style={[styles.menuLabel, { color: colors.text }]}>{m.label}</Text>
            {"value" in m && m.value ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Poppins_400Regular", marginRight: 4 }}>{m.value}</Text>
            ) : null}
            <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>More</Text>

        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={() => router.push("/referral")} activeOpacity={0.75}>
          <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
            <Image source={require("@/assets/icons/ic_bonus.png")} style={styles.menuIconImg} tintColor={colors.text} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Refer & Earn</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={() => router.push("/help-center")} activeOpacity={0.75}>
          <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
            <Image source={require("@/assets/icons/ic_listener.png")} style={styles.menuIconImg} tintColor={colors.text} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Help Center</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={() => router.push("/privacy")} activeOpacity={0.75}>
          <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
            <Image source={require("@/assets/icons/ic_secure.png")} style={styles.menuIconImg} tintColor={colors.text} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Privacy Policy</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={() => router.push("/about")} activeOpacity={0.75}>
          <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
            <Image source={require("@/assets/icons/ic_id_badge.png")} style={styles.menuIconImg} tintColor={colors.text} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>About VoxLink</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={handleLogout} activeOpacity={0.75}>
          <View style={[styles.menuIcon, { backgroundColor: "#FFF3F3" }]}>
            <Image source={require("@/assets/images/icon_logout.png")} style={styles.menuIconImg} tintColor="#E84855" resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: "#E84855" }]}>Sign Out</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor="#E84855" resizeMode="contain" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  settingsBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  settingsIcon: { width: 18, height: 18 },
  profileCard: { marginHorizontal: 16, borderRadius: 20, padding: 20, alignItems: "center", gap: 8, marginBottom: 16 },
  avatarOuter: { position: "relative" },
  dottedBorder: { borderWidth: 1.5, borderRadius: 50, borderStyle: "dashed" as any, padding: 3 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  cameraBtn: {
    position: "absolute", right: 0, bottom: 0,
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  cameraIcon: { width: 13, height: 13 },
  name: { fontSize: 18, fontFamily: "Poppins_700Bold", marginTop: 4 },
  role: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  idBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginTop: 4 },
  idIcon: { width: 12, height: 12 },
  idText: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  statsRow: { flexDirection: "row", gap: 24, marginTop: 12, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, width: "100%", justifyContent: "center", alignItems: "center" },
  stat: { alignItems: "center", gap: 4 },
  statVal: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 28 },
  section: { marginHorizontal: 16, borderRadius: 16, overflow: "hidden", marginBottom: 12, paddingHorizontal: 16 },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 1, paddingTop: 14, paddingBottom: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuIconImg: { width: 18, height: 18 },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular" },
  chevron: { width: 14, height: 14 },
});
