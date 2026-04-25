import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Switch
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";
import { useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { SkeletonStatsCard } from "@/components/SkeletonCard";

export default function HostHomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, setOnlineStatus } = useAuth();
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
  }, [queryClient]));

  // Call khatam hone par coin event — earnings refresh
  useSocketEvent(SocketEvents.COIN_DEDUCTED, () => {
    queryClient.refetchQueries({ queryKey: ['host-earnings'] });
    queryClient.invalidateQueries({ queryKey: ['host-notif-unread'] });
  }, [queryClient]);

  // FIX: Online toggle with debounce — double-tap race condition fix
  const handleOnlineToggle = useCallback(async (v: boolean) => {
    if (togglingOnline) return;
    setTogglingOnline(true);
    try {
      await setOnlineStatus(v);
    } catch {
      showErrorToast("Status update karne mein error. Dobara try karo.");
    } finally {
      setTogglingOnline(false);
    }
  }, [togglingOnline, setOnlineStatus]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.dottedBorder, { borderColor: colors.primary }]}>
            <Image
              source={{ uri: resolveMediaUrl(user?.avatar) ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "host"}` }}
              style={styles.headerAvatar}
            />
          </View>
          <View style={{ gap: 2 }}>
            <Text style={[styles.headerName, { color: colors.text }]}>{user?.name ?? "Host"}</Text>
            <View style={[styles.idBadge, { backgroundColor: "#F0E4F8" }]}>
              <Image source={require("@/assets/icons/ic_id_badge.png")} style={styles.idIcon} tintColor="#9D82B6" resizeMode="contain" />
              <Text style={[styles.idText, { color: "#9D82B6" }]}>ID: {(user?.id ?? "00000000").slice(0,8).toUpperCase()}</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.coinBadge, { backgroundColor: colors.primary }]}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
            <Text style={styles.coinText}>{user?.coins ?? 0}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/notifications")} style={[styles.bellBtn, { backgroundColor: colors.surface }]}>
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
      <View style={[styles.statusBanner, {
        backgroundColor: isOnline ? "#0BAF23" : colors.primary,
        marginHorizontal: 16,
      }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusTitle}>{isOnline ? "You are Online" : "Go Online"}</Text>
          <Text style={styles.statusSub}>{isOnline ? "You can receive calls now" : "Toggle to start accepting calls"}</Text>
        </View>
        <Switch
          value={isOnline}
          onValueChange={handleOnlineToggle}
          disabled={togglingOnline}
          trackColor={{ false: "rgba(255,255,255,0.3)", true: "rgba(255,255,255,0.6)" }}
          thumbColor={togglingOnline ? "rgba(255,255,255,0.5)" : "#fff"}
        />
      </View>

      {/* Stats — OPTIMIZATION #8: skeleton while earnings are loading */}
      {earningsLoading ? (
        <SkeletonStatsCard />
      ) : (
        <View style={[styles.statsCard, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
          {[
            { label: "Total Calls", value: stats.calls },
            { label: "Total Hours", value: stats.hours },
            { label: "Earnings", value: stats.earnings },
          ].map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={[styles.statDiv, { backgroundColor: colors.border }]} />}
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.text }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

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

      {/* Permission reminders */}
      <View style={styles.permSection}>
        <Text style={[styles.permTitle, { color: colors.text }]}>Permissions Required</Text>
        {([
          {
            icon: require("@/assets/icons/ic_mic.png"),
            label: "Microphone",
            desc: "Required for audio calls",
            granted: permissions.microphone.status === "granted",
            key: "microphone" as const,
          },
          {
            icon: require("@/assets/icons/ic_video.png"),
            label: "Camera",
            desc: "Required for video calls",
            granted: permissions.camera.status === "granted",
            key: "camera" as const,
          },
          {
            icon: require("@/assets/icons/ic_notify.png"),
            label: "Notifications",
            desc: "For incoming call alerts",
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
            <View style={[styles.permIconWrap, { backgroundColor: p.granted ? "#E8F5E9" : "#FFF3F3" }]}>
              <Image source={p.icon} style={styles.permIcon} tintColor={p.granted ? "#0BAF23" : "#E84855"} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.permLabel, { color: colors.text }]}>{p.label}</Text>
              <Text style={[styles.permDesc, { color: colors.mutedForeground }]}>{p.desc}</Text>
            </View>
            <Text style={[styles.permStatus, { color: p.granted ? "#0BAF23" : "#E84855" }]}>
              {p.granted ? "Granted" : "Tap to allow"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tips for hosts */}
      <View style={[styles.tipsCard, { backgroundColor: "#F0E4F8", marginHorizontal: 16 }]}>
        <Text style={[styles.tipsTitle, { color: colors.text }]}>Host Tips</Text>
        {[
          "Be online during peak hours (6PM - 10PM)",
          "Complete your profile for more bookings",
          "Respond quickly to improve your rating",
          "Add more topics to reach more users",
        ].map((tip, i) => (
          <View key={i} style={styles.tipRow}>
            <View style={[styles.tipDot, { backgroundColor: colors.accent }]} />
            <Text style={[styles.tipText, { color: colors.text }]}>{tip}</Text>
          </View>
        ))}
      </View>

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
  statusBanner: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", marginBottom: 16 },
  statusTitle: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  statusSub: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  statsCard: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-around", marginBottom: 16 },
  stat: { alignItems: "center", gap: 4 },
  statValue: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 40 },
  promoImg: { width: "100%", height: 160, marginBottom: 16 },
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
  switchBtn: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, justifyContent: "center" },
  switchIcon: { width: 18, height: 18 },
  switchText: { fontSize: 14, fontFamily: "Poppins_500Medium" },
});
