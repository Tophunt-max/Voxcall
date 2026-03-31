import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, Alert, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

interface MenuItemProps {
  icon: string;
  label: string;
  onPress: () => void;
  value?: string;
  isSwitch?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  danger?: boolean;
}

function MenuItem({ icon, label, onPress, value, isSwitch, switchValue, onSwitchChange, danger }: MenuItemProps) {
  const colors = useColors();
  return (
    <TouchableOpacity onPress={onPress} style={[styles.menuItem, { borderBottomColor: colors.border }]} activeOpacity={0.75}>
      <View style={[styles.menuIcon, { backgroundColor: danger ? colors.destructive + "15" : colors.muted }]}>
        <Feather name={icon as any} size={18} color={danger ? colors.destructive : colors.foreground} />
      </View>
      <Text style={[styles.menuLabel, { color: danger ? colors.destructive : colors.foreground }]}>{label}</Text>
      {isSwitch ? (
        <Switch value={switchValue} onValueChange={onSwitchChange} trackColor={{ true: colors.primary }} />
      ) : (
        <View style={styles.menuRight}>
          {value && <Text style={[styles.menuValue, { color: colors.mutedForeground }]}>{value}</Text>}
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, switchRole } = useAuth();
  const [notificationsOn, setNotificationsOn] = useState(true);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: async () => { await logout(); router.replace("/auth/login"); } },
    ]);
  };

  const handleBecomeHost = () => {
    Alert.alert(
      "Become a Host",
      "Start earning coins by helping others. Switch to Host mode to accept calls and messages.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Switch to Host", onPress: () => switchRole("host") },
      ]
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: bottomPad + 90 }}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Profile</Text>
      </View>

      <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.avatarWrapper}>
          <Image
            source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "user"}` }}
            style={[styles.avatar, { borderColor: colors.border }]}
          />
          {user?.role === "host" && (
            <View style={[styles.hostBadge, { backgroundColor: colors.primary }]}>
              <Feather name="headphones" size={10} color="#fff" />
            </View>
          )}
        </View>
        <Text style={[styles.name, { color: colors.foreground }]}>{user?.name}</Text>
        <Text style={[styles.email, { color: colors.mutedForeground }]}>{user?.email}</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{(user?.coins ?? 0).toLocaleString()}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>🪙 Coins</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>0</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Calls</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{user?.role === "host" ? "Host" : "User"}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Role</Text>
          </View>
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Account</Text>
        <MenuItem icon="user" label="Edit Profile" onPress={() => router.push("/profile/edit")} />
        <MenuItem icon="bell" label="Notifications" isSwitch switchValue={notificationsOn} onSwitchChange={setNotificationsOn} onPress={() => {}} />
        <MenuItem icon="globe" label="Language" value="English" onPress={() => {}} />
        <MenuItem icon="shield" label="Privacy" onPress={() => {}} />
      </View>

      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>More</Text>
        {user?.role !== "host" && (
          <MenuItem icon="headphones" label="Become a Host" onPress={handleBecomeHost} value="Earn coins" />
        )}
        {user?.role === "host" && (
          <MenuItem icon="trending-up" label="Host Dashboard" onPress={() => router.push("/host/dashboard")} />
        )}
        <MenuItem icon="help-circle" label="Help & FAQ" onPress={() => {}} />
        <MenuItem icon="star" label="Rate VoxLink" onPress={() => {}} />
        <MenuItem icon="share-2" label="Share App" onPress={() => {}} />
      </View>

      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Danger Zone</Text>
        <MenuItem icon="log-out" label="Sign Out" onPress={handleLogout} danger />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  profileCard: { marginHorizontal: 20, borderRadius: 20, padding: 20, borderWidth: 1, alignItems: "center", gap: 8, marginBottom: 20 },
  avatarWrapper: { position: "relative" },
  avatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 2 },
  hostBadge: { position: "absolute", right: 0, bottom: 0, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 20, fontFamily: "Inter_700Bold" },
  email: { fontSize: 13, fontFamily: "Inter_400Regular" },
  statsRow: { flexDirection: "row", gap: 16, marginTop: 8, alignItems: "center" },
  stat: { alignItems: "center", gap: 3 },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statDiv: { width: 1, height: 28 },
  section: { marginHorizontal: 20, borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 16, paddingHorizontal: 16 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1, paddingTop: 14, paddingBottom: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  menuRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  menuValue: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
