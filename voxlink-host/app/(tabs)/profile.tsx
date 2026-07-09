import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Platform, Alert, Switch, ActivityIndicator, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import * as ClipboardModule from "expo-clipboard";
import { appendFileToFormData } from "@/utils/fileUpload";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useLanguage } from "@/context/LanguageContext";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

type FeatherName = keyof typeof Feather.glyphMap;

export default function HostProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, updateProfile, setOnlineStatus } = useAuth();
  const { permissions, requestNotifications, openSettings } = usePermissions();
  const { t } = useLanguage();

  const [isOnline, setIsOnline] = useState(user?.isOnline ?? false);
  const [hostStats, setHostStats] = useState({ calls: "—", rating: "—" });
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showNotifDialog, setShowNotifDialog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const topPad = insets.top;
  const bottomPad = insets.bottom;
  const uniqueId = user?.id?.slice(0, 8).toUpperCase() ?? "00000000";

  const notificationsGranted = permissions.notifications.status === "granted";
  const notifBlocked =
    permissions.notifications.status === "blocked" ||
    (permissions.notifications.status === "denied" && !permissions.notifications.canAskAgain);

  useEffect(() => {
    if (user?.isOnline !== undefined) setIsOnline(user.isOnline);
  }, [user?.isOnline]);

  const loadStats = useCallback(async () => {
    try {
      const data: any = await API.getEarnings();
      const h = data.host ?? {};
      setHostStats({
        calls: String(data.transactions?.length ?? 0),
        rating: h.rating ? Number(h.rating).toFixed(1) : "—",
      });
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadStats();
    } finally {
      setRefreshing(false);
    }
  }, [loadStats]);

  const handleLogout = () => {
    Alert.alert(t.profileScreen.signOut, t.profileScreen.signOutConfirm, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.profileScreen.signOut, style: "destructive",
        onPress: async () => { await logout(); router.replace("/auth/login"); },
      },
    ]);
  };

  const copyId = async () => {
    try {
      await ClipboardModule.setStringAsync(uniqueId);
      showSuccessToast("Your unique ID has been copied.", "Copied");
    } catch {
      showErrorToast("Couldn't copy your ID.");
    }
  };

  const handleAvatarPress = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(t.profileScreen.permRequiredTitle, t.profileScreen.permRequiredMsg);
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
      const uploadData = await API.updateAvatar(formData);
      if (uploadData?.url) {
        await updateProfile({ avatar: resolveMediaUrl(uploadData.url) || uploadData.url });
        showSuccessToast(t.profileScreen.photoUpdated, t.profileScreen.photoSaved);
      }
    } catch {
      Alert.alert(t.profileScreen.uploadFailedTitle, t.profileScreen.uploadFailedMsg);
      setAvatarUri(null);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleOnlineToggle = async (v: boolean) => {
    setIsOnline(v);
    try {
      await setOnlineStatus(v);
    } catch (e: any) {
      setIsOnline(!v);
      const msg = String(e?.message || "");
      if (msg.includes("HOST_NOT_FOUND") || msg.toLowerCase().includes("kyc")) {
        showErrorToast("Host profile setup pending. Please complete your KYC application.", "Profile Incomplete");
      } else if (msg !== "SESSION_EXPIRED") {
        showErrorToast(msg || "Failed to update online status.");
      }
    }
  };

  const handleNotifToggle = (value: boolean) => {
    if (value) {
      if (notifBlocked || !notificationsGranted) setShowNotifDialog(true);
    } else {
      Alert.alert(t.profileScreen.turnOffNotifTitle, t.profileScreen.turnOffNotifMsg, [
        { text: t.common.cancel, style: "cancel" },
        { text: t.profileScreen.openSettings, onPress: openSettings },
      ]);
    }
  };

  const displayAvatar =
    avatarUri ?? resolveMediaUrl(user?.avatar) ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "host"}`;

  const quickActions: { icon: FeatherName; label: string; grad: readonly [string, string]; onPress: () => void }[] = [
    { icon: "trending-up", label: "Earnings", grad: ["#34D399", "#059669"], onPress: () => router.push("/earnings-history") },
    { icon: "dollar-sign", label: t.profileScreen.callRates, grad: ["#FFB347", "#F97316"], onPress: () => router.push("/call-rates") },
    { icon: "hash", label: t.profileScreen.myTopics, grad: ["#A54DFF", "#7B2FF7"], onPress: () => router.push("/manage-topics") },
    { icon: "gift", label: t.profileScreen.referEarn, grad: ["#FF7EB3", "#DB2777"], onPress: () => router.push("/referral") },
  ];

  const menuActions: { icon: FeatherName; label: string; onPress: () => void }[] = [
    { icon: "edit-2", label: t.profileScreen.editProfile, onPress: () => router.push("/profile/edit") },
    { icon: "calendar", label: "Availability", onPress: () => router.push("/availability") },
    { icon: "credit-card", label: "Payout", onPress: () => router.push("/payout-method") },
    { icon: "image", label: "Gallery", onPress: () => router.push("/gallery") },
    { icon: "award", label: "Level", onPress: () => router.push("/level-benefits") },
    { icon: "globe", label: t.profileScreen.language, onPress: () => router.push("/language") },
    { icon: "help-circle", label: t.profileScreen.helpCenter, onPress: () => router.push("/help-center") },
    { icon: "shield", label: t.profileScreen.privacyPolicy, onPress: () => router.push("/privacy") },
    { icon: "info", label: t.profileScreen.about, onPress: () => router.push("/about") },
    { icon: "settings", label: t.profileScreen.settings, onPress: () => router.push("/settings") },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <LinearGradient colors={[colors.surfaceAlt, colors.background]} style={[styles.backdrop, { height: 300 + topPad }]} pointerEvents="none" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomPad + 90 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        <PermissionDialog
          visible={showNotifDialog}
          config={{ ...PERMISSION_CONFIGS.notifications, isBlocked: notifBlocked }}
          onAllow={async () => {
            if (notifBlocked) openSettings();
            else await requestNotifications();
            setShowNotifDialog(false);
          }}
          onDeny={() => setShowNotifDialog(false)}
        />

        {/* Title */}
        <View style={[styles.header, { paddingTop: topPad + 14 }]}>
          <Text style={[styles.title, { color: colors.text }]}>{t.profileScreen.title}</Text>
          <TouchableOpacity onPress={() => router.push("/settings")} style={[styles.chevBtn, { backgroundColor: colors.card }]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="settings" size={18} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Profile row */}
        <View style={[styles.profileCard, { backgroundColor: colors.card }, cardShadow()]}>
          <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.85} style={styles.avatarOuter}>
            <LinearGradient colors={[colors.accent, colors.chatPurple]} style={styles.avatarRing}>
              <View style={[styles.avatarInner, { backgroundColor: colors.card }]}>
                <Image source={{ uri: displayAvatar }} style={styles.avatar} />
              </View>
            </LinearGradient>
            <View style={[styles.avatarEditBadge, { backgroundColor: colors.accent, borderColor: colors.card }]}>
              {uploadingAvatar ? <ActivityIndicator size={10} color="#fff" /> : <Feather name="camera" size={10} color="#fff" />}
            </View>
            {/* live online dot */}
            <View style={[styles.onlineDot, { backgroundColor: isOnline ? colors.online : colors.offline, borderColor: colors.card }]} />
          </TouchableOpacity>

          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{user?.name ?? "Host"}</Text>
              {hostStats.rating !== "—" && (
                <View style={styles.ratingPill}>
                  <Feather name="star" size={11} color="#F59E0B" />
                  <Text style={styles.ratingText}>{hostStats.rating}</Text>
                </View>
              )}
            </View>
            <View style={styles.subRow}>
              <View style={[styles.hostChip, { backgroundColor: colors.accentLight }]}>
                <Text style={[styles.hostChipText, { color: colors.accent }]}>{t.profileScreen.proHost}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={copyId} style={[styles.idRow, { backgroundColor: colors.surface }]}>
              <Text style={[styles.idText, { color: colors.mutedForeground }]}>ID : {uniqueId}</Text>
              <Feather name="copy" size={11} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.push("/profile/edit")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={[styles.chevBtn, { backgroundColor: colors.surface }]}>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Online + notifications toggles */}
        <View style={[styles.card, { backgroundColor: colors.card }, cardShadow()]}>
          <View style={styles.toggleRow}>
            <View style={[styles.toggleIcon, { backgroundColor: (isOnline ? colors.online : colors.offline) + "1A" }]}>
              <Feather name="radio" size={18} color={isOnline ? colors.online : colors.offline} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>{t.profileScreen.onlineStatus}</Text>
              <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>
                {isOnline ? "You're visible to callers" : "You're offline"}
              </Text>
            </View>
            <Switch value={isOnline} onValueChange={handleOnlineToggle} trackColor={{ false: colors.border, true: colors.online }} thumbColor="#fff" />
          </View>
          <View style={[styles.toggleDiv, { backgroundColor: colors.border }]} />
          <View style={styles.toggleRow}>
            <View style={[styles.toggleIcon, { backgroundColor: colors.accentLight }]}>
              <Feather name="bell" size={18} color={colors.accent} />
            </View>
            <Text style={[styles.toggleLabel, { color: colors.text, flex: 1 }]}>{t.profileScreen.pushNotifications}</Text>
            <Switch value={notificationsGranted} onValueChange={handleNotifToggle} trackColor={{ false: colors.border, true: colors.online }} thumbColor="#fff" />
          </View>
        </View>

        {/* Stats */}
        <View style={[styles.statsCard, { backgroundColor: colors.accentLight }]}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{hostStats.calls}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.profileScreen.calls}</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.accentBorder }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{hostStats.rating}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.profileScreen.rating}</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.accentBorder }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{(user?.coins ?? 0).toLocaleString()}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{t.profileScreen.coins}</Text>
          </View>
        </View>

        {/* Coins / earnings banner */}
        <TouchableOpacity activeOpacity={0.9} onPress={() => router.push("/earnings-history")} style={[styles.coinWrap, coinShadow()]}>
          <LinearGradient colors={["#FFB347", "#F97316"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.coinBanner}>
            <View style={styles.coinDeco1} pointerEvents="none" />
            <View style={styles.coinDeco2} pointerEvents="none" />
            <View style={styles.coinBadge}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 30, height: 30 }} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.coinBannerLabel}>Available Coins</Text>
              <Text style={styles.coinBannerValue}>
                {(user?.coins ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>
            <TouchableOpacity style={styles.rechargePill} onPress={() => router.push("/payout-method")} activeOpacity={0.85}>
              <Text style={styles.rechargeText}>Withdraw</Text>
              <Feather name="chevron-right" size={14} color="#F97316" />
            </TouchableOpacity>
          </LinearGradient>
        </TouchableOpacity>

        {/* Quick actions */}
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
        <TouchableOpacity onPress={handleLogout} style={[styles.logoutBtn, { backgroundColor: colors.card, borderColor: colors.destructive + "33" }]} activeOpacity={0.75}>
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive }]}>{t.profileScreen.signOut}</Text>
        </TouchableOpacity>
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Poppins_700Bold" },

  profileCard: { marginHorizontal: 16, borderRadius: 22, padding: 16, flexDirection: "row", alignItems: "center", gap: 4 },
  avatarOuter: { position: "relative" },
  avatarRing: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  avatarInner: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center" },
  avatar: { width: 60, height: 60, borderRadius: 30 },
  avatarEditBadge: { position: "absolute", right: 0, bottom: 0, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  onlineDot: { position: "absolute", left: 2, top: 2, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  profileInfo: { flex: 1, marginLeft: 14, gap: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontSize: 18, fontFamily: "Poppins_700Bold", maxWidth: "58%" },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FFF4D6", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  ratingText: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#B7791F" },
  subRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hostChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  hostChipText: { fontSize: 10, fontFamily: "Poppins_700Bold", letterSpacing: 0.5 },
  idRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  idText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  chevBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  card: { marginHorizontal: 16, marginTop: 14, borderRadius: 20, padding: 16 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toggleLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  toggleSub: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 1 },
  toggleDiv: { height: StyleSheet.hairlineWidth, marginVertical: 12 },

  statsCard: { marginHorizontal: 16, marginTop: 14, borderRadius: 18, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  stat: { alignItems: "center", gap: 4, flex: 1 },
  statValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 26 },

  coinWrap: { marginHorizontal: 16, marginTop: 16, borderRadius: 20, overflow: "hidden" },
  coinBanner: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 18, overflow: "hidden" },
  coinDeco1: { position: "absolute", right: -20, top: -28, width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(255,255,255,0.15)" },
  coinDeco2: { position: "absolute", right: 60, bottom: -40, width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(255,255,255,0.10)" },
  coinBadge: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" },
  coinBannerLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.92)" },
  coinBannerValue: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff", marginTop: 2 },
  rechargePill: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  rechargeText: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#F97316" },

  quickRow: { flexDirection: "row", justifyContent: "space-between" },
  quickTile: { alignItems: "center", gap: 8, flex: 1 },
  quickIcon: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontSize: 12, fontFamily: "Poppins_500Medium" },

  menuGrid: { flexDirection: "row", flexWrap: "wrap" },
  gridTile: { width: "25%", alignItems: "center", gap: 7, paddingVertical: 12 },
  gridIcon: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  gridLabel: { fontSize: 11, fontFamily: "Poppins_400Regular", textAlign: "center", paddingHorizontal: 2 },

  logoutBtn: { marginHorizontal: 16, marginTop: 18, borderRadius: 16, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  logoutText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
});
