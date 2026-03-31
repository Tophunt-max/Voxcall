import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Switch, Alert, Platform
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

function Row({ icon, label, value, onPress, isSwitch, switchVal, onSwitch, danger }: {
  icon: string; label: string; value?: string; onPress: () => void;
  isSwitch?: boolean; switchVal?: boolean; onSwitch?: (v: boolean) => void; danger?: boolean;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity style={[styles.row, { borderBottomColor: colors.border }]} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.rowIcon, { backgroundColor: danger ? "#FDECEA" : colors.surface }]}>
        <Feather name={icon as any} size={17} color={danger ? "#F44336" : colors.primary} />
      </View>
      <Text style={[styles.rowLabel, { color: danger ? "#F44336" : colors.text }]}>{label}</Text>
      {isSwitch ? (
        <Switch value={switchVal} onValueChange={onSwitch} trackColor={{ false: colors.border, true: "#0BAF23" }} thumbColor="#fff" />
      ) : (
        <View style={styles.rowRight}>
          {value && <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>{value}</Text>}
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HostSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { logout, switchRole } = useAuth();
  const [callNotif, setCallNotif] = useState(true);
  const [chatNotif, setChatNotif] = useState(true);
  const [coinNotif, setCoinNotif] = useState(true);
  const [autoOnline, setAutoOnline] = useState(false);

  const topPad = insets.top;

  const handleSwitchToUser = () => {
    Alert.alert("Switch to User", "Switch back to regular user mode?", [
      { text: "Cancel", style: "cancel" },
      { text: "Switch", onPress: () => { switchRole("user"); router.replace("/screens/user"); } }
    ]);
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: async () => { await logout(); router.replace("/auth/login"); } }
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Host Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Availability */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Availability</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="clock" label="Auto Go Online on App Open" isSwitch switchVal={autoOnline} onSwitch={setAutoOnline} onPress={() => {}} />
          <Row icon="phone-off" label="Do Not Disturb Mode" onPress={() => Alert.alert("Coming Soon", "DND mode will be available in a future update.")} />
          <Row icon="calendar" label="Availability Schedule" onPress={() => Alert.alert("Coming Soon", "Schedule settings coming soon.")} />
        </View>

        {/* Notifications */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Notifications</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="phone" label="Incoming Call Alerts" isSwitch switchVal={callNotif} onSwitch={setCallNotif} onPress={() => {}} />
          <Row icon="message-circle" label="Chat Notifications" isSwitch switchVal={chatNotif} onSwitch={setChatNotif} onPress={() => {}} />
          <Row icon="dollar-sign" label="Coin Earned Alerts" isSwitch switchVal={coinNotif} onSwitch={setCoinNotif} onPress={() => {}} />
        </View>

        {/* Earnings */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Earnings</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="trending-up" label="Payout Method" value="Bank Account" onPress={() => Alert.alert("Coming Soon", "Payout settings coming soon.")} />
          <Row icon="file-text" label="Tax Documents" onPress={() => Alert.alert("Coming Soon")} />
        </View>

        {/* Profile */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Host Profile</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="edit-2" label="Edit Host Profile" onPress={() => router.push("/profile/edit")} />
          <Row icon="globe" label="Languages" value="English, Hindi" onPress={() => router.push("/language")} />
          <Row icon="help-circle" label="Help & Support" onPress={() => router.push("/help-center")} />
          <Row icon="shield" label="Privacy Policy" onPress={() => router.push("/privacy")} />
          <Row icon="info" label="About VoxLink" onPress={() => router.push("/about")} />
        </View>

        {/* Account */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="user" label="Switch to User Mode" onPress={handleSwitchToUser} />
          <Row icon="log-out" label="Sign Out" onPress={handleLogout} danger />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginHorizontal: 16, marginTop: 20, marginBottom: 6 },
  card: { marginHorizontal: 16, borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14, gap: 12, borderBottomWidth: 1 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 14, fontFamily: "Poppins_500Medium" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowValue: { fontSize: 13, fontFamily: "Poppins_400Regular" },
});
