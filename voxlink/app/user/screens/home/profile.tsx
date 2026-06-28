import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Switch,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { crossShare, appendFileToFormData } from "@/utils/fileUpload";
import { confirmDialog, alertDialog } from "@/utils/dialog";
import * as ClipboardModule from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Application from "expo-application";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { ConfirmModal } from "@/components/ConfirmModal";
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
        ) : iconName ? (
          <Feather
            name={iconName as any}
            size={18}
            color={danger ? colors.destructive : colors.text}
          />
        ) : null}
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
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 16, height: 16, tintColor: colors.mutedForeground, transform: [{ rotate: "180deg" }] }} resizeMode="contain" />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, updateProfile, refreshBalance } = useAuth();
  const { permissions, requestNotifications, requestMediaLibrary, openSettings } = usePermissions();
  const { language, t } = useLanguage();
  const currentLangLabel = LANGUAGES.find((l) => l.code === language)?.name ?? "English";

  const [showNotifDialog, setShowNotifDialog] = useState(false);
  const [showMediaDialog, setShowMediaDialog] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [callCount, setCallCount] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const topPad = insets.top;
  const bottomPad = insets.bottom;
  const uniqueId = user?.id?.slice(0, 8).toUpperCase() ?? "00000000";
  const appVersion = Application.nativeApplicationVersion ?? "1.0.0";

  const notificationsGranted = permissions.notifications.status === "granted";
  const notifBlocked =
    permissions.notifications.status === "blocked" ||
    (permissions.notifications.status === "denied" &&
      !permissions.notifications.canAskAgain);

  const mediaBlocked =
    permissions.mediaLibrary.status === "blocked" ||
    (permissions.mediaLibrary.status === "denied" &&
      !permissions.mediaLibrary.canAskAgain);

  const loadCallCount = useCallback(async () => {
    try {
      const history = await API.getCallHistory();
      setCallCount(Array.isArray(history) ? history.length : 0);
    } catch {
      setCallCount(0);
    }
  }, []);

  useEffect(() => {
    loadCallCount();
  }, [loadCallCount]);

  // Pull-to-refresh: coins (from the server, not the possibly-stale cached
  // user) and the call count, so the stats row reflects reality.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshBalance().catch(() => {}), loadCallCount()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshBalance, loadCallCount]);

  const handleLogout = () => setShowLogout(true);

  const doLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.replace("/user/auth/login");
    } finally {
      setLoggingOut(false);
      setShowLogout(false);
    }
  };

  const copyId = async () => {
    try {
      await ClipboardModule.setStringAsync(uniqueId);
      showSuccessToast("Your unique ID has been copied.", "Copied");
    } catch {
      showErrorToast("Couldn't copy your ID. Please try again.");
    }
  };

  // "Rate the App" — actually open the store now (was a no-op alert button).
  // Android deep-links to the Play listing; iOS/web fall back to the site
  // since we don't have the numeric App Store id here.
  const handleRate = async () => {
    const pkg = "com.voxlink.app";
    try {
      if (Platform.OS === "android") {
        const market = `market://details?id=${pkg}`;
        const canOpen = await Linking.canOpenURL(market);
        await Linking.openURL(canOpen ? market : `https://play.google.com/store/apps/details?id=${pkg}`);
      } else {
        await Linking.openURL("https://voxlink.app");
      }
    } catch {
      showErrorToast("Couldn't open the store. Please try again.");
    }
  };

  const handleShareApp = async () => {
    try {
      await crossShare({
        message:
          "Join VoxLink - Connect with amazing hosts for audio & video calls! Download now: https://voxlink.app",
        title: "VoxLink",
        url: "https://voxlink.app",
      });
    } catch {
      // user dismissed the share sheet or it failed — non-fatal
    }
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
      // Use the dedicated avatar endpoint (NOT uploadFile → /api/upload/media):
      // it stores under avatars/, sets avatar_url server-side, and deletes the
      // previous avatar blob. uploadFile would orphan every old avatar in R2.
      const uploadData = await API.updateAvatar(formData);
      if (uploadData?.url) {
        await updateProfile({ avatar: resolveMediaUrl(uploadData.url) || uploadData.url });
      }
    } catch {
      alertDialog("Upload Failed", "Could not upload avatar. Please try again.");
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
      confirmDialog({
        title: "Turn Off Notifications",
        message: "To disable notifications, go to your phone's Settings and turn off notifications for VoxLink.",
        confirmText: "Open Settings",
        onConfirm: openSettings,
      });
    }
  };

  const resolvedAvatar =
    avatarUri ??
    (user?.avatar?.startsWith('http') || user?.avatar?.startsWith('file') || user?.avatar?.startsWith('asset')
      ? user.avatar
      : resolveMediaUrl(user?.avatar)
    ) ??
    `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "me"}`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: bottomPad + 90 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <ConfirmModal
        visible={showLogout}
        emoji="👋"
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmText="Sign Out"
        cancelText="Cancel"
        destructive
        loading={loggingOut}
        onConfirm={doLogout}
        onCancel={() => setShowLogout(false)}
      />

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
        <Text style={[styles.title, { color: colors.text }]}>{t.profile.myProfile}</Text>
        <TouchableOpacity
          onPress={() => router.push("/user/profile/edit")}
          style={[styles.editBtn, { backgroundColor: colors.surface }]}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
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
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
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
              <Image source={require("@/assets/icons/ic_photo.png")} style={{ width: 11, height: 11, tintColor: "#fff" }} resizeMode="contain" />
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
          accessibilityRole="button"
          accessibilityLabel={`Copy your ID ${uniqueId}`}
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
          <TouchableOpacity
            style={styles.stat}
            onPress={() => router.push("/user/payment/checkout")}
            accessibilityRole="button"
            accessibilityLabel="Buy coins"
            activeOpacity={0.7}
          >
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
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.wallet.coins}</Text>
          </TouchableOpacity>
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
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.settings.account}</Text>
        <MenuItem
          iconSource={require("@/assets/icons/ic_edit.png")}
          label={t.profile.editProfile}
          onPress={() => router.push("/user/profile/edit")}
        />
        <MenuItem
          iconSource={require("@/assets/icons/ic_wallet.png")}
          label={t.wallet.wallet}
          value={`${(user?.coins ?? 0).toLocaleString()} ${t.wallet.coins.toLowerCase()}`}
          onPress={() => router.push("/user/payment/checkout")}
        />
        <MenuItem
          iconName="credit-card"
          label={t.wallet.coinHistory}
          onPress={() => router.push("/user/coin-history")}
        />
        {notifBlocked ? (
          <MenuItem
            iconName="bell"
            label={t.settings.notifications}
            value="Blocked"
            onPress={() => setShowNotifDialog(true)}
          />
        ) : (
          <MenuItem
            iconName="bell"
            label={t.settings.notifications}
            isSwitch
            switchValue={notificationsGranted}
            onSwitchChange={handleNotifToggle}
            onPress={() => handleNotifToggle(!notificationsGranted)}
          />
        )}
        <MenuItem
          iconSource={require("@/assets/icons/ic_language.png")}
          label={t.profile.language}
          value={currentLangLabel}
          onPress={() => router.push("/user/language")}
        />
        <MenuItem
          iconName="settings"
          label={t.profile.settings}
          onPress={() => router.push("/user/settings")}
        />
      </View>

      {/* More section */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.common.more}</Text>
        <MenuItem
          iconName="gift"
          label="Refer Friends & Earn"
          subLabel="Share your code, earn free coins"
          onPress={() => router.push("/user/referral")}
        />
        <MenuItem
          iconName="clock"
          label={t.profile.callHistory}
          onPress={() => router.push("/user/call/history")}
        />
        <MenuItem
          iconName="help-circle"
          label={t.profile.helpCenter}
          onPress={() => router.push("/user/help-center")}
        />
        <MenuItem
          iconName="shield"
          label={t.profile.privacy}
          onPress={() => router.push("/user/privacy")}
        />
        <MenuItem
          iconName="info"
          label={t.profile.about}
          onPress={() => router.push("/user/about")}
        />
        <MenuItem
          iconName="star"
          label={t.profile.rateApp}
          onPress={handleRate}
        />
        <MenuItem
          iconSource={require("@/assets/images/icon_share.png")}
          label={t.profile.shareApp}
          onPress={handleShareApp}
        />
      </View>

      {/* Sign out */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          iconSource={require("@/assets/images/icon_logout.png")}
          label={t.profile.logout}
          onPress={handleLogout}
          danger
        />
      </View>

      {/* App version */}
      <Text style={[styles.versionText, { color: colors.mutedForeground }]}>
        VoxLink v{appVersion}
      </Text>
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
  versionText: { textAlign: "center", fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 2 },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
