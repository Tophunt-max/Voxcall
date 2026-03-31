import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Platform, Switch
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

const HOST_STATS = [
  { label: "Total Calls", value: "0" },
  { label: "Total Hours", value: "0h" },
  { label: "Earnings", value: "0" },
];

export default function HostHomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, switchRole } = useAuth();
  const [isOnline, setIsOnline] = useState(false);
  const topPad = insets.top;

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
              source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "host"}` }}
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
          onValueChange={setIsOnline}
          trackColor={{ false: "rgba(255,255,255,0.3)", true: "rgba(255,255,255,0.6)" }}
          thumbColor="#fff"
        />
      </View>

      {/* Stats */}
      <View style={[styles.statsCard, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
        {HOST_STATS.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <View style={[styles.statDiv, { backgroundColor: colors.border }]} />}
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.text }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {/* Host image / promo */}
      <Image
        source={require("@/assets/images/host_home.png")}
        style={styles.promoImg}
        resizeMode="contain"
      />

      {/* Permission reminders */}
      <View style={styles.permSection}>
        <Text style={[styles.permTitle, { color: colors.text }]}>Permissions Required</Text>
        {[
          { icon: require("@/assets/icons/ic_mic.png"), label: "Microphone", desc: "Required for audio calls", granted: true },
          { icon: require("@/assets/icons/ic_video.png"), label: "Camera", desc: "Required for video calls", granted: false },
          { icon: require("@/assets/images/icon_bluetooth.png"), label: "Bluetooth", desc: "For bluetooth headsets", granted: true },
        ].map((p, i) => (
          <View key={i} style={[styles.permRow, { backgroundColor: colors.card }]}>
            <View style={[styles.permIconWrap, { backgroundColor: p.granted ? "#E8F5E9" : "#FFF3F3" }]}>
              <Image source={p.icon} style={styles.permIcon} tintColor={p.granted ? "#0BAF23" : "#E84855"} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.permLabel, { color: colors.text }]}>{p.label}</Text>
              <Text style={[styles.permDesc, { color: colors.mutedForeground }]}>{p.desc}</Text>
            </View>
            <Text style={[styles.permStatus, { color: p.granted ? "#0BAF23" : "#E84855" }]}>
              {p.granted ? "Granted" : "Required"}
            </Text>
          </View>
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

      {/* Switch back to user */}
      <TouchableOpacity
        style={[styles.switchBtn, { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: 16 }]}
        onPress={() => { switchRole("user"); router.replace("/screens/user"); }}
        activeOpacity={0.8}
      >
        <Image source={require("@/assets/icons/ic_users.png")} style={styles.switchIcon} tintColor={colors.mutedForeground} resizeMode="contain" />
        <Text style={[styles.switchText, { color: colors.mutedForeground }]}>Switch to User Mode</Text>
      </TouchableOpacity>
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
