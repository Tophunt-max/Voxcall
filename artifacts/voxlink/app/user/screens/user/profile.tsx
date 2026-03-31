import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Alert,
  Switch,
  Clipboard,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

interface MenuItemProps {
  iconSource?: any;
  iconName?: string;
  label: string;
  onPress: () => void;
  value?: string;
  isSwitch?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  danger?: boolean;
}

function MenuItem({
  iconSource,
  iconName,
  label,
  onPress,
  value,
  isSwitch,
  switchValue,
  onSwitchChange,
  danger,
}: MenuItemProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.menuItem, { borderBottomColor: colors.border }]}
      activeOpacity={0.75}
    >
      <View
        style={[
          styles.menuIcon,
          {
            backgroundColor: danger ? colors.destructive + "15" : colors.surface,
          },
        ]}
      >
        {iconSource ? (
          <Image
            source={iconSource}
            style={[
              styles.menuIconImg,
              { tintColor: danger ? colors.destructive : colors.text },
            ]}
            resizeMode="contain"
          />
        ) : (
          <Feather
            name={iconName as any}
            size={18}
            color={danger ? colors.destructive : colors.text}
          />
        )}
      </View>
      <Text
        style={[
          styles.menuLabel,
          { color: danger ? colors.destructive : colors.text },
        ]}
      >
        {label}
      </Text>
      {isSwitch ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          trackColor={{ true: colors.primary }}
          thumbColor="#fff"
        />
      ) : (
        <View style={styles.menuRight}>
          {value && (
            <Text style={[styles.menuValue, { color: colors.mutedForeground }]}>
              {value}
            </Text>
          )}
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [notificationsOn, setNotificationsOn] = useState(true);

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const uniqueId = user?.id?.slice(0, 8).toUpperCase() ?? "00000000";

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/shared/auth/role-select");
        },
      },
    ]);
  };

  const copyId = () => {
    Clipboard.setString(uniqueId);
    Alert.alert("Copied", "Your unique ID has been copied.");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: bottomPad + 90 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>My Profile</Text>
        <TouchableOpacity
          onPress={() => router.push("/user/profile/edit")}
          style={[styles.editBtn, { backgroundColor: colors.surface }]}
        >
          <Image
            source={require("@/assets/icons/ic_edit.png")}
            style={styles.editIcon}
            tintColor={colors.primary}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </View>

      {/* Profile card */}
      <View
        style={[
          styles.profileCard,
          {
            backgroundColor: colors.card,
            ...Platform.select({
              ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } },
              android: { elevation: 3 },
              web: { boxShadow: "0 2px 12px rgba(0,0,0,0.07)" } as any,
            }),
          },
        ]}
      >
        {/* Dotted border avatar */}
        <View style={styles.avatarOuter}>
          <View style={[styles.dottedBorder, { borderColor: colors.primary }]}>
            <Image
              source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "me"}` }}
              style={styles.avatar}
            />
          </View>
          {user?.role === "host" && (
            <View style={[styles.hostBadge, { backgroundColor: colors.primary }]}>
              <Image
                source={require("@/assets/icons/ic_available.png")}
                style={styles.hostBadgeIcon}
                resizeMode="contain"
              />
            </View>
          )}
        </View>

        <Text style={[styles.name, { color: colors.text }]}>{user?.name}</Text>
        <Text style={[styles.email, { color: colors.mutedForeground }]}>{user?.email}</Text>

        {/* Unique ID badge */}
        <TouchableOpacity
          onPress={copyId}
          style={[styles.idBadge, { backgroundColor: "#F0E4F8" }]}
        >
          <Image
            source={require("@/assets/icons/ic_id_badge.png")}
            style={styles.idIcon}
            tintColor="#9D82B6"
            resizeMode="contain"
          />
          <Text style={[styles.idText, { color: "#9D82B6" }]}>ID: {uniqueId}</Text>
          <Image
            source={require("@/assets/icons/ic_copy.png")}
            style={styles.idIcon}
            tintColor="#9D82B6"
            resizeMode="contain"
          />
        </TouchableOpacity>

        {/* Stats row */}
        <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
          <View style={styles.stat}>
            <View style={styles.statValueRow}>
              <Image
                source={require("@/assets/icons/ic_coin.png")}
                style={styles.statCoinIcon}
                resizeMode="contain"
              />
              <Text style={[styles.statValue, { color: colors.coinGoldText }]}>
                {(user?.coins ?? 0).toLocaleString()}
              </Text>
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Coins</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>0</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Calls</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {user?.role === "host" ? "Host" : "User"}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Role</Text>
          </View>
        </View>
      </View>

      {/* Account section */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Account</Text>
        <MenuItem
          iconSource={require("@/assets/icons/ic_edit.png")}
          label="Edit Profile"
          onPress={() => router.push("/user/profile/edit")}
        />
        <MenuItem
          iconSource={require("@/assets/icons/ic_wallet.png")}
          label="My Wallet"
          onPress={() => router.push("/user/payment/checkout")}
        />
        <MenuItem
          iconName="bell"
          label="Notifications"
          isSwitch
          switchValue={notificationsOn}
          onSwitchChange={setNotificationsOn}
          onPress={() => {}}
        />
        <MenuItem
          iconSource={require("@/assets/icons/ic_language.png")}
          label="Language"
          value="English"
          onPress={() => router.push("/shared/language")}
        />
        <MenuItem
          iconName="settings"
          label="Settings"
          onPress={() => router.push("/shared/settings")}
        />
      </View>

      {/* More section */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>More</Text>
        <MenuItem
          iconName="clock"
          label="Call History"
          onPress={() => router.push("/shared/call/history")}
        />
        <MenuItem
          iconName="help-circle"
          label="Help & FAQ"
          onPress={() => router.push("/shared/help-center")}
        />
        <MenuItem
          iconName="shield"
          label="Privacy Policy"
          onPress={() => router.push("/shared/privacy")}
        />
        <MenuItem
          iconName="info"
          label="About VoxLink"
          onPress={() => router.push("/shared/about")}
        />
        <MenuItem
          iconName="star"
          label="Rate the App"
          onPress={() => Alert.alert("Rate VoxLink", "Thank you for using VoxLink! Please rate us on the App Store.", [{ text: "Rate Now", style: "default" }, { text: "Later", style: "cancel" }])}
        />
        <MenuItem
          iconSource={require("@/assets/images/icon_share.png")}
          label="Share App"
          onPress={() => Share.share({ message: "Join VoxLink - Connect with amazing hosts for audio & video calls! Download now: https://voxlink.app", title: "VoxLink" })}
        />
      </View>

      {/* Sign out */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <MenuItem
          iconSource={require("@/assets/images/icon_logout.png")}
          label="Sign Out"
          onPress={handleLogout}
          danger
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  editIcon: { width: 18, height: 18 },

  profileCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  avatarOuter: { position: "relative" },
  dottedBorder: {
    borderWidth: 1.5,
    borderRadius: 50,
    borderStyle: "dashed" as any,
    padding: 3,
  },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  hostBadge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  hostBadgeIcon: { width: 14, height: 14, tintColor: "#fff" },
  name: { fontSize: 18, fontFamily: "Poppins_700Bold", marginTop: 4 },
  email: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  idBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 4,
  },
  idIcon: { width: 12, height: 12 },
  idText: { fontSize: 11, fontFamily: "Poppins_500Medium" },

  statsRow: {
    flexDirection: "row",
    gap: 24,
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  stat: { alignItems: "center", gap: 4 },
  statValueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  statCoinIcon: { width: 16, height: 16 },
  statValue: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  statDiv: { width: 1, height: 28 },

  section: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Poppins_500Medium",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingTop: 14,
    paddingBottom: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIconImg: { width: 18, height: 18 },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular" },
  menuRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  menuValue: { fontSize: 12, fontFamily: "Poppins_400Regular" },
});
