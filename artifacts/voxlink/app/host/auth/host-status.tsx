// KYC Application Status Screen
import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DARK = "#111329";
const ACCENT = "#A00EE7";

type Status = "pending" | "under_review" | "approved" | "rejected" | "not_applied";

const STATUS_CONFIG: Record<Status, { icon: string; color: string; bg: string; title: string; message: string }> = {
  pending: {
    icon: "clock",
    color: "#F59E0B",
    bg: "#FFFBEB",
    title: "Application Submitted",
    message: "Your application is in the queue. Our team will review it within 24–48 hours.",
  },
  under_review: {
    icon: "search",
    color: "#3B82F6",
    bg: "#EFF6FF",
    title: "Under Review",
    message: "Great news! Our team is actively reviewing your application. You'll hear back soon.",
  },
  approved: {
    icon: "check-circle",
    color: "#22C55E",
    bg: "#F0FDF4",
    title: "Application Approved! 🎉",
    message: "Congratulations! You are now a host on VoxLink. Start accepting calls and earning coins.",
  },
  rejected: {
    icon: "x-circle",
    color: "#EF4444",
    bg: "#FEF2F2",
    title: "Application Rejected",
    message: "Unfortunately, your application was not approved. Please see the reason below and re-apply.",
  },
  not_applied: {
    icon: "file-text",
    color: "#84889F",
    bg: "#F8F9FC",
    title: "No Application Found",
    message: "You haven't submitted a host application yet.",
  },
};

export default function HostStatusScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await API.getHostAppStatus();
      setData(res);
      // If approved, update local user role and clear pending flag
      if (res?.status === "approved" && user?.role !== "host") {
        await updateProfile({ role: "host" });
        await AsyncStorage.removeItem("hostAppPending");
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchStatus();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator color={ACCENT} size="large" />
        <Text style={s.loadingTxt}>Loading status...</Text>
      </View>
    );
  }

  const status: Status = !data?.applied ? "not_applied" : (data.status ?? "pending");
  const cfg = STATUS_CONFIG[status];

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={[DARK, "#2D3057"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace("/shared/auth/role-select")} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Host Application</Text>
        <Text style={s.headerSub}>Track your KYC verification status</Text>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 30 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchStatus(true)} tintColor={ACCENT} />}
      >
        {/* Status Card */}
        <View style={[s.statusCard, { backgroundColor: cfg.bg }]}>
          <View style={[s.statusIconBg, { backgroundColor: cfg.color + "20" }]}>
            <Feather name={cfg.icon as any} size={32} color={cfg.color} />
          </View>
          <Text style={[s.statusTitle, { color: cfg.color }]}>{cfg.title}</Text>
          <Text style={s.statusMsg}>{cfg.message}</Text>
        </View>

        {/* Rejection Reason */}
        {status === "rejected" && data?.rejection_reason && (
          <View style={s.rejectionCard}>
            <View style={s.rejectionHeader}>
              <Feather name="alert-circle" size={16} color="#EF4444" />
              <Text style={s.rejectionLabel}>Reason for Rejection</Text>
            </View>
            <Text style={s.rejectionReason}>{data.rejection_reason}</Text>
          </View>
        )}

        {/* Timeline */}
        <View style={s.timeline}>
          <Text style={s.timelineTitle}>Application Timeline</Text>

          {[
            { label: "Account Created", done: true, icon: "user-check" },
            { label: "Application Submitted", done: !!data?.applied, icon: "file-text" },
            { label: "Under Review", done: ["under_review", "approved"].includes(status), active: status === "under_review", icon: "search" },
            { label: "Decision Made", done: ["approved", "rejected"].includes(status), icon: "clipboard" },
          ].map((step, i) => (
            <View key={i} style={s.tlRow}>
              <View style={s.tlLeft}>
                <View style={[s.tlDot, step.done ? s.tlDotDone : step.active ? s.tlDotActive : s.tlDotPending]}>
                  <Feather name={step.icon as any} size={12} color={step.done || step.active ? "#fff" : "#84889F"} />
                </View>
                {i < 3 && <View style={[s.tlLine, step.done && s.tlLineDone]} />}
              </View>
              <Text style={[s.tlLabel, step.done ? s.tlLabelDone : s.tlLabelPending]}>{step.label}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        {status === "approved" && (
          <TouchableOpacity
            style={s.ctaBtn}
            onPress={async () => {
              await AsyncStorage.removeItem("hostAppPending");
              router.replace("/host/screens/host");
            }}
            activeOpacity={0.85}
          >
            <LinearGradient colors={["#A00EE7", "#6A00B8"]} style={s.ctaBtnGrad}>
              <Feather name="star" size={18} color="#fff" />
              <Text style={s.ctaBtnTxt}>Go to Host Dashboard</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {(status === "rejected" || status === "not_applied") && (
          <TouchableOpacity
            style={s.ctaBtn}
            onPress={() => router.push("/host/auth/host-register")}
            activeOpacity={0.85}
          >
            <LinearGradient colors={[DARK, "#2D3057"]} style={s.ctaBtnGrad}>
              <Feather name="refresh-cw" size={18} color="#fff" />
              <Text style={s.ctaBtnTxt}>{status === "rejected" ? "Re-apply" : "Start Application"}</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {(status === "pending" || status === "under_review") && (
          <View style={s.waitBanner}>
            <Feather name="refresh-cw" size={14} color="#84889F" />
            <Text style={s.waitTxt}>Pull down to refresh status</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 28 },
  backBtn: { marginBottom: 16, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff", marginBottom: 4 },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.7)" },
  body: { padding: 24, gap: 20 },
  loadingTxt: { marginTop: 12, fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F" },
  statusCard: { borderRadius: 20, padding: 24, alignItems: "center", gap: 12 },
  statusIconBg: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", textAlign: "center" },
  statusMsg: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#84889F", textAlign: "center", lineHeight: 22 },
  rejectionCard: { backgroundColor: "#FEF2F2", borderRadius: 16, padding: 16, gap: 8 },
  rejectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  rejectionLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#EF4444" },
  rejectionReason: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#111329", lineHeight: 22 },
  timeline: { backgroundColor: "#F8F9FC", borderRadius: 16, padding: 20, gap: 0 },
  timelineTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: "#111329", marginBottom: 16 },
  tlRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, minHeight: 44 },
  tlLeft: { alignItems: "center", width: 24 },
  tlDot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tlDotDone: { backgroundColor: "#22C55E" },
  tlDotActive: { backgroundColor: "#3B82F6" },
  tlDotPending: { backgroundColor: "#E8EAF0" },
  tlLine: { width: 2, flex: 1, backgroundColor: "#E8EAF0", minHeight: 16 },
  tlLineDone: { backgroundColor: "#22C55E" },
  tlLabel: { fontSize: 14, fontFamily: "Poppins_400Regular", paddingTop: 4 },
  tlLabelDone: { color: "#111329", fontFamily: "Poppins_500Medium" },
  tlLabelPending: { color: "#84889F" },
  ctaBtn: { borderRadius: 16, overflow: "hidden" },
  ctaBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16 },
  ctaBtnTxt: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  waitBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  waitTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F" },
});
