import React, { useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Switch, RefreshControl, Dimensions, FlatList,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { API, resolveMediaUrl } from "@/services/api";
import type { HostLevelResponse } from "@/services/api";
import { openBannerLink } from "@/utils/bannerLink";
import PromoBannerCard from "@/components/PromoBannerCard";
import { showErrorToast } from "@/components/Toast";
import { useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { SkeletonStatsCard } from "@/components/SkeletonCard";
import LevelCard from "@/components/LevelCard";
import RatesEditorSheet from "@/components/RatesEditorSheet";

const BANNER_W = Dimensions.get("window").width - 32;

// Admin-managed promotional banners (GET /api/banners?position=home). Mirrors
// the user app's home banner rail so operators can run host-facing campaigns
// (payout boosts, events, announcements). Auto-advances every 4s; tapping a
// banner with a cta_link opens it. Renders nothing when there are no banners.
function HostBanners({ banners }: { banners: any[] }) {
  const listRef = useRef<FlatList<any>>(null);
  const idx = useRef(0);
  const [active, setActive] = useState(0);

  React.useEffect(() => {
    if (!banners || banners.length <= 1) return;
    const t = setInterval(() => {
      idx.current = (idx.current + 1) % banners.length;
      try {
        listRef.current?.scrollToOffset({ offset: idx.current * BANNER_W, animated: true });
      } catch { /* list not ready */ }
      setActive(idx.current);
    }, 4000);
    return () => clearInterval(t);
  }, [banners?.length]);

  if (!banners || banners.length === 0) return null;

  return (
    <View style={{ marginBottom: 16 }}>
      <FlatList
        ref={listRef}
        data={banners}
        keyExtractor={(b) => String(b.id)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={BANNER_W}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16 }}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / BANNER_W);
          idx.current = i;
          setActive(i);
        }}
        renderItem={({ item }) => (
          <View style={{ width: BANNER_W }}>
            <PromoBannerCard banner={item} width={BANNER_W} onPress={() => openBannerLink(item)} />
          </View>
        )}
      />
      {banners.length > 1 && (
        <View style={hostBannerStyles.dotsRow}>
          {banners.map((_, i) => (
            <View key={i} style={[hostBannerStyles.dot, active === i && hostBannerStyles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const hostBannerStyles = StyleSheet.create({
  card: { height: 120, borderRadius: 18, overflow: "hidden", justifyContent: "center" },
  bg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  textWrap: { padding: 18, gap: 6 },
  title: { color: "#fff", fontSize: 17, fontFamily: "Poppins_700Bold" },
  subtitle: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Poppins_400Regular" },
  ctaPill: { alignSelf: "flex-start", marginTop: 6, backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  ctaText: { color: "#fff", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(0,0,0,0.18)" },
  dotActive: { width: 18, backgroundColor: "#A00EE7" },
});

export default function HostHomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, setOnlineStatus } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const {
    permissions, isBlocked,
    requestMicrophone, requestCamera, requestNotifications,
    openSettings, refresh: refreshPermissions,
  } = usePermissions();

  // FIX: Single source of truth — sirf AuthContext se isOnline lo, local state nahi
  // setOnlineStatus already optimistic update karta hai AuthContext mein
  const isOnline = user?.isOnline ?? false;

  // FIX: Double-tap debounce for online toggle
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [ratesSheetOpen, setRatesSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [permDialog, setPermDialog] = useState<"microphone" | "camera" | "notifications" | null>(null);
  const topPad = insets.top;

  // FIX: Permissions refresh on every focus — stale status avoid karo
  useFocusEffect(useCallback(() => {
    refreshPermissions();
  }, [refreshPermissions]));

  const { data: earningsData, isLoading: earningsLoading } = useQuery({
    queryKey: ['host-earnings'],
    queryFn: () => API.getEarnings(),
    staleTime: 2 * 60_000,
    retry: 2,
  });

  // Level system — current level + progress towards the next rung
  const { data: levelData, isLoading: levelLoading } = useQuery<HostLevelResponse>({
    queryKey: ['host-level'],
    queryFn: () => API.getHostLevel(),
    staleTime: 2 * 60_000,
    retry: 2,
  });

  // Host profile — used for the live per-minute call rates (coin edit system)
  const { data: hostMe } = useQuery({
    queryKey: ['host-me'],
    queryFn: () => API.getHostMe(),
    staleTime: 2 * 60_000,
    retry: 1,
  });

  const audioRate = Number(hostMe?.audio_coins_per_minute ?? hostMe?.coins_per_minute ?? 25);
  const videoRate = Number(hostMe?.video_coins_per_minute ?? (hostMe?.coins_per_minute ? Number(hostMe.coins_per_minute) + 5 : 40));

  // Admin-managed home banners (host-facing campaigns). Best-effort: errors /
  // empty just hide the rail. Cached 5 min like the user app.
  const { data: bannersData = [] } = useQuery({
    queryKey: ['host-banners', 'home'],
    queryFn: () => API.getBanners('home'),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const banners: any[] = (bannersData as any[]) ?? [];

  // Hide the "Permissions Required" block once everything is granted — a wall of
  // green "Granted" rows is just noise for a fully set-up host.
  const allPermsGranted =
    permissions.microphone.status === "granted" &&
    permissions.camera.status === "granted" &&
    permissions.notifications.status === "granted";

  // FIX: Unread notification count for bell badge
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['host-notif-unread'],
    queryFn: async () => {
      try {
        const data = await API.getNotifications() as any[];
        return Array.isArray(data) ? data.filter((n: any) => !n.is_read).length : 0;
      } catch { return 0; }
    },
    staleTime: 30_000,
  });

  const stats = (() => {
    if (!earningsData) return { calls: "—", hours: "—", earnings: "—" };
    const d = earningsData as any;
    const h = d.host ?? {};
    const minutes = Number(h.total_minutes) || 0;
    // FIX: total_calls ab backend se aata hai accurately
    const sessions = Number(h.total_calls) || 0;
    const earnings = Number(h.total_earnings) || 0;
    // FIX: "0h 0m" ke bajaye "0" dikhao
    const hoursDisplay = minutes === 0
      ? "0"
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return {
      calls: String(sessions),
      hours: hoursDisplay,
      earnings: earnings.toLocaleString(),
    };
  })();

  // FIX: refetchQueries — actual data fetch hoga, sirf stale mark nahi
  useFocusEffect(useCallback(() => {
    queryClient.refetchQueries({ queryKey: ['host-earnings'] });
    queryClient.refetchQueries({ queryKey: ['host-level'] });
  }, [queryClient]));

  // Call khatam hone par coin event — earnings + level refresh
  useSocketEvent(SocketEvents.COIN_DEDUCTED, () => {
    queryClient.refetchQueries({ queryKey: ['host-earnings'] });
    queryClient.refetchQueries({ queryKey: ['host-level'] });
    queryClient.invalidateQueries({ queryKey: ['host-notif-unread'] });
  }, [queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['host-earnings'] }),
        queryClient.refetchQueries({ queryKey: ['host-level'] }),
        queryClient.refetchQueries({ queryKey: ['host-me'] }),
        queryClient.refetchQueries({ queryKey: ['host-notif-unread'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  // FIX: Online toggle with debounce — double-tap race condition fix
  // Plus: surface server error messages (KYC missing, session expired, network)
  // and guard against setState-after-unmount when the toggle awaits the API.
  const handleOnlineToggle = useCallback(async (v: boolean) => {
    if (togglingOnline) return;
    setTogglingOnline(true);
    try {
      await setOnlineStatus(v);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("HOST_NOT_FOUND") || msg.toLowerCase().includes("kyc")) {
        // Specific message — host record missing on the backend (e.g. KYC pending)
        showErrorToast(
          "Host profile setup pending. Please complete your KYC application.",
          "Profile Incomplete"
        );
      } else if (msg === "SESSION_EXPIRED" || msg.toLowerCase().includes("unauthorized")) {
        // Auto-logout already happened in apiRequest — no toast needed
        // (the user is being redirected to /auth/login)
      } else if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch")) {
        showErrorToast("Network unavailable. Check your connection and try again.");
      } else {
        // Show server message when present, fall back to generic Hinglish
        showErrorToast(msg || "Status update karne mein error. Dobara try karo.");
      }
    } finally {
      setTogglingOnline(false);
    }
  }, [togglingOnline, setOnlineStatus]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
      }
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.dottedBorder, { borderColor: colors.primary }]}>
            <Image
              source={{ uri: resolveMediaUrl(user?.avatar) ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "host"}` }}
              style={styles.headerAvatar}
            />
          </View>
          <View style={{ gap: 2 }}>
            <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>{user?.name ?? "Host"}</Text>
            <View style={[styles.idBadge, { backgroundColor: colors.accentLight }]}>
              <Image source={require("@/assets/icons/ic_id_badge.png")} style={styles.idIcon} tintColor="#9D82B6" resizeMode="contain" />
              <Text style={[styles.idText, { color: "#9D82B6" }]}>ID: {(user?.id ?? "00000000").slice(0,8).toUpperCase()}</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => router.push("/(tabs)/wallet")} activeOpacity={0.8} style={[styles.coinBadge, { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={`Wallet, ${user?.coins ?? 0} coins`}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
            <Text style={styles.coinText}>{user?.coins ?? 0}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/notifications")} style={[styles.bellBtn, { backgroundColor: colors.surface }]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={(unreadCount as number) > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}>
            <Image source={require("@/assets/icons/ic_notify.png")} style={styles.bellIcon} tintColor={colors.text} resizeMode="contain" />
            {(unreadCount as number) > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{(unreadCount as number) > 99 ? "99+" : String(unreadCount)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Online status toggle banner */}
      <LinearGradient
        colors={isOnline ? ["#0BAF23", "#07901C"] : [colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.statusBanner, { marginHorizontal: 16 }]}
      >
        <View style={styles.statusIconWrap}>
          <View style={styles.statusPulse} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusTitle}>{isOnline ? t.homeScreen.online : t.homeScreen.offline}</Text>
          <Text style={styles.statusSub}>{isOnline ? t.homeScreen.onlineSub : t.homeScreen.offlineSub}</Text>
        </View>
        <Switch
          value={isOnline}
          onValueChange={handleOnlineToggle}
          disabled={togglingOnline}
          trackColor={{ false: "rgba(255,255,255,0.3)", true: "rgba(255,255,255,0.55)" }}
          thumbColor={togglingOnline ? "rgba(255,255,255,0.5)" : "#fff"}
        />
      </LinearGradient>

      {/* Admin-managed promotional banners */}
      <HostBanners banners={banners} />

      {/* Level system card — current level + progress to next */}
      <LevelCard
        data={levelData}
        loading={levelLoading}
        onPress={() => router.push("/level-benefits")}
      />

      {/* Stats — OPTIMIZATION #8: skeleton while earnings are loading */}
      {earningsLoading ? (
        <SkeletonStatsCard />
      ) : (
        <View style={[styles.statsCard, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
          {[
            { label: t.homeScreen.totalCalls, value: stats.calls, icon: require("@/assets/icons/ic_call.png"), tint: colors.blue },
            { label: t.homeScreen.totalHours, value: stats.hours, icon: require("@/assets/icons/ic_experience.png"), tint: colors.accent },
            { label: t.homeScreen.earnings, value: stats.earnings, icon: require("@/assets/icons/ic_coin.png"), tint: colors.coinGold, noTint: true },
          ].map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={[styles.statDiv, { backgroundColor: colors.border }]} />}
              <View style={styles.stat}>
                <View style={[styles.statIconChip, { backgroundColor: s.tint + "1A" }]}>
                  <Image source={s.icon} style={styles.statIconImg} tintColor={(s as any).noTint ? undefined : s.tint} resizeMode="contain" />
                </View>
                <Text style={[styles.statValue, { color: colors.text }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Coin & Rates card — host "coin edit system" inline on the dashboard */}
      <View style={[styles.ratesCard, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
        <View style={styles.ratesHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.ratesTitle, { color: colors.text }]}>{t.homeScreen.yourCallRates}</Text>
            <Text style={[styles.ratesSub, { color: colors.mutedForeground }]}>{t.homeScreen.ratesSub}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setRatesSheetOpen(true)}
            activeOpacity={0.85}
            style={[styles.editBtn, { backgroundColor: colors.accentLight, borderColor: colors.accentBorder }]}
          >
            <Text style={[styles.editBtnText, { color: colors.accent }]}>{t.homeScreen.edit}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.ratesRow}>
          <View style={[styles.rateItem, { backgroundColor: colors.surface }]}>
            <View style={[styles.rateIconChip, { backgroundColor: colors.blue + "1A" }]}>
              <Image source={require("@/assets/icons/ic_call.png")} style={styles.rateIconImg} tintColor={colors.blue} resizeMode="contain" />
            </View>
            <View>
              <Text style={[styles.rateValue, { color: colors.text }]}>{audioRate}</Text>
              <Text style={[styles.rateUnit, { color: colors.mutedForeground }]}>{t.homeScreen.audioPerMin}</Text>
            </View>
          </View>
          <View style={[styles.rateItem, { backgroundColor: colors.surface }]}>
            <View style={[styles.rateIconChip, { backgroundColor: colors.accent + "1A" }]}>
              <Image source={require("@/assets/icons/ic_video.png")} style={styles.rateIconImg} tintColor={colors.accent} resizeMode="contain" />
            </View>
            <View>
              <Text style={[styles.rateValue, { color: colors.text }]}>{videoRate}</Text>
              <Text style={[styles.rateUnit, { color: colors.mutedForeground }]}>{t.homeScreen.videoPerMin}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Quick Actions — host self-service tools */}
      <View style={styles.quickSection}>
        <Text style={[styles.quickTitle, { color: colors.text }]}>{t.homeScreen.manage}</Text>
        <View style={styles.quickGrid}>
          {([
            { icon: require("@/assets/icons/ic_coin.png"), tint: colors.coinGold, noTint: true, label: t.homeScreen.qaCallRates, desc: t.homeScreen.qaCallRatesDesc, onPress: () => router.push("/call-rates") },
            { icon: require("@/assets/icons/ic_topic.png"), tint: colors.accent, label: t.homeScreen.qaTopics, desc: t.homeScreen.qaTopicsDesc, onPress: () => router.push("/manage-topics") },
            { icon: require("@/assets/icons/ic_transaction.png"), tint: colors.green, label: t.homeScreen.qaEarnings, desc: t.homeScreen.qaEarningsDesc, onPress: () => router.push("/earnings-history") },
            { icon: require("@/assets/icons/ic_withdraw.png"), tint: colors.blue, label: t.homeScreen.qaPayouts, desc: t.homeScreen.qaPayoutsDesc, onPress: () => router.push("/payout-method") },
            { icon: require("@/assets/icons/ic_wallet.png"), tint: colors.accent, label: t.homeScreen.qaWallet, desc: t.homeScreen.qaWalletDesc, onPress: () => router.push("/(tabs)/wallet") },
            { icon: require("@/assets/icons/ic_call.png"), tint: colors.blue, label: t.homeScreen.qaCallHistory, desc: t.homeScreen.qaCallHistoryDesc, onPress: () => router.push("/calls/history") },
            { icon: require("@/assets/icons/ic_bonus.png"), tint: colors.orange, noTint: true, label: t.homeScreen.qaRefer, desc: t.homeScreen.qaReferDesc, onPress: () => router.push("/referral") },
            { icon: require("@/assets/icons/ic_profile.png"), tint: colors.primary, label: t.homeScreen.qaProfile, desc: t.homeScreen.qaProfileDesc, onPress: () => router.push("/(tabs)/profile") },
            { icon: require("@/assets/icons/ic_settings.png"), tint: colors.mutedForeground, label: t.homeScreen.qaSettings, desc: t.homeScreen.qaSettingsDesc, onPress: () => router.push("/settings") },
          ] as { icon: any; tint: string; noTint?: boolean; label: string; desc: string; onPress: () => void }[]).map((q) => (
            <TouchableOpacity
              key={q.label}
              style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.borderLight }]}
              onPress={q.onPress}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={q.label}
            >
              <View style={[styles.quickIconWrap, { backgroundColor: q.tint + "1A" }]}>
                <Image source={q.icon} style={styles.quickIconImg} tintColor={q.noTint ? undefined : q.tint} resizeMode="contain" />
              </View>
              <Text style={[styles.quickLabel, { color: colors.text }]} numberOfLines={1}>{q.label}</Text>
              <Text style={[styles.quickDesc, { color: colors.mutedForeground }]} numberOfLines={1}>{q.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Host image / promo */}
      <Image
        source={require("@/assets/images/host_home.png")}
        style={styles.promoImg}
        resizeMode="contain"
      />

      {/* Permission dialog */}
      {permDialog && (
        <PermissionDialog
          visible
          config={{
            ...PERMISSION_CONFIGS[permDialog],
            isBlocked: isBlocked(permDialog as any),
          }}
          onAllow={async () => {
            if (isBlocked(permDialog as any)) {
              openSettings();
            } else if (permDialog === "microphone") {
              await requestMicrophone();
            } else if (permDialog === "camera") {
              await requestCamera();
            } else if (permDialog === "notifications") {
              await requestNotifications();
            }
            // FIX: Permission status reload karo — dialog band hone ke baad row update ho
            await refreshPermissions();
            setPermDialog(null);
          }}
          onDeny={() => setPermDialog(null)}
        />
      )}

      {/* Permission reminders — only while something still needs granting */}
      {!allPermsGranted && (
      <View style={styles.permSection}>
        <Text style={[styles.permTitle, { color: colors.text }]}>{t.homeScreen.permsRequired}</Text>
        {([
          {
            icon: require("@/assets/icons/ic_mic.png"),
            label: t.homeScreen.micLabel,
            desc: t.homeScreen.micDesc,
            granted: permissions.microphone.status === "granted",
            key: "microphone" as const,
          },
          {
            icon: require("@/assets/icons/ic_video.png"),
            label: t.homeScreen.cameraLabel,
            desc: t.homeScreen.cameraDesc,
            granted: permissions.camera.status === "granted",
            key: "camera" as const,
          },
          {
            icon: require("@/assets/icons/ic_notify.png"),
            label: t.homeScreen.notifLabel,
            desc: t.homeScreen.notifDesc,
            granted: permissions.notifications.status === "granted",
            key: "notifications" as const,
          },
        ] as const).map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.permRow, { backgroundColor: colors.card }]}
            onPress={() => { if (!p.granted) setPermDialog(p.key); }}
            activeOpacity={p.granted ? 1 : 0.75}
          >
            <View style={[styles.permIconWrap, { backgroundColor: p.granted ? colors.surface : colors.surface }]}>
              <Image source={p.icon} style={styles.permIcon} tintColor={p.granted ? "#0BAF23" : "#E84855"} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.permLabel, { color: colors.text }]}>{p.label}</Text>
              <Text style={[styles.permDesc, { color: colors.mutedForeground }]}>{p.desc}</Text>
            </View>
            <Text style={[styles.permStatus, { color: p.granted ? "#0BAF23" : "#E84855" }]}>
              {p.granted ? t.homeScreen.granted : t.homeScreen.tapToAllow}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      )}

      {/* Tips for hosts */}
      <View style={[styles.tipsCard, { backgroundColor: colors.accentLight, marginHorizontal: 16 }]}>
        <Text style={[styles.tipsTitle, { color: colors.text }]}>{t.homeScreen.hostTips}</Text>
        {[
          t.homeScreen.tip1,
          t.homeScreen.tip2,
          t.homeScreen.tip3,
          t.homeScreen.tip4,
        ].map((tip, i) => (
          <View key={i} style={styles.tipRow}>
            <View style={[styles.tipDot, { backgroundColor: colors.accent }]} />
            <Text style={[styles.tipText, { color: colors.text }]}>{tip}</Text>
          </View>
        ))}
      </View>

      {/* Coin edit system — rates editor bottom sheet */}
      <RatesEditorSheet
        visible={ratesSheetOpen}
        onClose={() => setRatesSheetOpen(false)}
        initialAudio={audioRate}
        initialVideo={videoRate}
        // Effective per-channel ceilings = admin level cap + 5 bonus headroom,
        // clamped to the global 500 coins/min absolute max. Falls back to the
        // legacy combined max_rate when an older API response is in flight.
        maxAudioRate={Math.min(
          500,
          (levelData?.perks?.max_audio_rate ?? levelData?.perks?.max_rate ?? 500) + 5,
        )}
        maxVideoRate={Math.min(
          500,
          (levelData?.perks?.max_video_rate ?? levelData?.perks?.max_rate ?? 500) + 5,
        )}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['host-me'] });
        }}
      />

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 16 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  dottedBorder: { borderWidth: 1.5, borderRadius: 28, borderStyle: "dashed" as any, padding: 2 },
  headerAvatar: { width: 48, height: 48, borderRadius: 24 },
  headerName: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  idBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  idIcon: { width: 10, height: 10 },
  idText: { fontSize: 10, fontFamily: "Poppins_500Medium" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  coinBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  coinIcon: { width: 18, height: 18 },
  coinText: { color: "#fff", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  bellBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  bellIcon: { width: 18, height: 18 },
  notifBadge: {
    position: "absolute", top: -2, right: -2,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: "#E84855", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 3, borderWidth: 1.5, borderColor: "#fff",
  },
  notifBadgeText: { color: "#fff", fontSize: 9, fontFamily: "Poppins_700Bold" },
  statusBanner: { borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  statusIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  statusPulse: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#fff" },
  statusTitle: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  statusSub: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  statsCard: { borderRadius: 16, padding: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-around", marginBottom: 16 },
  stat: { alignItems: "center", gap: 5, flex: 1 },
  statIconChip: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  statIconImg: { width: 17, height: 17 },
  statValue: { fontSize: 19, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 40 },
  ratesCard: { borderRadius: 16, padding: 16, marginBottom: 16, gap: 14 },
  ratesHeader: { flexDirection: "row", alignItems: "center" },
  ratesTitle: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  ratesSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  editBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  editBtnText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  ratesRow: { flexDirection: "row", gap: 12 },
  rateItem: { flex: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  rateIconChip: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rateIconImg: { width: 18, height: 18 },
  rateValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  rateUnit: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: -2 },
  promoImg: { width: "100%", height: 160, marginBottom: 16 },
  quickSection: { paddingHorizontal: 16, marginBottom: 16 },
  quickTitle: { fontSize: 17, fontFamily: "Poppins_700Bold", marginBottom: 14 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  quickCard: {
    width: "31.5%",
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    shadowColor: "#111329",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  quickIconWrap: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  quickIconImg: { width: 24, height: 24 },
  quickLabel: { fontSize: 12.5, fontFamily: "Poppins_600SemiBold", textAlign: "center" },
  quickDesc: { fontSize: 9.5, fontFamily: "Poppins_400Regular", textAlign: "center" },
  permSection: { paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  permTitle: { fontSize: 16, fontFamily: "Poppins_700Bold", marginBottom: 4 },
  permRow: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  permIconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  permIcon: { width: 22, height: 22 },
  permLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  permDesc: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  permStatus: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  tipsCard: { borderRadius: 16, padding: 16, marginBottom: 16, gap: 8 },
  tipsTitle: { fontSize: 15, fontFamily: "Poppins_700Bold", marginBottom: 4 },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  tipDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 6 },
  tipText: { flex: 1, fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 20 },
});
