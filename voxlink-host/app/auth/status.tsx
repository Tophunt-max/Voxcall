import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl, Image, Animated, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { showErrorToast } from "@/components/Toast";
import AsyncStorage from "@react-native-async-storage/async-storage";

const useNativeDriverValue = Platform.OS !== "web";

const BG     = "#0A0B1E";
const ACCENT = "#A00EE7";
const DARK   = "#111329";
const POLL_INTERVAL_MS = 10000;

type Status = "pending" | "under_review" | "approved" | "rejected" | "not_applied";

const STATUS_CONFIG: Record<Status, {
  icon: any; color: string; bgColor: string; glowColor: string;
  title: string; message: string;
}> = {
  pending: {
    icon: require("@/assets/icons/ic_calendar.png"),
    color: "#F59E0B", bgColor: "#FFF8E6", glowColor: "#F59E0B30",
    title: "Application Submitted",
    message: "Your application is in the queue. Our team will review it within 24–48 hours.",
  },
  under_review: {
    icon: require("@/assets/icons/ic_search.png"),
    color: "#3B82F6", bgColor: "#EFF6FF", glowColor: "#3B82F630",
    title: "Under Review",
    message: "Our team is actively reviewing your application. You'll hear back soon.",
  },
  approved: {
    icon: require("@/assets/icons/ic_check.png"),
    color: "#22C55E", bgColor: "#F0FDF4", glowColor: "#22C55E30",
    title: "Congratulations!",
    message: "Your application has been approved! You are now a verified host on VoxLink.",
  },
  rejected: {
    icon: require("@/assets/icons/ic_close.png"),
    color: "#EF4444", bgColor: "#FEF2F2", glowColor: "#EF444430",
    title: "Application Rejected",
    message: "Unfortunately, your application was not approved. Please see the reason below and re-apply.",
  },
  not_applied: {
    icon: require("@/assets/icons/ic_id_badge.png"),
    color: "#84889F", bgColor: "#F8F9FC", glowColor: "#84889F20",
    title: "No Application Found",
    message: "You haven't submitted a host application yet.",
  },
};

const TIMELINE_STEPS = [
  { label: "Account Created",       icon: require("@/assets/icons/ic_profile.png"),  doneKey: "always" },
  { label: "Application Submitted", icon: require("@/assets/icons/ic_id_badge.png"), doneKey: "applied" },
  { label: "Under Review",          icon: require("@/assets/icons/ic_search.png"),   doneKey: "review" },
  { label: "Decision Made",         icon: require("@/assets/icons/ic_check.png"),    doneKey: "decision" },
];

