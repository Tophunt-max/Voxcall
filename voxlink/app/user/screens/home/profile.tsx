import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Alert,
  Switch,
  ActivityIndicator,
} from "react-native";
import { crossShare, appendFileToFormData } from "@/utils/fileUpload";
import * as ClipboardModule from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useLanguage } from "@/context/LanguageContext";
import { LANGUAGES } from "@/localization";
import { API, resolveMediaUrl } from "@/services/api";
import { showSuccessToast, showErrorToast } from "@/components/Toast";

interface MenuItemProps {
  iconSource?: any;
  iconName?: string;
  label: string;
  onPress: () => void;
  value?: string;
  isSwitch?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  danger?: boolean;
  subLabel?: string;
}

function MenuItem({
  iconSource,
  iconName,
  label,
  onPress,
  value,
  isSwitch,
  switchValue,
  onSwitchChange,
  danger,
  subLabel,
}: MenuItemProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={isSwitch ? undefined : onPress}
      style={[styles.menuItem, { borderBottomColor: colors.border }]}
      activeOpacity={0.75}
    >
      <View
        style={[
          styles.menuIcon,
          {
            backgroundColor: danger ? colors.destructive + "15" : colors.surface,
          },
        ]}
      >
        {iconSource ? (
          <Image
            source={iconSource}
            style={styles.menuIconImg}
            tintColor={danger ? colors.destructive : colors.text}
            resizeMode="contain"
          />
        ) : (
          <Feather
            name={iconName as any}
            size={18}
            color={danger ? colors.destructive : colors.text}
          />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.menuLabel,
            { color: danger ? colors.destructive : colors.text },
          ]}
        >
          {label}
        </Text>
        {subLabel ? (
          <Text style={[styles.menuSubLabel, { color: colors.mutedForeground }]}>
            {subLabel}
          </Text>
        ) : null}
      </View>
      {isSwitch ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          trackColor={{ false: colors.border, true: "#0BAF23" }}
          thumbColor="#fff"
        />
      ) : (
        <View style={styles.menuRight}>
          {value ? (
            <Text style={[styles.menuValue, { color: colors.mutedForeground }]}>
              {value}
            </Text>
          ) : null}
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, updateProfile } = useAuth();
  const { permissions, requestNotifications, requestMediaLibrary, openSettings } = usePermissions();
  const { language } = useLanguage();
  const currentLangLabel = LANGUAGES.find((l) => l.code === language)?.name ?? "English";

  const [showNotifDialog, setShowNotifDialog] = useState(false);
  const [showMediaDialog, setShowMediaDialog] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [callCount, setCallCount] = useState<number>(0);

  const topPad = insets.top;
  const bottomPad = insets.bottom;
  const uniqueId = user?.id?.slice(0, 8).toUpperCase() ?? "00000000";

  const notificationsGranted = permissions.notifications.status === "granted";
  const notifBlocked =
    permissions.notifications.status === "blocked" ||
    (permissions.notifications.status === "denied" &&
      !permissions.notifications.canAskAgain);

  const mediaBlocked =
    permissions.mediaLibrary.status === "blocked" ||
    (permissions.mediaLibrary.status === "denied" &&
      !permissions.mediaLibrary.canAskAgain);

  useEffect(() => {
    (async () => {
      try {
        const history = await API.getCallHistory();
        setCallCount(Array.isArray(history) ? history.length : 0);
      } catch {
        setCallCount(0);
      }
    })();
  }, []);

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/user/auth/login");
        },
      },
    ]);
  };

  const copyId = async () => {
    await ClipboardModule.setStringAsync(uniqueId);
    showSuccessToast("Your unique ID has been copied.", "Copied");
  };

  const handleAvatarPress = async () => {
    if (permissions.mediaLibrary.status !== "granted") {
      setShowMediaDialog(true);
      return;
    }
    openImagePicker();
  };

  const openImagePicker = async () => {
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
      const uploadData = await API.uploadFile(formData);
      if (uploadData?.url) {
        await updateProfile({ avatar: resolveMediaUrl(uploadData.url) || uploadData.url });
      }
    } catch {
      Alert.alert("Upload Failed", "Could not upload avatar. Please try again.");
      setAvatarUri(null);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleNotifToggle = async (value: boolean) => {
    if (value) {
      if (notifBlocked) {
        setShowNotifDialog(true);
      } else if (!notificationsGranted) {
        setShowNotifDialog(true);
      }
    } else {
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

  const resolvedAvatar =
    avatarUri ??
    resolveMediaUrl(user?.avatar) ??
    `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "me"}`;

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

      <PermissionDialog
        visible={showMediaDialog}
        config={{ ...PERMISSION_CONFIGS.mediaLibrary, isBlocked: mediaBlocked }}
        onAllow={async () => {
          if (mediaBlocked) {
            openSettings();
            setShowMediaDialog(false);
          } else {
            const granted = await requestMediaLibrary();
            setShowMediaDialog(false);
            if (granted) openImagePicker();
          }
        }}
        onDeny={() => setShowMediaDialog(false)}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>My Profile</Text>
        <TouchableOpacity
          onPress={() => router.push("/user/profile/edit")}
          style={[styles.editBtn, { backgroundColor: colors.surface }]}
        >
          <Image
            source={require("@/assets/icons/ic_edit.png")}
            style={styles.editIcon}
            tintColor={colors.primary}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </View>

      {/* Profile card */}
      <View
        style={[
          styles.profileCard,
          {
            backgroundColor: colors.card,
            ...Platform.select({
              ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } },
              android: { elevation: 3 },
              web: { boxShadow: "0 2px 12px rgba(0,0,0,0.07)" } as any,
            }),
          },
        ]}
      >
        {/* Avatar with edit overlay */}
        <TouchableOpacity
          onPress={handleAvatarPress}
          activeOpacity={0.85}
          style={styles.avatarOuter}
        >
          <View style={[styles.dottedBorder, { borderColor: colors.primary }]}>
            <Image
              source={{ uri: resolvedAvatar }}
              style={styles.avatar}
            />
          </View>
          {/* Edit overlay */}
          <View style={[styles.avatarEditBadge, { backgroundColor: colors.primary }]}>
            {uploadingAvatar ? (
              <ActivityIndicator size={12} color="#fff" />
            ) : (
              <Feather name="camera" size={11} color="#fff" />
            )}
          </View>
          {user?.role === "host" && (
            <View style={[styles.hostBadge, { backgroundColor: colors.primary }]}>
              <Image
                source={require("@/assets/icons/ic_available.png")}
                style={styles.hostBadgeIcon}
                tintColor="#fff"
                resizeMode="contain"
              />
            </View>
          )}
        </TouchableOpacity>

        <Text style={[styles.name, { color: colors.text }]}>{user?.name}</Text>
        <Text style={[styles.email, { color: colors.mutedForeground }]}>{user?.email}</Text>

        {/* Unique ID badge */}
        <TouchableOpacity
          onPress={copyId}
          style={[styles.idBadge, { backgroundColor: "#F0E4F8" }]}
        >
          <Image
            source={require("@/assets/icons/ic_id_badge.png")}
            style={styles.idIcon}
            tintColor="#9D82B6"
            resizeMode="contain"
          />
          <Text style={[styles.idText, { color: "#9D82B6" }]}>ID: {uniqueId}</Text>
          <Image
            source={require("@/assets/icons/ic_copy.png")}
            style={styles.idIcon}
            tintColor="#9D82B6"
            resizeMode="contain"
          />
        </TouchableOpacity>

        {/* Stats row */}
        <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
          <View style={styles.stat}>
            <View style={styles.statValueRow}>
              <Image
                source={require("@/assets/icons/ic_coin.png")}
                style={styles.statCoinIcon}
                resizeMode="contain"
              />
              <Text style={[styles.statValue, { color: colors.coinGoldText }]}>
                {(user?.coins ?? 0).toLocaleString()}
              </Text>
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Coins</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{callCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Calls</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {user?.role === "host" ? "Host" : "User"}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Role</Text>
          </View>
        </View>
      </View>

      {/* Account section */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Account</Text>
        <MenuItem
          iconSource={require("@/assets/icons/ic_edit.png")}
          label="Edit Profile"
          onPress={() => router.push("/user/profile/edit")}
        />
        <MenuItem
          iconSource={require("@/assets/icons/ic_wallet.png")}
          label="My Wallet"
          onPress={() => router.push("/user/payment/checkout")}
        />
        {notifBlocked ? (
          <MenuItem
            iconName="bell"
            label="Notifications"
            value="Blocked"
            subLabel="Tap to open Settings"
            onPress={() => setShowNotifDialog(true)}
          />
        ) : (
          <MenuItem
            iconName="bell"
            label="Notifications"
            isSwitch
            switchValue={notificationsGranted}
            onSwitchChange={handleNotifToggle}
            onPress={() => handleNotifToggle(!notificationsGranted)}
            subLabel={!notificationsGranted ? "Tap to enable" : undefined}
          />
        )}
        <MenuItem
          iconSource={require("@/assets/icons/ic_language.png")}
          label="Language"
          value={currentLangLabel}
          onPress={() => router.push("/shared/language")}
        />
        <MenuItem
          iconName="settings"
          label="Settings"
          onPress={() => router.push("/shared/settings")}
        />
      </View>

      {/* More section */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>More</Text>
        <MenuItem
          iconName="gift"
          label="Refer Friends & Earn"
          subLabel="Share your code, earn free coins"
          onPress={() => router.push("/shared/referral")}
        />
        <MenuItem
          iconName="clock"
          label="Call History"
          onPress={() => router.push("/shared/call/history")}
        />
        <MenuItem
          iconName="help-circle"
          label="Help & FAQ"
          onPress={() => router.push("/shared/help-center")}
        />
        <MenuItem
          iconName="shield"
          label="Privacy Policy"
          onPress={() => router.push("/shared/privacy")}
        />
        <MenuItem
          iconName="info"
          label="About VoxLink"
          onPress={() => router.push("/shared/about")}
        />
        <MenuItem
          iconName="star"
          label="Rate the App"
          onPress={() =>
            Alert.alert(
              "Rate VoxLink",
              "Thank you for using VoxLink! Please rate us on the App Store.",
              [{ text: "Rate Now", style: "default" }, { text: "Later", style: "cancel" }]
            )
          }
        />
        <MenuItem
          iconSource={require("@/assets/images/icon_share.png")}
          label="Share App"
          onPress={() =>
            crossShare({
              message:
                "Join VoxLink - Connect with amazing hosts for audio & video calls! Download now: https://voxlink.app",
              title: "VoxLink",
              url: "https://voxlink.app",
            })
          }
        />
      </View>

      {/* Sign out */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          iconSource={require("@/assets/images/icon_logout.png")}
          label="Sign Out"
          onPress={handleLogout}
          danger
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  editBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  editIcon: { width: 18, height: 18 },

  profileCard: {
    marginHorizontal: 16, borderRadius: 20,
    padding: 20, alignItems: "center",
    gap: 8, marginBottom: 16,
  },
  avatarOuter: { position: "relative" },
  dottedBorder: {
    borderWidth: 1.5, borderRadius: 50,
    borderStyle: "dashed" as any, padding: 3,
  },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarEditBadge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  hostBadge: {
    position: "absolute",
    left: 2,
    bottom: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  hostBadgeIcon: { width: 12, height: 12 },
  name: { fontSize: 18, fontFamily: "Poppins_700Bold", marginTop: 4 },
  email: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  idBadge: {
    flexDirection: "row", alignItems: "center",
    gap: 5, paddingHorizontal: 12,
    paddingVertical: 5, borderRadius: 20, marginTop: 4,
  },
  idIcon: { width: 12, height: 12 },
  idText: { fontSize: 11, fontFamily: "Poppins_500Medium" },

  statsRow: {
    flexDirection: "row", gap: 24, marginTop: 12,
    paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth,
    width: "100%", justifyContent: "center", alignItems: "center",
  },
  stat: { alignItems: "center", gap: 4 },
  statValueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  statCoinIcon: { width: 16, height: 16 },
  statValue: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 28 },

  section: {
    marginHorizontal: 16, borderRadius: 16,
    overflow: "hidden", marginBottom: 12,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 11, fontFamily: "Poppins_500Medium",
    textTransform: "uppercase", letterSpacing: 1,
    paddingTop: 14, paddingBottom: 8,
  },
  menuItem: {
    flexDirection: "row", alignItems: "center",
    gap: 14, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  menuIconImg: { width: 18, height: 18 },
  menuLabel: { fontSize: 14, fontFamily: "Poppins_400Regular" },
  menuSubLabel: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 1 },
  menuRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  menuValue: { fontSize: 12, fontFamily: "Poppins_400Regular" },
});
