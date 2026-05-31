import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Switch, Alert, ImageSourcePropType
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconView } from "@/components/IconView";
import { SvgIcon } from "@/components/SvgIcon";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/services/api";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useLanguage } from "@/context/LanguageContext";
import { LANGUAGES } from "@/localization";
import { useHostSettings } from "@/utils/hostSettings";

function Row({
  icon, iconImg, label, value, onPress, isSwitch, switchVal, onSwitch, danger
}: {
  icon: string; iconImg?: ImageSourcePropType; label: string; value?: string; onPress: () => void;
  isSwitch?: boolean; switchVal?: boolean; onSwitch?: (v: boolean) => void; danger?: boolean;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={isSwitch ? undefined : onPress}
      activeOpacity={isSwitch ? 1 : 0.75}
    >
      <View style={[styles.rowIcon, { backgroundColor: danger ? "#FDECEA" : colors.surface }]}>
        {iconImg ? (
          <Image source={iconImg} style={styles.rowIconImg} tintColor={danger ? "#F44336" : colors.primary} resizeMode="contain" />
        ) : (
          <IconView name={icon} size={17} color={danger ? "#F44336" : colors.primary} />
        )}
      </View>
      <Text style={[styles.rowLabel, { color: danger ? "#F44336" : colors.text }]}>{label}</Text>
      {isSwitch ? (
        <Switch
          value={switchVal}
          onValueChange={onSwitch}
          trackColor={{ false: colors.border, true: "#0BAF23" }}
          thumbColor="#fff"
        />
      ) : (
        <View style={styles.rowRight}>
          {value ? <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>{value}</Text> : null}
          <SvgIcon name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HostSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const { permissions, requestNotifications, openSettings } = usePermissions();
  const { language } = useLanguage();
  const currentLangLabel = LANGUAGES.find((l) => l.code === language)?.name ?? "English";

  const [showNotifDialog, setShowNotifDialog] = useState(false);

  // FIX: switched from per-screen useState + AsyncStorage to the centralized
  // useHostSettings hook. The previous setup persisted toggles only this
  // screen ever read — the FCM handler, AppBridge, and other services had no
  // way to consult them. Now the same store is shared everywhere.
  const { settings, update } = useHostSettings();
  const { autoOnline, dndMode, callNotif, chatNotif, coinNotif } = settings;

  const topPad = insets.top;

  const notificationsGranted = permissions.notifications.status === "granted";
  const notifBlocked =
    permissions.notifications.status === "blocked" ||
    (permissions.notifications.status === "denied" && !permissions.notifications.canAskAgain);

  const handleCallNotif = useCallback((v: boolean) => update({ callNotif: v }), [update]);
  const handleChatNotif = useCallback((v: boolean) => update({ chatNotif: v }), [update]);
  const handleCoinNotif = useCallback((v: boolean) => update({ coinNotif: v }), [update]);
  const handleAutoOnline = useCallback((v: boolean) => update({ autoOnline: v }), [update]);
  const handleDndMode = useCallback((v: boolean) => update({ dndMode: v }), [update]);

  const handlePushNotifToggle = (value: boolean) => {
    if (value) {
      if (notifBlocked || !notificationsGranted) {
        setShowNotifDialog(true);
      }
    } else {
      Alert.alert(
        "Turn Off Notifications",
        "To disable notifications, go to your phone's Settings and turn off notifications for VoxLink Host.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: openSettings },
        ]
      );
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out", style: "destructive",
        onPress: async () => { await logout(); router.replace("/auth/login"); }
      }
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This action is permanent. Your host profile, earnings history, and all data will be erased.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account", style: "destructive",
          onPress: () => {
            Alert.alert(
              "Final Confirmation",
              "This cannot be undone. Are you absolutely sure?",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Yes, Delete", style: "destructive",
                  onPress: async () => {
                    try {
                      await apiRequest("DELETE", "/api/user/me", undefined);
                    } catch {}
                    await logout();
                    router.replace("/auth/login");
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PermissionDialog
        visible={showNotifDialog}
        config={{ ...PERMISSION_CONFIGS.notifications, isBlocked: notifBlocked }}
        onAllow={async () => {
          if (notifBlocked) {
            openSettings();
          } else {
            await requestNotifications();
          }
          setShowNotifDialog(false);
        }}
        onDeny={() => setShowNotifDialog(false)}
      />

      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIconImg} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Host Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Availability</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="clock" label="Auto Go Online on App Open" isSwitch switchVal={autoOnline} onSwitch={handleAutoOnline} onPress={() => {}} />
          <Row
            icon="phone-off"
            iconImg={require("@/assets/icons/ic_call_end.png")}
            label="Do Not Disturb Mode"
            value={dndMode ? "On — silencing notifications" : undefined}
            isSwitch
            switchVal={dndMode}
            onSwitch={handleDndMode}
            onPress={() => {}}
          />
          <Row
            icon="calendar"
            iconImg={require("@/assets/icons/ic_calendar.png")}
            label="Availability Schedule"
            value="Coming soon"
            onPress={() => Alert.alert(
              "Availability Schedule",
              "Scheduled availability is coming in a future update. For now, use Do Not Disturb Mode to mute notifications when you're unavailable, or toggle online/offline manually."
            )}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Push Notifications</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row
            icon="bell"
            iconImg={require("@/assets/icons/ic_notify.png")}
            label="Push Notifications"
            value={notificationsGranted ? "On" : "Off"}
            isSwitch
            switchVal={notificationsGranted}
            onSwitch={handlePushNotifToggle}
            onPress={() => {}}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Notification Preferences</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="phone" iconImg={require("@/assets/icons/ic_call.png")} label="Incoming Call Alerts" isSwitch switchVal={callNotif} onSwitch={handleCallNotif} onPress={() => {}} />
          <Row icon="message-circle" iconImg={require("@/assets/icons/ic_chat.png")} label="Chat Notifications" isSwitch switchVal={chatNotif} onSwitch={handleChatNotif} onPress={() => {}} />
          <Row icon="dollar-sign" iconImg={require("@/assets/icons/ic_coin.png")} label="Coin Earned Alerts" isSwitch switchVal={coinNotif} onSwitch={handleCoinNotif} onPress={() => {}} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Earnings</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="trending-up" iconImg={require("@/assets/icons/ic_arrow_up.png")} label="Payout Method" onPress={() => router.push("/payout-method")} />
          <Row icon="file-text" iconImg={require("@/assets/icons/ic_withdraw.png")} label="Withdraw Earnings" onPress={() => router.push("/(tabs)/wallet")} />
          <Row icon="gift" iconImg={require("@/assets/icons/ic_bonus.png")} label="Refer & Earn" onPress={() => router.push("/referral")} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Preferences</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="globe" iconImg={require("@/assets/icons/ic_language.png")} label="App Language" value={currentLangLabel} onPress={() => router.push("/language")} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Support</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="help-circle" label="Help & Support" onPress={() => router.push("/help-center")} />
          <Row icon="shield" iconImg={require("@/assets/icons/ic_secure.png")} label="Privacy Policy" onPress={() => router.push("/privacy")} />
          <Row icon="info" iconImg={require("@/assets/icons/ic_id_badge.png")} label="About VoxLink Host" onPress={() => router.push("/about")} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="log-out" label="Sign Out" onPress={handleLogout} danger />
          <Row icon="trash-2" label="Delete Account" onPress={handleDeleteAccount} danger />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIconImg: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  sectionLabel: {
    fontSize: 11, fontFamily: "Poppins_500Medium",
    textTransform: "uppercase", letterSpacing: 0.5,
    marginHorizontal: 16, marginTop: 20, marginBottom: 6,
  },
  card: { marginHorizontal: 16, borderRadius: 12, overflow: "hidden" },
  row: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 14, gap: 12, borderBottomWidth: 1,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowIconImg: { width: 18, height: 18 },
  rowLabel: { flex: 1, fontSize: 14, fontFamily: "Poppins_500Medium" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowValue: { fontSize: 13, fontFamily: "Poppins_400Regular" },
});
