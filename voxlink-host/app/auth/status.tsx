import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl, Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BG     = "#0A0B1E";
const ACCENT = "#A00EE7";
const DARK   = "#111329";

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
    title: "Application Approved!",
    message: "Congratulations! You are now a host on VoxLink. Start accepting calls and earning coins.",
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
  const { user, logout } = useAuth();
  const [data, setData]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await API.getHostAppStatus();
      setData(res);
      if (res?.status === "approved" && user?.role !== "host") {
        await AsyncStorage.removeItem("hostAppPending");
        showSuccessToast("Your host account is ready! Please sign in again.", "Approved!");
        await logout();
        router.replace("/auth/login");
        return;
      }
    } catch {
      setData(null);
      showErrorToast("Failed to load application status.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { fetchStatus(); }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG }}>
        <ActivityIndicator color={ACCENT} size="large" />
        <Text style={s.loadingTxt}>Checking application status...</Text>
      </View>
    );
  }

  const status: Status = !data?.applied ? "not_applied" : (data.status ?? "pending");
  const cfg = STATUS_CONFIG[status];

  const stepDone = (key: string) => {
    if (key === "always") return true;
    if (key === "applied") return !!data?.applied;
    if (key === "review")  return ["under_review", "approved", "rejected"].includes(status);
    if (key === "decision") return ["approved", "rejected"].includes(status);
    return false;
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* ── Header ── */}
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

      {/* ── Body ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 30 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchStatus(true)} tintColor={ACCENT} />}
      >
        {/* Status card */}
        <View style={[s.statusCard, { backgroundColor: cfg.bgColor }]}>
          <View style={[s.statusIconBg, { backgroundColor: cfg.glowColor }]}>
            <Image source={cfg.icon} style={s.statusIcon} tintColor={cfg.color} resizeMode="contain" />
          </View>
          <Text style={[s.statusTitle, { color: cfg.color }]}>{cfg.title}</Text>
          {status === "approved" && <Text style={s.statusEmoji}>🎉</Text>}
          <Text style={s.statusMsg}>{cfg.message}</Text>
        </View>

        {/* Rejection reason */}
        {status === "rejected" && data?.rejection_reason && (
          <View style={s.rejectionCard}>
            <View style={s.rejectionHeader}>
              <Image source={require("@/assets/icons/ic_close_fill.png")} style={s.rejIcon} tintColor="#EF4444" resizeMode="contain" />
              <Text style={s.rejectionLabel}>Reason for Rejection</Text>
            </View>
            <Text style={s.rejectionReason}>{data.rejection_reason}</Text>
          </View>
        )}

        {/* Timeline */}
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

        {/* Actions */}
        {status === "approved" && (
          <TouchableOpacity
            style={s.ctaBtnWrap}
            onPress={async () => { await AsyncStorage.removeItem("hostAppPending"); router.replace("/(tabs)"); }}
            activeOpacity={0.85}
          >
            <LinearGradient colors={[ACCENT, "#6A00B8"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.ctaBtn}>
              <Image source={require("@/assets/icons/ic_star.png")} style={s.ctaIcon} tintColor="#fff" resizeMode="contain" />
              <Text style={s.ctaBtnTxt}>Go to Host Dashboard</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

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
            <Image source={require("@/assets/icons/ic_calendar.png")} style={s.waitIcon} tintColor="rgba(255,255,255,0.4)" resizeMode="contain" />
            <Text style={s.waitTxt}>Pull down to refresh status</Text>
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
  statusEmoji: { fontSize: 28 },
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

  waitBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  waitIcon: { width: 14, height: 14 },
  waitTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.45)" },
});
