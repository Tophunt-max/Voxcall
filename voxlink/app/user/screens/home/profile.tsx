import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { crossShare, appendFileToFormData } from "@/utils/fileUpload";
import { alertDialog } from "@/utils/dialog";
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
import { API, resolveMediaUrl } from "@/services/api";
import { showSuccessToast, showErrorToast } from "@/components/Toast";

type FeatherName = keyof typeof Feather.glyphMap;

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, updateProfile, refreshBalance } = useAuth();
  const { permissions, requestMediaLibrary, openSettings } = usePermissions();
  const { t } = useLanguage();

  const [showMediaDialog, setShowMediaDialog] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [callCount, setCallCount] = useState(0);
  const [favCount, setFavCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const topPad = insets.top;
  const bottomPad = insets.bottom;
  const uniqueId = user?.id?.slice(0, 8).toUpperCase() ?? "00000000";
  const appVersion = Application.nativeApplicationVersion ?? "1.0.0";

  const mediaBlocked =
    permissions.mediaLibrary.status === "blocked" ||
    (permissions.mediaLibrary.status === "denied" && !permissions.mediaLibrary.canAskAgain);

  // Only counts that this app actually tracks (calls + favourited hosts).
  const loadCounts = useCallback(async () => {
    try {
      const [history, favs] = await Promise.all([
        API.getCallHistory().catch(() => [] as any[]),
        API.getFavoriteIds().catch(() => ({ ids: [] as string[] })),
      ]);
      setCallCount(Array.isArray(history) ? history.length : 0);
      setFavCount(favs?.ids?.length ?? 0);
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshBalance().catch(() => {}), loadCounts()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshBalance, loadCounts]);

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
      /* dismissed */
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

  const resolvedAvatar =
    avatarUri ??
    (user?.avatar?.startsWith("http") || user?.avatar?.startsWith("file") || user?.avatar?.startsWith("asset")
      ? user.avatar
      : resolveMediaUrl(user?.avatar)) ??
    `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "me"}`;

  const gender = user?.gender;
  const genderPill =
    gender === "male"
      ? { symbol: "♂", bg: "#DCE4FF", fg: "#3B5BDB" }
      : gender === "female"
      ? { symbol: "♀", bg: "#FCE0EF", fg: "#D6336C" }
      : null;

  // ─── Only features that exist in THIS app ──────────────────────────────
  const quickActions: { icon: FeatherName; label: string; color: string; bg: string; onPress: () => void }[] = [
    { icon: "gift", label: "Referral", color: "#7C3AED", bg: "#EDE7FB", onPress: () => router.push("/user/referral") },
    { icon: "award", label: "Rewards", color: "#F97316", bg: "#FFE8D6", onPress: () => router.push("/user/rewards") },
    { icon: "target", label: "Lucky Spin", color: "#DB2777", bg: "#FCE0EF", onPress: () => router.push("/user/rewards-spin") },
    { icon: "credit-card", label: "Coin Trading", color: "#059669", bg: "#D7F5E6", onPress: () => router.push("/user/coin-history") },
  ];

  const menuActions: { icon: FeatherName; label: string; onPress: () => void }[] = [
    { icon: "edit-2", label: t.profile.editProfile, onPress: () => router.push("/user/profile/edit") },
    { icon: "clock", label: t.profile.callHistory, onPress: () => router.push("/user/call/history") },
    { icon: "bell", label: t.settings.notifications, onPress: () => router.push("/user/notifications") },
    { icon: "globe", label: t.profile.language, onPress: () => router.push("/user/language") },
    { icon: "help-circle", label: t.profile.helpCenter, onPress: () => router.push("/user/help-center") },
    { icon: "shield", label: t.profile.privacy, onPress: () => router.push("/user/privacy") },
    { icon: "info", label: t.profile.about, onPress: () => router.push("/user/about") },
    { icon: "star", label: t.profile.rateApp, onPress: handleRate },
    { icon: "share-2", label: t.profile.shareApp, onPress: handleShareApp },
    { icon: "settings", label: t.profile.settings, onPress: () => router.push("/user/settings") },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: bottomPad + 90 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
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

      {/* Title */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>{t.profile.myProfile}</Text>
      </View>

      {/* Profile row */}
      <View style={[styles.profileCard, cardShadow(colors)]}>
        <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.85} style={styles.avatarOuter} accessibilityRole="button" accessibilityLabel="Change profile photo">
          <View style={[styles.dottedBorder, { borderColor: colors.primary }]}>
            <Image source={{ uri: resolvedAvatar }} style={styles.avatar} />
          </View>
          <View style={[styles.avatarEditBadge, { backgroundColor: colors.primary }]}>
            {uploadingAvatar ? (
              <ActivityIndicator size={10} color="#fff" />
            ) : (
              <Feather name="camera" size={10} color="#fff" />
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.profileInfo}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{user?.name}</Text>
            {genderPill && (
              <View style={[styles.genderPill, { backgroundColor: genderPill.bg }]}>
                <Text style={[styles.genderText, { color: genderPill.fg }]}>{genderPill.symbol}</Text>
              </View>
            )}
            {user?.role === "host" && (
              <View style={[styles.hostChip, { backgroundColor: colors.primary + "1A" }]}>
                <Text style={[styles.hostChipText, { color: colors.primary }]}>HOST</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={copyId} style={styles.idRow} accessibilityRole="button" accessibilityLabel={`Copy your ID ${uniqueId}`}>
            <Text style={[styles.idText, { color: colors.mutedForeground }]}>ID : {uniqueId}</Text>
            <Feather name="copy" size={12} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => router.push("/user/profile/edit")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-right" size={24} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Stats — only the metrics this app actually has */}
      <View style={[styles.statsCard, cardShadow(colors)]}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text }]}>{callCount}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.profile.callHistory}</Text>
        </View>
        <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text }]}>{favCount}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Favourites</Text>
        </View>
        <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text }]}>{user?.role === "host" ? "Host" : "User"}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Role</Text>
        </View>
      </View>

      {/* Coins banner → buy coins */}
      <TouchableOpacity activeOpacity={0.9} onPress={() => router.push("/user/payment/checkout")} style={styles.coinWrap}>
        <LinearGradient colors={["#FBAF3A", "#F97316"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.coinBanner}>
          <View style={styles.coinBadge}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 30, height: 30 }} resizeMode="contain" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.coinBannerLabel}>Available My Coins</Text>
            <Text style={styles.coinBannerValue}>
              {(user?.coins ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>
          <Feather name="chevrons-right" size={26} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>

      {/* Quick actions (coloured) */}
      <View style={[styles.card, { backgroundColor: colors.card }, cardShadow(colors)]}>
        <View style={styles.quickRow}>
          {quickActions.map((a) => (
            <TouchableOpacity key={a.label} style={styles.quickTile} onPress={a.onPress} activeOpacity={0.8}>
              <View style={[styles.quickIcon, { backgroundColor: a.bg }]}>
                <Feather name={a.icon} size={22} color={a.color} />
              </View>
              <Text style={[styles.quickLabel, { color: colors.text }]} numberOfLines={1}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Menu grid */}
      <View style={[styles.card, { backgroundColor: colors.card }, cardShadow(colors)]}>
        <View style={styles.menuGrid}>
          {menuActions.map((a) => (
            <TouchableOpacity key={a.label} style={styles.gridTile} onPress={a.onPress} activeOpacity={0.7}>
              <View style={[styles.gridIcon, { backgroundColor: colors.surface }]}>
                <Feather name={a.icon} size={20} color={colors.text} />
              </View>
              <Text style={[styles.gridLabel, { color: colors.mutedForeground }]} numberOfLines={2}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Sign out */}
      <TouchableOpacity
        onPress={() => setShowLogout(true)}
        style={[styles.logoutBtn, { backgroundColor: colors.card, borderColor: colors.destructive + "33" }]}
        activeOpacity={0.75}
      >
        <Feather name="log-out" size={18} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>{t.profile.logout}</Text>
      </TouchableOpacity>

      <Text style={[styles.versionText, { color: colors.mutedForeground }]}>VoxLink v{appVersion}</Text>
    </ScrollView>
  );
}

function cardShadow(colors: any) {
  return Platform.select({
    ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 } },
    android: { elevation: 2 },
    web: { boxShadow: "0 3px 14px rgba(0,0,0,0.06)" } as any,
  });
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  title: { fontSize: 22, fontFamily: "Poppins_700Bold" },

  profileCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "transparent",
  },
  avatarOuter: { position: "relative" },
  dottedBorder: { borderWidth: 1.5, borderRadius: 50, borderStyle: "dashed" as any, padding: 3 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarEditBadge: {
    position: "absolute", right: 0, bottom: 0, width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff",
  },
  profileInfo: { flex: 1, marginLeft: 14, gap: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontSize: 18, fontFamily: "Poppins_700Bold", maxWidth: "70%" },
  genderPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, minWidth: 26, alignItems: "center" },
  genderText: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  hostChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  hostChipText: { fontSize: 10, fontFamily: "Poppins_700Bold", letterSpacing: 0.5 },
  idRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  idText: { fontSize: 12, fontFamily: "Poppins_400Regular" },

  statsCard: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 16, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    backgroundColor: "#ECE9F7",
  },
  stat: { alignItems: "center", gap: 4, flex: 1 },
  statValue: { fontSize: 17, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 26 },

  coinWrap: { marginHorizontal: 16, marginTop: 14, borderRadius: 18, overflow: "hidden" },
  coinBanner: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  coinBadge: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  coinBannerLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.9)", textDecorationLine: "underline" },
  coinBannerValue: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#fff", marginTop: 2 },

  card: { marginHorizontal: 16, marginTop: 14, borderRadius: 18, padding: 16 },
  quickRow: { flexDirection: "row", justifyContent: "space-between" },
  quickTile: { alignItems: "center", gap: 8, flex: 1 },
  quickIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontSize: 12, fontFamily: "Poppins_500Medium" },

  menuGrid: { flexDirection: "row", flexWrap: "wrap" },
  gridTile: { width: "25%", alignItems: "center", gap: 6, paddingVertical: 12 },
  gridIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  gridLabel: { fontSize: 11, fontFamily: "Poppins_400Regular", textAlign: "center", paddingHorizontal: 2 },

  logoutBtn: {
    marginHorizontal: 16, marginTop: 16, borderRadius: 14, borderWidth: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14,
  },
  logoutText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },

  versionText: { textAlign: "center", fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 14 },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
