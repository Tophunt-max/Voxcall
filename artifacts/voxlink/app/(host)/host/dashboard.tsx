import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Switch, Image } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function HostDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, switchRole } = useAuth();
  const [isAcceptingCalls, setIsAcceptingCalls] = useState(true);
  const [isAcceptingRandom, setIsAcceptingRandom] = useState(false);

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const stats = [
    { label: "Total Earnings", value: "2,450 Coins", icon: "trending-up" },
    { label: "Total Calls", value: "48", icon: "phone" },
    { label: "Avg Rating", value: "4.8 / 5.0", icon: "star" },
    { label: "Active Minutes", value: "1,240", icon: "clock" },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: bottomPad + 24 }}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: colors.foreground }} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Host Dashboard</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        <View style={[styles.statusCard, { backgroundColor: isAcceptingCalls ? colors.primary : colors.card, borderColor: colors.border }]}>
          <View>
            <Text style={[styles.statusTitle, { color: isAcceptingCalls ? "#fff" : colors.foreground }]}>
              {isAcceptingCalls ? "You're Online" : "You're Offline"}
            </Text>
            <Text style={[styles.statusSub, { color: isAcceptingCalls ? "rgba(255,255,255,0.8)" : colors.mutedForeground }]}>
              {isAcceptingCalls ? "Accepting incoming calls" : "Not visible to callers"}
            </Text>
          </View>
          <Switch value={isAcceptingCalls} onValueChange={setIsAcceptingCalls} trackColor={{ true: "rgba(255,255,255,0.3)", false: colors.muted }} thumbColor={isAcceptingCalls ? "#fff" : colors.mutedForeground} />
        </View>

        <View style={styles.statsGrid}>
          {stats.map((s) => (
            <View key={s.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name={s.icon as any} size={20} color={colors.primary} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Settings</Text>
          <View style={styles.settingRow}>
            <View>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>Random Matching</Text>
              <Text style={[styles.settingDesc, { color: colors.mutedForeground }]}>Accept calls from random users</Text>
            </View>
            <Switch value={isAcceptingRandom} onValueChange={setIsAcceptingRandom} trackColor={{ true: colors.primary }} />
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quick Actions</Text>
          {[
            { icon: "dollar-sign", label: "Withdraw Earnings", action: () => {} },
            { icon: "bar-chart-2", label: "View Analytics", action: () => {} },
            { icon: "user-check", label: "Verify Profile", action: () => {} },
          ].map((item) => (
            <TouchableOpacity key={item.label} onPress={item.action} style={[styles.actionRow, { borderBottomColor: colors.border }]} activeOpacity={0.75}>
              <View style={[styles.actionIcon, { backgroundColor: colors.secondary }]}>
                <Feather name={item.icon as any} size={18} color={colors.primary} />
              </View>
              <Text style={[styles.actionLabel, { color: colors.foreground }]}>{item.label}</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => switchRole("user")}
          style={[styles.switchBtn, { borderColor: colors.border }]}
          activeOpacity={0.75}
        >
          <Feather name="user" size={18} color={colors.mutedForeground} />
          <Text style={[styles.switchBtnText, { color: colors.mutedForeground }]}>Switch to User Mode</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  content: { padding: 20, gap: 16 },
  statusCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, borderWidth: 1, padding: 16 },
  statusTitle: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  statusSub: { fontSize: 13, fontFamily: "Poppins_400Regular", marginTop: 2 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: { flex: 1, minWidth: "44%", borderRadius: 14, borderWidth: 1, padding: 14, gap: 6, alignItems: "center" },
  statValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular", textAlign: "center" },
  section: { borderRadius: 16, borderWidth: 1, overflow: "hidden", padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  settingLabel: { fontSize: 14, fontFamily: "Poppins_500Medium" },
  settingDesc: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  actionIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  actionLabel: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular" },
  switchBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1, marginTop: 4 },
  switchBtnText: { fontSize: 14, fontFamily: "Poppins_500Medium" },
});
