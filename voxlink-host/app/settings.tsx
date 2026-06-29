import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Switch, Alert, ImageSourcePropType
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconView } from "@/components/IconView";
import { SvgIcon } from "@/components/SvgIcon";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiRequest, API } from "@/services/api";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useLanguage } from "@/context/LanguageContext";
import { LANGUAGES } from "@/localization";
import { useHostSettings } from "@/utils/hostSettings";
import { showErrorToast } from "@/components/Toast";

// "14:30" → "2:30 PM" (defensive: empty for malformed input).
function fmtTime(hhmm?: string | null): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return "";
  const [hStr, m] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

// Build the Availability Schedule row's summary value from the host record.
function scheduleSummary(from?: string | null, to?: string | null): string {
  if (from && to) return `${fmtTime(from)} – ${fmtTime(to)}`;
  return "Always available";
}

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
  const { language, t } = useLanguage();
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

  // ─── Random-call opt-ins ───────────────────────────────────────────────
  // Backed by hosts.accepts_random_calls / hosts.allows_video on the server
  // (migration 0026). Stored as INTEGER 0/1 there but exposed as booleans on
  // the client. We load once on mount from /api/host/me (which returns the
  // raw row) and persist via PATCH /api/host/me.
  //
  // Optimistic update pattern: flip the local toggle immediately so the UI
  // never feels laggy, and roll back on API failure.
  const [randomLoaded, setRandomLoaded] = useState(false);
  const [acceptsRandomCalls, setAcceptsRandomCalls] = useState(true);
  const [allowsVideo, setAllowsVideo] = useState(true);
  // Saving = a PATCH is currently in flight; we disable both switches so
  // a quick double-flip can't race two requests against each other.
  const [randomSaving, setRandomSaving] = useState(false);

  // Availability schedule summary, shown on the "Availability Schedule" row and
  // refreshed whenever Settings regains focus (e.g. after editing it).
  const [scheduleLabel, setScheduleLabel] = useState<string>("");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const me: any = await API.getHostMe();
          if (!cancelled) setScheduleLabel(scheduleSummary(me?.available_from, me?.available_to));
        } catch {
          /* leave blank on failure — the row still navigates */
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me: any = await API.getHostMe();
        if (cancelled) return;
        // Migration 0026 columns default to 1; treat anything ≠ 0 as on so
        // legacy rows (where the column may be NULL on a not-yet-migrated DB)
        // still render correctly.
        setAcceptsRandomCalls(me?.accepts_random_calls !== 0);
        setAllowsVideo(me?.allows_video !== 0);
        setRandomLoaded(true);
      } catch {
        // Quietly fall back to the optimistic defaults — the user can still
        // flip the switches and the PATCH will surface any real error.
        setRandomLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persistRandomToggle = useCallback(
    async (next: { accepts_random_calls?: boolean; allows_video?: boolean }) => {
      setRandomSaving(true);
      try {
        await API.updateHostProfile(next);
      } catch (e: any) {
        showErrorToast(e?.message || "Couldn't save the change. Please try again.");
        // Roll back the optimistic flip on failure so on-screen state matches
        // the server again.
        if (next.accepts_random_calls !== undefined) {
          setAcceptsRandomCalls(!next.accepts_random_calls);
        }
        if (next.allows_video !== undefined) {
          setAllowsVideo(!next.allows_video);
        }
      } finally {
        setRandomSaving(false);
      }
    },
    [],
  );

  const handleAcceptsRandom = useCallback((v: boolean) => {
    setAcceptsRandomCalls(v);
    void persistRandomToggle({ accepts_random_calls: v });
  }, [persistRandomToggle]);

  const handleAllowsVideo = useCallback((v: boolean) => {
    setAllowsVideo(v);
    void persistRandomToggle({ allows_video: v });
  }, [persistRandomToggle]);

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
        <Text style={[styles.title, { color: colors.text }]}>{t.hostSettings.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.hostSettings.availability}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="clock" label={t.hostSettings.autoOnline} isSwitch switchVal={autoOnline} onSwitch={handleAutoOnline} onPress={() => {}} />
          <Row
            icon="phone-off"
            iconImg={require("@/assets/icons/ic_call_end.png")}
            label={t.hostSettings.dnd}
            value={dndMode ? t.hostSettings.dndOn : undefined}
            isSwitch
            switchVal={dndMode}
            onSwitch={handleDndMode}
            onPress={() => {}}
          />
          <Row
            icon="calendar"
            iconImg={require("@/assets/icons/ic_calendar.png")}
            label={t.hostSettings.schedule}
            value={scheduleLabel || undefined}
            onPress={() => router.push("/availability")}
          />
        </View>

        {/* Random Match controls — server-side opt-ins persisted on the host
            row. Independent from local notification preferences because they
            affect who can match with you, not just what alerts you see. */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.hostSettings.randomCalls}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row
            icon="shuffle"
            iconImg={require("@/assets/icons/ic_shuffle.png")}
            label={t.hostSettings.availableRandom}
            value={
              !randomLoaded
                ? t.hostSettings.loading
                : acceptsRandomCalls
                  ? t.hostSettings.randomOn
                  : t.hostSettings.randomOff
            }
            isSwitch
            switchVal={acceptsRandomCalls}
            onSwitch={(v) => {
              if (randomSaving) return;
              handleAcceptsRandom(v);
            }}
            onPress={() => {}}
          />
          <Row
            icon="video"
            iconImg={require("@/assets/icons/ic_chat_video.png")}
            label={t.hostSettings.allowVideoRandom}
            value={
              !randomLoaded
                ? t.hostSettings.loading
                : !acceptsRandomCalls
                  ? t.hostSettings.videoDisabled
                  : allowsVideo
                    ? t.hostSettings.videoOn
                    : t.hostSettings.videoOff
            }
            isSwitch
            switchVal={acceptsRandomCalls && allowsVideo}
            onSwitch={(v) => {
              if (randomSaving || !acceptsRandomCalls) return;
              handleAllowsVideo(v);
            }}
            onPress={() => {}}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.hostSettings.pushNotifications}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row
            icon="bell"
            iconImg={require("@/assets/icons/ic_notify.png")}
            label={t.hostSettings.pushNotifications}
            value={notificationsGranted ? t.hostSettings.on : t.hostSettings.off}
            isSwitch
            switchVal={notificationsGranted}
            onSwitch={handlePushNotifToggle}
            onPress={() => {}}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.hostSettings.notificationPrefs}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="phone" iconImg={require("@/assets/icons/ic_call.png")} label={t.hostSettings.incomingCallAlerts} isSwitch switchVal={callNotif} onSwitch={handleCallNotif} onPress={() => {}} />
          <Row icon="message-circle" iconImg={require("@/assets/icons/ic_chat.png")} label={t.hostSettings.chatNotifications} isSwitch switchVal={chatNotif} onSwitch={handleChatNotif} onPress={() => {}} />
          <Row icon="dollar-sign" iconImg={require("@/assets/icons/ic_coin.png")} label={t.hostSettings.coinEarnedAlerts} isSwitch switchVal={coinNotif} onSwitch={handleCoinNotif} onPress={() => {}} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.hostSettings.earnings}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="trending-up" iconImg={require("@/assets/icons/ic_arrow_up.png")} label={t.hostSettings.payoutMethod} onPress={() => router.push("/payout-method")} />
          <Row icon="file-text" iconImg={require("@/assets/icons/ic_withdraw.png")} label={t.hostSettings.withdrawEarnings} onPress={() => router.push("/(tabs)/wallet")} />
          <Row icon="gift" iconImg={require("@/assets/icons/ic_bonus.png")} label={t.hostSettings.referEarn} onPress={() => router.push("/referral")} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.hostSettings.preferences}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="globe" iconImg={require("@/assets/icons/ic_language.png")} label={t.hostSettings.appLanguage} value={currentLangLabel} onPress={() => router.push("/language")} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.hostSettings.support}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="help-circle" label={t.hostSettings.helpSupport} onPress={() => router.push("/help-center")} />
          <Row icon="shield" iconImg={require("@/assets/icons/ic_secure.png")} label={t.hostSettings.privacyPolicy} onPress={() => router.push("/privacy")} />
          <Row icon="info" iconImg={require("@/assets/icons/ic_id_badge.png")} label={t.hostSettings.aboutApp} onPress={() => router.push("/about")} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.hostSettings.account}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row icon="log-out" label={t.hostSettings.signOut} onPress={handleLogout} danger />
          <Row icon="trash-2" label={t.hostSettings.deleteAccount} onPress={handleDeleteAccount} danger />
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
