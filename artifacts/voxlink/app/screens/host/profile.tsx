import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Platform, Alert, Switch
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function HostProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, switchRole } = useAuth();
  const [isOnline, setIsOnline] = useState(false);
  const topPad = insets.top;
  const bottomPad = insets.bottom;
  const uniqueId = user?.id?.slice(0, 8).toUpperCase() ?? "00000000";

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: async () => { await logout(); router.replace("/auth/role-select"); } }
    ]);
  };

  const CHEVRON_ROTATE = { transform: [{ rotate: "180deg" }] } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: bottomPad + 90 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>My Profile</Text>
        <TouchableOpacity onPress={() => router.push("/profile/edit")} style={[styles.editBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_edit.png")} style={styles.editIcon} tintColor={colors.primary} resizeMode="contain" />
        </TouchableOpacity>
      </View>

      <View style={[styles.profileCard, { backgroundColor: colors.card, ...Platform.select({ web: { boxShadow: "0 2px 12px rgba(0,0,0,0.07)" } as any, ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 3 } }) }]}>
        <View style={styles.avatarOuter}>
          <View style={[styles.dottedBorder, { borderColor: colors.primary }]}>
            <Image source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "host"}` }} style={styles.avatar} />
          </View>
          <View style={[styles.hostBadge, { backgroundColor: colors.primary }]}>
            <Image source={require("@/assets/icons/ic_listener.png")} style={styles.hostBadgeIcon} tintColor="#fff" resizeMode="contain" />
          </View>
        </View>
        <Text style={[styles.name, { color: colors.text }]}>{user?.name ?? "Host"}</Text>
        <Text style={[styles.role, { color: colors.accent }]}>Professional Host</Text>
        <View style={[styles.idBadge, { backgroundColor: "#F0E4F8" }]}>
          <Image source={require("@/assets/icons/ic_id_badge.png")} style={styles.idIcon} tintColor="#9D82B6" resizeMode="contain" />
          <Text style={[styles.idText, { color: "#9D82B6" }]}>ID: {uniqueId}</Text>
        </View>
        <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
          {[{ label: "Calls", val: "0" }, { label: "Rating", val: "—" }, { label: "Coins", val: String(user?.coins ?? 0) }].map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={[styles.statDiv, { backgroundColor: colors.border }]} />}
              <View style={styles.stat}>
                <Text style={[styles.statVal, { color: colors.text }]}>{s.val}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={[styles.menuItem, { borderBottomColor: colors.border }]}>
          <View style={[styles.menuIcon, { backgroundColor: isOnline ? "#E8F5E9" : colors.surface }]}>
            <Image source={require("@/assets/icons/ic_available.png")} style={styles.menuIconImg} tintColor={isOnline ? "#0BAF23" : colors.text} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Online Status</Text>
          <Switch value={isOnline} onValueChange={setIsOnline} trackColor={{ false: colors.border, true: "#0BAF23" }} thumbColor="#fff" />
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Account</Text>
        {[
          { icon: require("@/assets/icons/ic_edit.png"), label: "Edit Profile", onPress: () => router.push("/profile/edit") },
          { icon: require("@/assets/icons/ic_settings.png"), label: "Settings", onPress: () => router.push("/host/settings") },
          { icon: require("@/assets/icons/ic_language.png"), label: "Language", value: "English", onPress: () => router.push("/language") },
        ].map((m, i) => (
          <TouchableOpacity key={i} style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={m.onPress} activeOpacity={0.75}>
            <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
              <Image source={m.icon} style={styles.menuIconImg} tintColor={colors.text} resizeMode="contain" />
            </View>
            <Text style={[styles.menuLabel, { color: colors.text }]}>{m.label}</Text>
            {"value" in m && <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Poppins_400Regular" }}>{m.value}</Text>}
            <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor={colors.mutedForeground} resizeMode="contain" />
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>More</Text>
        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={() => router.push("/help-center")} activeOpacity={0.75}>
          <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
            <Image source={require("@/assets/images/help_graphic.png")} style={styles.menuIconImg} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Help Center</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={() => { switchRole("user"); router.replace("/screens/user"); }} activeOpacity={0.75}>
          <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
            <Image source={require("@/assets/icons/ic_users.png")} style={styles.menuIconImg} tintColor={colors.text} resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: colors.text }]}>Switch to User Mode</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: colors.border }]} onPress={handleLogout} activeOpacity={0.75}>
          <View style={[styles.menuIcon, { backgroundColor: "#FFF3F3" }]}>
            <Image source={require("@/assets/images/icon_logout.png")} style={styles.menuIconImg} tintColor="#E84855" resizeMode="contain" />
          </View>
          <Text style={[styles.menuLabel, { color: "#E84855" }]}>Sign Out</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, CHEVRON_ROTATE]} tintColor="#E84855" resizeMode="contain" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  editBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  editIcon: { width: 18, height: 18 },
  profileCard: { marginHorizontal: 16, borderRadius: 20, padding: 20, alignItems: "center", gap: 8, marginBottom: 16 },
  avatarOuter: { position: "relative" },
  dottedBorder: { borderWidth: 1.5, borderRadius: 50, borderStyle: "dashed" as any, padding: 3 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  hostBadge: { position: "absolute", right: 2, bottom: 2, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  hostBadgeIcon: { width: 14, height: 14 },
  name: { fontSize: 18, fontFamily: "Poppins_700Bold", marginTop: 4 },
  role: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  idBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginTop: 4 },
  idIcon: { width: 12, height: 12 },
  idText: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  statsRow: { flexDirection: "row", gap: 24, marginTop: 12, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, width: "100%", justifyContent: "center", alignItems: "center" },
  stat: { alignItems: "center", gap: 4 },
  statVal: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 28 },
  section: { marginHorizontal: 16, borderRadius: 16, overflow: "hidden", marginBottom: 12, paddingHorizontal: 16 },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 1, paddingTop: 14, paddingBottom: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuIconImg: { width: 18, height: 18 },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular" },
  chevron: { width: 14, height: 14 },
});
