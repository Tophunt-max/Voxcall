import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Switch
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";

export default function HostDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [isOnline, setIsOnline] = useState(false);
  const [stats, setStats] = useState({ calls: "…", hours: "…h", earnings: "…" });
  const topPad = insets.top;

  useEffect(() => {
    API.getEarnings()
      .then((data: any) => {
        const h = data.host ?? {};
        const minutes = Number(h.total_minutes) || 0;
        const sessions = (data.transactions || []).length;
        const earnings = Number(h.total_earnings) || 0;
        setStats({
          calls: String(sessions),
          hours: `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
          earnings: earnings.toLocaleString(),
        });
      })
      .catch(() => { setStats({ calls: "0", hours: "0h", earnings: "0" }); showErrorToast("Failed to load dashboard data."); });
  }, []);

  const quickActions = [
    { icon: "phone", label: "Call History", onPress: () => router.push("/calls/history"), color: "#A00EE7" },
    { icon: "message-circle", label: "Messages", onPress: () => router.push("/calls/history"), color: "#0078CC" },
    { icon: "dollar-sign", label: "Earnings", onPress: () => router.push("/earnings"), color: "#0BAF23" },
    { icon: "settings", label: "Settings", onPress: () => router.push("/settings"), color: "#FF9800" },
  ];

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
              <Feather name="shield" size={10} color="#9D82B6" />
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
            <Feather name="bell" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Online toggle */}
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
          onValueChange={async (v) => {
            setIsOnline(v);
            try { await API.setHostOnline(v); } catch { setIsOnline(!v); showErrorToast("Failed to update online status."); }
          }}
          trackColor={{ false: "rgba(255,255,255,0.3)", true: "rgba(255,255,255,0.6)" }}
          thumbColor="#fff"
        />
      </View>

      {/* Stats */}
      <View style={[styles.statsCard, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
        {[
          { label: "Total Calls", value: stats.calls, icon: "phone" },
          { label: "Total Hours", value: stats.hours, icon: "clock" },
          { label: "Earnings", value: stats.earnings, icon: "trending-up" },
        ].map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <View style={[styles.statDiv, { backgroundColor: colors.border }]} />}
            <View style={styles.stat}>
              <Feather name={s.icon as any} size={18} color={colors.primary} style={{ marginBottom: 4 }} />
              <Text style={[styles.statValue, { color: colors.text }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {/* Quick Actions */}
      <Text style={[styles.sectionTitle, { color: colors.text, paddingHorizontal: 16, marginTop: 20, marginBottom: 10 }]}>Quick Actions</Text>
      <View style={styles.quickGrid}>
        {quickActions.map((a) => (
          <TouchableOpacity key={a.label} style={[styles.quickBtn, { backgroundColor: colors.card }]} onPress={a.onPress} activeOpacity={0.8}>
            <View style={[styles.quickIcon, { backgroundColor: a.color + "20" }]}>
              <Feather name={a.icon as any} size={22} color={a.color} />
            </View>
            <Text style={[styles.quickLabel, { color: colors.text }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tips */}
      <View style={[styles.tipsCard, { backgroundColor: "#F0E4F8", marginHorizontal: 16, marginTop: 16 }]}>
        <Text style={[styles.tipsTitle, { color: "#111329" }]}>Host Tips</Text>
        {[
          "Be online during peak hours (6PM - 10PM)",
          "Complete your profile for more bookings",
          "Respond quickly to improve your rating",
          "Add more topics to reach more users",
        ].map((tip, i) => (
          <View key={i} style={styles.tipRow}>
            <View style={[styles.tipDot, { backgroundColor: "#A00EE7" }]} />
            <Text style={[styles.tipText, { color: "#111329" }]}>{tip}</Text>
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
  idText: { fontSize: 10, fontFamily: "Poppins_500Medium" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  coinBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  coinIcon: { width: 18, height: 18 },
  coinText: { color: "#fff", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  bellBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  statusBanner: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", marginBottom: 16 },
  statusTitle: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  statusSub: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  statsCard: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-around", marginBottom: 8 },
  stat: { alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 50 },
  sectionTitle: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 12 },
  quickBtn: { width: "44%", flexGrow: 1, borderRadius: 16, padding: 16, alignItems: "center", gap: 10 },
  quickIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontSize: 13, fontFamily: "Poppins_500Medium", textAlign: "center" },
  tipsCard: { borderRadius: 16, padding: 16, marginBottom: 16, gap: 8 },
  tipsTitle: { fontSize: 15, fontFamily: "Poppins_700Bold", marginBottom: 4 },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  tipDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 6 },
  tipText: { flex: 1, fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 20 },
});
