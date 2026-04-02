import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Switch, Alert, Platform
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useLanguage } from "@/context/LanguageContext";
import { LANGUAGES } from "@/localization";

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const { permissions, requestNotifications, openSettings, refresh } = usePermissions();
  const { language } = useLanguage();
  const currentLangLabel = LANGUAGES.find((l) => l.code === language)?.name ?? "English";

  const [showNotifDialog, setShowNotifDialog] = useState(false);

  const topPad = insets.top;

  const notificationsGranted = permissions.notifications.status === "granted";
  const notifBlocked = permissions.notifications.status === "blocked" ||
    (permissions.notifications.status === "denied" && !permissions.notifications.canAskAgain);

  const handleNotifToggle = async (value: boolean) => {
    if (value) {
      // Turning ON — request permission
      if (notifBlocked) {
        setShowNotifDialog(true);
      } else if (!notificationsGranted) {
        setShowNotifDialog(true);
      }
      // If already granted, nothing to do — toggle is already on
    } else {
      // Turning OFF — can't programmatically revoke, guide user to Settings
      Alert.alert(
        "Turn Off Notifications",
        "To disable notifications, go to your phone's Settings and turn off notifications for VoxLink.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: openSettings },
        ]
      );
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: async () => { await logout(); router.replace("/shared/auth/role-select"); } }
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This action is permanent. All your data will be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => Alert.alert("Account Deleted", "Your account has been deleted.") }
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Notification Permission Dialog */}
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

      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Banner */}
        <View style={[styles.banner, { backgroundColor: "#F3E6FF" }]}>
          <Image source={require("@/assets/images/settings_blur.png")} style={styles.bannerImg} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.text }]}>Manage Your Account</Text>
            <Text style={[styles.bannerSub, { color: colors.mutedForeground }]}>Update settings and preferences</Text>
          </View>
        </View>

        {/* General */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>General</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {/* Notifications Row */}
          <View style={styles.menuRow}>
            <View style={[styles.menuIconWrap, { backgroundColor: notificationsGranted ? "#E6F9EA" : colors.surface }]}>
              <Image source={require("@/assets/images/notification_graphic.png")} style={styles.menuIcon} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.menuLabel, { color: colors.text }]}>Notifications</Text>
              {!notificationsGranted && (
                <Text style={[styles.menuSubLabel, { color: colors.mutedForeground }]}>
                  {notifBlocked ? "Blocked in Settings" : "Tap to enable"}
                </Text>
              )}
            </View>
            <Switch
              value={notificationsGranted}
              onValueChange={handleNotifToggle}
              trackColor={{ false: colors.border, true: "#0BAF23" }}
              thumbColor="#fff"
              style={styles.switch}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.menuRow} onPress={() => router.push("/shared/language")}>
            <View style={[styles.menuIconWrap, { backgroundColor: colors.surface }]}>
              <Image source={require("@/assets/images/lang_setting.png")} style={styles.menuIcon} resizeMode="contain" />
            </View>
            <Text style={[styles.menuLabel, { color: colors.text }]}>App Language</Text>
            <Text style={[styles.menuValue, { color: colors.mutedForeground }]}>{currentLangLabel}</Text>
            <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>
        </View>

        {/* Info */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Information</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push("/shared/help-center")}>
            <View style={[styles.menuIconWrap, { backgroundColor: colors.surface }]}>
              <Image source={require("@/assets/icons/ic_guaranteed.png")} style={styles.menuIcon} resizeMode="contain" />
            </View>
            <Text style={[styles.menuLabel, { color: colors.text }]}>Help & FAQ</Text>
            <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.menuRow} onPress={() => router.push("/shared/privacy")}>
            <View style={[styles.menuIconWrap, { backgroundColor: colors.surface }]}>
              <Image source={require("@/assets/icons/ic_secure.png")} style={styles.menuIcon} resizeMode="contain" />
            </View>
            <Text style={[styles.menuLabel, { color: colors.text }]}>Privacy Policy</Text>
            <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.menuRow} onPress={() => router.push("/shared/about")}>
            <View style={[styles.menuIconWrap, { backgroundColor: colors.surface }]}>
              <Image source={require("@/assets/icons/ic_flag.png")} style={styles.menuIcon} resizeMode="contain" />
            </View>
            <Text style={[styles.menuLabel, { color: colors.text }]}>About VoxLink</Text>
            <Text style={[styles.menuValue, { color: colors.mutedForeground }]}>v1.0.0</Text>
            <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>
        </View>

        {/* Account */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <TouchableOpacity style={styles.menuRow} onPress={handleLogout}>
            <View style={[styles.menuIconWrap, { backgroundColor: "#FFF3F3" }]}>
              <Image source={require("@/assets/images/icon_logout.png")} style={styles.menuIcon} resizeMode="contain" />
            </View>
            <Text style={[styles.menuLabel, { color: "#E84855" }]}>Sign Out</Text>
            <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor="#E84855" resizeMode="contain" />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.menuRow} onPress={handleDeleteAccount}>
            <View style={[styles.menuIconWrap, { backgroundColor: "#FFF3F3" }]}>
              <Image source={require("@/assets/images/icon_delete.png")} style={styles.menuIcon} resizeMode="contain" />
            </View>
            <Text style={[styles.menuLabel, { color: "#E84855" }]}>Delete Account</Text>
            <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor="#E84855" resizeMode="contain" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  banner: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  bannerImg: { width: 56, height: 56 },
  bannerTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  bannerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  card: { borderRadius: 16, overflow: "hidden", paddingHorizontal: 14 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuIconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuIcon: { width: 22, height: 22 },
  menuLabel: { fontSize: 14, fontFamily: "Poppins_400Regular" },
  menuSubLabel: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 1 },
  menuValue: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  chevron: { width: 14, height: 14 },
  switch: {},
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 50 },
});
