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
  const quickActions: { icon: FeatherName; label: string; grad: readonly [string, string]; onPress: () => void }[] = [
    { icon: "gift", label: "Referral", grad: ["#A54DFF", "#7B2FF7"], onPress: () => router.push("/user/referral") },
    { icon: "award", label: "Rewards", grad: ["#FFB347", "#F97316"], onPress: () => router.push("/user/rewards") },
    { icon: "target", label: "Lucky Spin", grad: ["#FF7EB3", "#DB2777"], onPress: () => router.push("/user/rewards-spin") },
    { icon: "credit-card", label: "Coin Trading", grad: ["#34D399", "#059669"], onPress: () => router.push("/user/coin-history") },
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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Soft lavender backdrop behind the header + profile */}
      <LinearGradient
        colors={[colors.surfaceAlt, colors.background]}
        style={[styles.backdrop, { height: 300 + topPad }]}
        pointerEvents="none"
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomPad + 90 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
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
        <View style={[styles.header, { paddingTop: topPad + 14 }]}>
          <Text style={[styles.title, { color: colors.text }]}>{t.profile.myProfile}</Text>
        </View>

        {/* Profile row */}
        <View style={[styles.profileCard, { backgroundColor: colors.card }, cardShadow()]}>
          <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.85} style={styles.avatarOuter} accessibilityRole="button" accessibilityLabel="Change profile photo">
            <LinearGradient colors={[colors.accent, colors.chatPurple]} style={styles.avatarRing}>
              <View style={[styles.avatarInner, { backgroundColor: colors.card }]}>
                <Image source={{ uri: resolvedAvatar }} style={styles.avatar} />
              </View>
            </LinearGradient>
            <View style={[styles.avatarEditBadge, { backgroundColor: colors.accent, borderColor: colors.card }]}>
              {uploadingAvatar ? <ActivityIndicator size={10} color="#fff" /> : <Feather name="camera" size={10} color="#fff" />}
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
                <View style={[styles.hostChip, { backgroundColor: colors.accentLight }]}>
                  <Text style={[styles.hostChipText, { color: colors.accent }]}>HOST</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={copyId} style={[styles.idRow, { backgroundColor: colors.surface }]} accessibilityRole="button" accessibilityLabel={`Copy your ID ${uniqueId}`}>
              <Text style={[styles.idText, { color: colors.mutedForeground }]}>ID : {uniqueId}</Text>
              <Feather name="copy" size={11} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.push("/user/profile/edit")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={[styles.chevBtn, { backgroundColor: colors.surface }]}>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={[styles.statsCard, { backgroundColor: colors.accentLight }]}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{callCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.profile.callHistory}</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.accentBorder }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{favCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Favourites</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.accentBorder }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{user?.role === "host" ? "Host" : "User"}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Role</Text>
          </View>
        </View>

        {/* Coins banner → buy coins */}
        <TouchableOpacity activeOpacity={0.9} onPress={() => router.push("/user/payment/checkout")} style={[styles.coinWrap, coinShadow()]}>
          <LinearGradient colors={["#FFB347", "#F97316"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.coinBanner}>
            {/* decorative circles */}
            <View style={styles.coinDeco1} pointerEvents="none" />
            <View style={styles.coinDeco2} pointerEvents="none" />
            <View style={styles.coinBadge}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 30, height: 30 }} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.coinBannerLabel}>Available My Coins</Text>
              <Text style={styles.coinBannerValue}>
                {(user?.coins ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={styles.rechargePill}>
              <Text style={styles.rechargeText}>Recharge</Text>
              <Feather name="chevron-right" size={14} color="#F97316" />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Quick actions (gradient icons) */}
        <View style={[styles.card, { backgroundColor: colors.card }, cardShadow()]}>
          <View style={styles.quickRow}>
            {quickActions.map((a) => (
              <TouchableOpacity key={a.label} style={styles.quickTile} onPress={a.onPress} activeOpacity={0.8}>
                <LinearGradient colors={a.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.quickIcon}>
                  <Feather name={a.icon} size={22} color="#fff" />
                </LinearGradient>
                <Text style={[styles.quickLabel, { color: colors.text }]} numberOfLines={1}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Menu grid */}
        <View style={[styles.card, { backgroundColor: colors.card }, cardShadow()]}>
          <View style={styles.menuGrid}>
            {menuActions.map((a) => (
              <TouchableOpacity key={a.label} style={styles.gridTile} onPress={a.onPress} activeOpacity={0.7}>
                <View style={[styles.gridIcon, { backgroundColor: colors.accentLight }]}>
                  <Feather name={a.icon} size={20} color={colors.accent} />
                </View>
                <Text style={[styles.gridLabel, { color: colors.labelColor }]} numberOfLines={2}>{a.label}</Text>
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
    </View>
  );
}

function cardShadow() {
  return Platform.select({
    ios: { shadowColor: "#5B21B6", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 3 },
    web: { boxShadow: "0 4px 16px rgba(91,33,182,0.08)" } as any,
  });
}
function coinShadow() {
  return Platform.select({
    ios: { shadowColor: "#F97316", shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 5 },
    web: { boxShadow: "0 6px 18px rgba(249,115,22,0.32)" } as any,
  });
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Poppins_700Bold" },

  profileCard: {
    marginHorizontal: 16, borderRadius: 22, padding: 16,
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  avatarOuter: { position: "relative" },
  avatarRing: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  avatarInner: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center" },
  avatar: { width: 60, height: 60, borderRadius: 30 },
  avatarEditBadge: {
    position: "absolute", right: 0, bottom: 0, width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center", borderWidth: 2,
  },
  profileInfo: { flex: 1, marginLeft: 14, gap: 8 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontSize: 18, fontFamily: "Poppins_700Bold", maxWidth: "62%" },
  genderPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, minWidth: 26, alignItems: "center" },
  genderText: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  hostChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  hostChipText: { fontSize: 10, fontFamily: "Poppins_700Bold", letterSpacing: 0.5 },
  idRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  idText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  chevBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },

  statsCard: {
    marginHorizontal: 16, marginTop: 14, borderRadius: 18, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
  },
  stat: { alignItems: "center", gap: 4, flex: 1 },
  statValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 26 },

  coinWrap: { marginHorizontal: 16, marginTop: 16, borderRadius: 20, overflow: "hidden" },
  coinBanner: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 18, overflow: "hidden" },
  coinDeco1: { position: "absolute", right: -20, top: -28, width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(255,255,255,0.15)" },
  coinDeco2: { position: "absolute", right: 60, bottom: -40, width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(255,255,255,0.10)" },
  coinBadge: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.28)",
    alignItems: "center", justifyContent: "center",
  },
  coinBannerLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.92)" },
  coinBannerValue: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff", marginTop: 2 },
  rechargePill: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  rechargeText: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#F97316" },

  card: { marginHorizontal: 16, marginTop: 14, borderRadius: 20, padding: 16 },
  quickRow: { flexDirection: "row", justifyContent: "space-between" },
  quickTile: { alignItems: "center", gap: 8, flex: 1 },
  quickIcon: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontSize: 12, fontFamily: "Poppins_500Medium" },

  menuGrid: { flexDirection: "row", flexWrap: "wrap" },
  gridTile: { width: "25%", alignItems: "center", gap: 7, paddingVertical: 12 },
  gridIcon: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  gridLabel: { fontSize: 11, fontFamily: "Poppins_400Regular", textAlign: "center", paddingHorizontal: 2 },

  logoutBtn: {
    marginHorizontal: 16, marginTop: 18, borderRadius: 16, borderWidth: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14,
  },
  logoutText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },

  versionText: { textAlign: "center", fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 14 },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
