import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { confirmDialog } from "@/utils/dialog";
import { API } from "@/services/api";
import { showSuccessToast, showErrorToast } from "@/components/Toast";

interface VipPlan {
  id: string;
  tier: string;
  name: string;
  price_coins: number;
  duration_days: number;
  call_discount_pct: number;
  daily_bonus_coins: number;
  chat_unlock: boolean;
  badge: string | null;
  color: string | null;
  perks: string[];
}
interface VipStatus {
  is_vip: boolean;
  tier: string | null;
  plan_name: string | null;
  expires_at: number | null;
  days_left: number;
  call_discount_pct: number;
  daily_bonus_coins: number;
  daily_available: boolean;
  coins: number;
}

const PURPLE_GRAD: readonly [string, string] = ["#7B2FF7", "#A855F7"];

export default function VipScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, refreshBalance } = useAuth();

  const [plans, setPlans] = useState<VipPlan[]>([]);
  const [status, setStatus] = useState<VipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        API.getVipPlans().catch(() => [] as VipPlan[]),
        API.getVipStatus().catch(() => null),
      ]);
      setPlans(Array.isArray(p) ? p : []);
      setStatus(s);
    } catch {
      /* ignore — UI shows empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refreshBalance().catch(() => {})]);
    } finally {
      setRefreshing(false);
    }
  }, [load, refreshBalance]);

  const coins = status?.coins ?? user?.coins ?? 0;

  const doSubscribe = async (plan: VipPlan) => {
    setBusyPlan(plan.id);
    try {
      const res = await API.subscribeVip(plan.id);
      showSuccessToast(`${plan.name} active — enjoy your perks!`, "Welcome to VIP 🎉");
      await Promise.all([load(), refreshBalance().catch(() => {})]);
      void res;
    } catch (e: any) {
      const msg = String(e?.message || "");
      showErrorToast(/coin/i.test(msg) ? msg : "Couldn't complete your VIP purchase.", "Subscription failed");
    } finally {
      setBusyPlan(null);
    }
  };

  const confirmSubscribe = (plan: VipPlan) => {
    const isRenew = status?.is_vip && status.tier === plan.tier;
    confirmDialog({
      title: isRenew ? `Renew ${plan.name}?` : `Subscribe to ${plan.name}?`,
      message: `This will use ${plan.price_coins.toLocaleString()} coins for ${plan.duration_days} days of VIP.`,
      confirmText: isRenew ? "Renew" : "Subscribe",
      onConfirm: () => doSubscribe(plan),
    });
  };

  const claimDaily = async () => {
    setClaiming(true);
    try {
      const res = await API.claimVipDaily();
      showSuccessToast(`+${res.granted} coins added to your balance.`, "Daily bonus claimed 🎁");
      await Promise.all([load(), refreshBalance().catch(() => {})]);
    } catch (e: any) {
      const msg = String(e?.message || "");
      showErrorToast(/already/i.test(msg) ? "You've already claimed today. Come back tomorrow." : "Couldn't claim your bonus.");
    } finally {
      setClaiming(false);
    }
  };

  const expiryLabel = status?.expires_at
    ? new Date(status.expires_at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Purple gradient header */}
      <LinearGradient colors={PURPLE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>VIP Membership</Text>
        <View style={styles.coinChip}>
          <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 15, height: 15 }} resizeMode="contain" />
          <Text style={styles.coinChipText}>{coins.toLocaleString()}</Text>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
        >
          {/* Active VIP status card */}
          {status?.is_vip ? (
            <LinearGradient colors={["#5B21B6", "#9333EA"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.statusCard, cardShadow()]}>
              <View style={styles.statusTop}>
                <View>
                  <Text style={styles.statusActive}>ACTIVE</Text>
                  <Text style={styles.statusPlan}>{status.plan_name ?? "VIP"}</Text>
                </View>
                <View style={styles.crownBadge}>
                  <Text style={{ fontSize: 26 }}>👑</Text>
                </View>
              </View>
              <Text style={styles.statusExpiry}>
                {status.days_left} day{status.days_left === 1 ? "" : "s"} left · renews on {expiryLabel}
              </Text>
              {status.daily_bonus_coins > 0 && (
                <TouchableOpacity
                  onPress={claimDaily}
                  disabled={!status.daily_available || claiming}
                  activeOpacity={0.85}
                  style={[styles.claimBtn, { opacity: status.daily_available && !claiming ? 1 : 0.55 }]}
                >
                  {claiming ? (
                    <ActivityIndicator size="small" color="#7B2FF7" />
                  ) : (
                    <>
                      <Feather name="gift" size={16} color="#7B2FF7" />
                      <Text style={styles.claimText}>
                        {status.daily_available ? `Claim ${status.daily_bonus_coins} daily coins` : "Daily bonus claimed"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </LinearGradient>
          ) : (
            <LinearGradient colors={PURPLE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.heroCard, cardShadow()]}>
              <Text style={{ fontSize: 34 }}>👑</Text>
              <Text style={styles.heroTitle}>Become a VIP</Text>
              <Text style={styles.heroSub}>Cheaper calls, daily free coins, unlock chat with anyone & an exclusive badge.</Text>
            </LinearGradient>
          )}

          {/* Plans */}
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose your plan</Text>
          {plans.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 20, fontFamily: "Poppins_400Regular" }}>
              No plans available right now.
            </Text>
          ) : (
            plans.map((plan) => {
              const accent = plan.color || colors.accent;
              const isCurrent = status?.is_vip && status.tier === plan.tier;
              return (
                <View key={plan.id} style={[styles.planCard, { backgroundColor: colors.card, borderColor: accent + "55" }, cardShadow()]}>
                  <View style={styles.planHead}>
                    <View style={[styles.planBadge, { backgroundColor: accent + "22" }]}>
                      <Text style={{ fontSize: 20 }}>{plan.badge ?? "⭐"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.planName, { color: colors.text }]}>{plan.name}</Text>
                      <Text style={[styles.planDuration, { color: colors.mutedForeground }]}>{plan.duration_days} days</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <View style={styles.priceRow}>
                        <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 16, height: 16 }} resizeMode="contain" />
                        <Text style={[styles.priceText, { color: colors.text }]}>{plan.price_coins.toLocaleString()}</Text>
                      </View>
                      {isCurrent && <Text style={[styles.currentTag, { color: accent }]}>CURRENT</Text>}
                    </View>
                  </View>

                  <View style={styles.perkList}>
                    {plan.perks.map((perk, i) => (
                      <View key={i} style={styles.perkRow}>
                        <View style={[styles.perkTick, { backgroundColor: accent + "22" }]}>
                          <Feather name="check" size={12} color={accent} />
                        </View>
                        <Text style={[styles.perkText, { color: colors.labelColor }]}>{perk}</Text>
                      </View>
                    ))}
                  </View>

                  <TouchableOpacity
                    onPress={() => confirmSubscribe(plan)}
                    disabled={busyPlan === plan.id}
                    activeOpacity={0.85}
                    style={{ borderRadius: 14, overflow: "hidden", marginTop: 4 }}
                  >
                    <LinearGradient colors={[accent, accent]} style={styles.subBtn}>
                      {busyPlan === plan.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.subBtnText}>{isCurrent ? "Renew" : "Subscribe"}</Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              );
            })
          )}

          <Text style={[styles.footNote, { color: colors.mutedForeground }]}>
            VIP is paid with coins and auto-expires at the end of the period. Perks apply while active.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function cardShadow() {
  return Platform.select({
    ios: { shadowColor: "#5B21B6", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } },
    android: { elevation: 4 },
    web: { boxShadow: "0 5px 16px rgba(91,33,182,0.14)" } as any,
  });
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16, paddingBottom: 16, flexDirection: "row", alignItems: "center", gap: 12,
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: "Poppins_700Bold", color: "#fff" },
  coinChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.22)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 },
  coinChipText: { color: "#fff", fontFamily: "Poppins_600SemiBold", fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  statusCard: { borderRadius: 20, padding: 18, marginBottom: 18 },
  statusTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusActive: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "Poppins_600SemiBold", letterSpacing: 1 },
  statusPlan: { color: "#fff", fontSize: 22, fontFamily: "Poppins_700Bold", marginTop: 2 },
  crownBadge: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  statusExpiry: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 10 },
  claimBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 12, marginTop: 16 },
  claimText: { color: "#7B2FF7", fontFamily: "Poppins_600SemiBold", fontSize: 14 },

  heroCard: { borderRadius: 20, padding: 22, alignItems: "center", gap: 6, marginBottom: 18 },
  heroTitle: { color: "#fff", fontSize: 22, fontFamily: "Poppins_700Bold" },
  heroSub: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 19 },

  sectionTitle: { fontSize: 16, fontFamily: "Poppins_700Bold", marginBottom: 12 },
  planCard: { borderRadius: 18, borderWidth: 1.5, padding: 16, marginBottom: 14, gap: 12 },
  planHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  planBadge: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  planName: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  planDuration: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  priceText: { fontSize: 17, fontFamily: "Poppins_700Bold" },
  currentTag: { fontSize: 10, fontFamily: "Poppins_700Bold", letterSpacing: 0.5, marginTop: 2 },
  perkList: { gap: 9 },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  perkTick: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  perkText: { flex: 1, fontSize: 13, fontFamily: "Poppins_400Regular" },
  subBtn: { paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  subBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  footNote: { fontSize: 11, fontFamily: "Poppins_400Regular", textAlign: "center", marginTop: 8, lineHeight: 16 },
});


// Per-screen error boundary — contains a render crash to this screen.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