export default function HostStatusScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshProfile } = useAuth();
  const [data, setData]             = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [justApproved, setJustApproved] = useState(false);

  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const scaleAnim   = useRef(new Animated.Value(0.6)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const animateApproval = () => {
    Animated.parallel([
      Animated.spring(scaleAnim,   { toValue: 1, useNativeDriver: useNativeDriverValue, tension: 60, friction: 7 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: useNativeDriverValue }),
    ]).start();
  };

  const fetchStatus = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await API.getHostAppStatus();
      const prevStatus = data?.status;
      setData(res);

      const newStatus: Status = !res?.applied ? "not_applied" : (res.status ?? "pending");

      if (newStatus === "approved") {
        stopPolling();
        if (prevStatus !== "approved") {
          setJustApproved(true);
          animateApproval();
          await refreshProfile();
        }
        await AsyncStorage.removeItem("hostAppPending");
      }
    } catch {
      showErrorToast("Failed to load application status.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [data, refreshProfile]);

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (loading) return;
    const status: Status = !data?.applied ? "not_applied" : (data?.status ?? "pending");
    if (status === "pending" || status === "under_review") {
      stopPolling();
      pollRef.current = setInterval(() => fetchStatus(), POLL_INTERVAL_MS);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [data, loading]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG }}>
        <ActivityIndicator color={ACCENT} size="large" />
        <Text style={s.loadingTxt}>Checking application status...</Text>
      </View>
    );
  }

  const status: Status = !data?.applied ? "not_applied" : (data?.status ?? "pending");
  const cfg = STATUS_CONFIG[status];

  const stepDone = (key: string) => {
    if (key === "always") return true;
    if (key === "applied") return !!data?.applied;
    if (key === "review")  return ["under_review", "approved", "rejected"].includes(status);
    if (key === "decision") return ["approved", "rejected"].includes(status);
    return false;
  };

  if (status === "approved") {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <View style={s.backBtn} />
          <Text style={s.headerTitle}>Host Application</Text>
          <Text style={s.headerSub}>Track your KYC verification status</Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.approvedBody, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[s.approvedCard, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
            <LinearGradient
              colors={["#0D3B1E", "#1A5C2E"]}
              style={s.approvedGradient}
            >
              <View style={s.approvedIconWrap}>
                <LinearGradient colors={["#22C55E", "#16A34A"]} style={s.approvedIconBg}>
                  <Image source={require("@/assets/icons/ic_check.png")} style={s.approvedIcon} tintColor="#fff" resizeMode="contain" />
                </LinearGradient>
              </View>
              <Text style={s.approvedEmoji}>🎉</Text>
              <Text style={s.approvedTitle}>Congratulations!</Text>
              <Text style={s.approvedSub}>You are now a verified host on VoxLink. Start accepting calls and earning coins!</Text>

              <View style={s.approvedDivider} />

              <View style={s.approvedStats}>
                <View style={s.approvedStat}>
                  <Image source={require("@/assets/icons/ic_coin.png")} style={s.approvedStatIcon} tintColor="#F59E0B" resizeMode="contain" />
                  <Text style={s.approvedStatLabel}>Earn Coins</Text>
                </View>
                <View style={s.approvedStatSep} />
                <View style={s.approvedStat}>
                  <Image source={require("@/assets/icons/ic_star.png")} style={s.approvedStatIcon} tintColor="#A78BFA" resizeMode="contain" />
                  <Text style={s.approvedStatLabel}>Build Rating</Text>
                </View>
                <View style={s.approvedStatSep} />
                <View style={s.approvedStat}>
                  <Image source={require("@/assets/icons/ic_call.png")} style={s.approvedStatIcon} tintColor="#60A5FA" resizeMode="contain" />
                  <Text style={s.approvedStatLabel}>Take Calls</Text>
                </View>
              </View>
            </LinearGradient>
          </Animated.View>

          <View style={s.timeline}>
            <Text style={[s.timelineTitle, { color: DARK }]}>Application Timeline</Text>
            {TIMELINE_STEPS.map((step, i) => {
              const done = stepDone(step.doneKey);
              return (
                <View key={i} style={s.tlRow}>
                  <View style={s.tlLeft}>
                    <View style={[s.tlDot, s.tlDotDone]}>
                      <Image source={step.icon} style={s.tlIcon} tintColor="#fff" resizeMode="contain" />
                    </View>
                    {i < TIMELINE_STEPS.length - 1 && <View style={[s.tlLine, s.tlLineDone]} />}
                  </View>
                  <Text style={[s.tlLabel, s.tlLabelDone]}>{step.label}</Text>
                </View>
              );
            })}
          </View>

          <TouchableOpacity
            style={s.ctaBtnWrap}
            onPress={async () => {
              await AsyncStorage.removeItem("hostAppPending");
              router.replace("/(tabs)");
            }}
            activeOpacity={0.85}
          >
            <LinearGradient colors={[ACCENT, "#6A00B8"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.ctaBtn}>
              <Image source={require("@/assets/icons/ic_star.png")} style={s.ctaIcon} tintColor="#fff" resizeMode="contain" />
              <Text style={s.ctaBtnTxt}>Continue to Dashboard</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.replace("/auth/login")}
          style={s.backBtn}
          activeOpacity={0.8}
        >
          <Image source={require("@/assets/icons/ic_back.png")} style={s.backIcon} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Host Application</Text>
        <Text style={s.headerSub}>Track your KYC verification status</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 30 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchStatus(true)} tintColor={ACCENT} />}
      >
        <View style={[s.statusCard, { backgroundColor: cfg.bgColor }]}>
          <View style={[s.statusIconBg, { backgroundColor: cfg.glowColor }]}>
            <Image source={cfg.icon} style={s.statusIcon} tintColor={cfg.color} resizeMode="contain" />
          </View>
          <Text style={[s.statusTitle, { color: cfg.color }]}>{cfg.title}</Text>
          <Text style={s.statusMsg}>{cfg.message}</Text>
        </View>

        {status === "rejected" && data?.rejection_reason && (
          <View style={s.rejectionCard}>
            <View style={s.rejectionHeader}>
              <Image source={require("@/assets/icons/ic_close_fill.png")} style={s.rejIcon} tintColor="#EF4444" resizeMode="contain" />
              <Text style={s.rejectionLabel}>Reason for Rejection</Text>
            </View>
            <Text style={s.rejectionReason}>{data.rejection_reason}</Text>
          </View>
        )}

        <View style={s.timeline}>
          <Text style={s.timelineTitle}>Application Timeline</Text>
          {TIMELINE_STEPS.map((step, i) => {
            const done = stepDone(step.doneKey);
            const isActive = step.doneKey === "review" && status === "under_review";
            return (
              <View key={i} style={s.tlRow}>
                <View style={s.tlLeft}>
                  <View style={[s.tlDot, done ? s.tlDotDone : isActive ? s.tlDotActive : s.tlDotPending]}>
                    <Image source={step.icon} style={s.tlIcon} tintColor={done || isActive ? "#fff" : "#A0A3B5"} resizeMode="contain" />
                  </View>
                  {i < TIMELINE_STEPS.length - 1 && <View style={[s.tlLine, done && s.tlLineDone]} />}
                </View>
                <Text style={[s.tlLabel, done ? s.tlLabelDone : s.tlLabelPending]}>{step.label}</Text>
              </View>
            );
          })}
        </View>

        {(status === "rejected" || status === "not_applied") && (
          <TouchableOpacity style={s.ctaBtnWrap} onPress={() => router.push("/auth/profile-setup")} activeOpacity={0.85}>
            <LinearGradient colors={[DARK, "#2D3057"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.ctaBtn}>
              <Image source={require("@/assets/icons/ic_edit.png")} style={s.ctaIcon} tintColor="#fff" resizeMode="contain" />
              <Text style={s.ctaBtnTxt}>{status === "rejected" ? "Re-apply" : "Start Application"}</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {(status === "pending" || status === "under_review") && (
          <View style={s.waitBanner}>
            <View style={s.pulseDot} />
            <Text style={s.waitTxt}>Auto-checking every 10 seconds...</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  backIcon: { width: 20, height: 20 },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.55)", marginTop: 3 },

  body: { paddingHorizontal: 20, paddingTop: 4, gap: 16 },
  loadingTxt: { marginTop: 12, fontSize: 14, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.5)" },

  statusCard: { borderRadius: 24, padding: 28, alignItems: "center", gap: 10 },
  statusIconBg: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  statusIcon: { width: 36, height: 36 },
  statusTitle: { fontSize: 19, fontFamily: "Poppins_700Bold", textAlign: "center" },
  statusMsg: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F", textAlign: "center", lineHeight: 22 },

  rejectionCard: { backgroundColor: "#FEF2F2", borderRadius: 16, padding: 16, gap: 10 },
  rejectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  rejIcon: { width: 16, height: 16 },
  rejectionLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#EF4444" },
  rejectionReason: { fontSize: 14, fontFamily: "Poppins_400Regular", color: DARK, lineHeight: 22 },

  timeline: { backgroundColor: "#fff", borderRadius: 20, padding: 20, gap: 0 },
  timelineTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: DARK, marginBottom: 18 },
  tlRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, minHeight: 48 },
  tlLeft: { alignItems: "center", width: 28 },
  tlDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tlDotDone: { backgroundColor: "#22C55E" },
  tlDotActive: { backgroundColor: "#3B82F6" },
  tlDotPending: { backgroundColor: "#E8EAF0" },
  tlLine: { width: 2, flex: 1, backgroundColor: "#E8EAF0", minHeight: 18 },
  tlLineDone: { backgroundColor: "#22C55E" },
  tlIcon: { width: 13, height: 13 },
  tlLabel: { fontSize: 14, fontFamily: "Poppins_400Regular", paddingTop: 5 },
  tlLabelDone: { color: DARK, fontFamily: "Poppins_500Medium" },
  tlLabelPending: { color: "#84889F" },

  ctaBtnWrap: {
    borderRadius: 18, overflow: "hidden",
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 17, borderRadius: 18 },
  ctaIcon: { width: 18, height: 18 },
  ctaBtnTxt: { fontSize: 16, fontFamily: "Poppins_700Bold", color: "#fff" },

  waitBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" },
  waitTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.5)" },

  approvedBody: { paddingHorizontal: 20, paddingTop: 4, gap: 16 },
  approvedCard: { borderRadius: 28, overflow: "hidden", shadowColor: "#22C55E", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  approvedGradient: { padding: 32, alignItems: "center", gap: 14 },
  approvedIconWrap: { marginBottom: 4 },
  approvedIconBg: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  approvedIcon: { width: 44, height: 44 },
  approvedEmoji: { fontSize: 36 },
  approvedTitle: { fontSize: 26, fontFamily: "Poppins_700Bold", color: "#fff", textAlign: "center" },
  approvedSub: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.75)", textAlign: "center", lineHeight: 22 },
  approvedDivider: { width: "100%", height: 1, backgroundColor: "rgba(255,255,255,0.12)", marginVertical: 6 },
  approvedStats: { flexDirection: "row", alignItems: "center", gap: 0 },
  approvedStat: { flex: 1, alignItems: "center", gap: 8 },
  approvedStatSep: { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.15)" },
  approvedStatIcon: { width: 24, height: 24 },
  approvedStatLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.8)" },
});
