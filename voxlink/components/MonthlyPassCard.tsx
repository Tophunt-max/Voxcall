import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

// ─────────────────────────────────────────────────────────────────────────────
// MonthlyPassCard — the Chamet-style Monthly Pass surface.
// ─────────────────────────────────────────────────────────────────────────────
// Self-contained: fetches GET /api/user/pass, renders the points progress bar,
// a Common (free) + Premium (VIP/paid) tier track, and handles purchase + claim.
// `onChanged` lets the parent (tasks screen) refresh its own coin header after
// a claim / purchase changes the balance.

type PassData = Awaited<ReturnType<typeof API.getPass>>;
type PassTier = NonNullable<PassData["tiers"]>[number];

const PASS_BG = ["#6D28D9", "#DB2777"] as const;
const PREMIUM_ACCENT = ["#F59E0B", "#D97706"] as const;
const COMMON_ACCENT = ["#8B5CF6", "#6D28D9"] as const;

function formatDaysClock(sec: number): string {
  if (sec <= 0) return "0d 00:00:00";
  const days = Math.floor(sec / 86400);
  const rest = sec % 86400;
  const h = Math.floor(rest / 3600);
  const m = Math.floor((rest % 3600) / 60);
  const s = Math.floor(rest % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function MonthlyPassCard({ onChanged }: { onChanged?: () => void }) {
  const colors = useColors();
  const { updateCoins } = useAuth();

  const [data, setData] = useState<PassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // 'purchase' | `${level}:${track}`

  const load = useCallback(async () => {
    try {
      const res = await API.getPass();
      setData(res);
      setServerOffsetMs(Date.now() - res.server_time * 1000);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Math.floor((Date.now() - serverOffsetMs) / 1000);

  const monthEndSec = data ? Math.max(0, data.month_end - now) : 0;
  const points = data?.points ?? 0;
  const maxPoints = data?.max_points ?? 0;
  const progressPct = maxPoints > 0 ? Math.min(100, Math.round((points / maxPoints) * 100)) : 0;
  const tiers: PassTier[] = useMemo(() => data?.tiers ?? [], [data]);

  const purchase = useCallback(async () => {
    if (busy) return;
    setBusy("purchase");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const res = await API.purchasePass();
      if (typeof res.coins === "number") updateCoins(res.coins);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showSuccessToast(res.already_unlocked ? "Premium already unlocked" : "Monthly Pass unlocked! 🎟️");
      await load();
      onChanged?.();
    } catch (e: any) {
      showErrorToast(e?.message ?? "Could not unlock the pass");
    } finally {
      setBusy(null);
    }
  }, [busy, updateCoins, load, onChanged]);

  const claim = useCallback(
    async (tier: PassTier, track: "common" | "premium") => {
      const key = `${tier.level}:${track}`;
      if (busy) return;
      setBusy(key);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      try {
        const res = await API.claimPass(tier.level, track);
        updateCoins(res.coins);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        showSuccessToast(`+${res.coins_awarded} coins!`, `${tier.label} claimed`);
        await load();
        onChanged?.();
      } catch (e: any) {
        showErrorToast(e?.message ?? "Could not claim reward");
      } finally {
        setBusy(null);
      }
    },
    [busy, updateCoins, load, onChanged],
  );

  if (loading) {
    return (
      <View style={[styles.loadingWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ActivityIndicator color={PASS_BG[0]} />
      </View>
    );
  }
  if (!data || !data.enabled) return null;

  const premiumUnlocked = !!data.premium_unlocked;

  return (
    <View style={styles.wrap}>
      {/* Banner header */}
      <LinearGradient colors={PASS_BG as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <View style={styles.bannerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerKicker}>MONTHLY PASS</Text>
            <Text style={styles.bannerTitle} numberOfLines={1}>{data.title ?? "Monthly Pass"}</Text>
          </View>
          <View style={styles.endsPill}>
            <Text style={styles.endsPillText}>Ends in {formatDaysClock(monthEndSec)}</Text>
          </View>
        </View>

        {/* Points progress */}
        <View style={styles.pointsRow}>
          <Text style={styles.pointsText}>⭐ {points.toLocaleString()} pts</Text>
          <Text style={styles.pointsMax}>{maxPoints.toLocaleString()} pts</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>

        {/* Premium unlock state */}
        {premiumUnlocked ? (
          <View style={styles.unlockedRow}>
            <Text style={styles.unlockedText}>
              {data.premium_via_vip ? "👑 Premium unlocked with VIP" : "🎟️ Premium track unlocked"}
            </Text>
          </View>
        ) : (
          <View style={styles.unlockCtaRow}>
            <TouchableOpacity
              onPress={purchase}
              disabled={busy === "purchase"}
              activeOpacity={0.9}
              style={styles.unlockBtn}
            >
              {busy === "purchase" ? (
                <ActivityIndicator color="#6D28D9" size="small" />
              ) : (
                <>
                  <Text style={styles.unlockBtnText}>Unlock Premium</Text>
                  {data.price_coins ? (
                    <View style={styles.unlockPriceChip}>
                      <Image source={require("@/assets/icons/ic_coin.png")} style={styles.unlockPriceCoin} resizeMode="contain" />
                      <Text style={styles.unlockPriceText}>{data.price_coins.toLocaleString()}</Text>
                    </View>
                  ) : null}
                </>
              )}
            </TouchableOpacity>
            {data.vip_auto_unlock ? (
              <TouchableOpacity onPress={() => router.push("/user/vip" as any)} activeOpacity={0.85} style={styles.vipHintBtn}>
                <Text style={styles.vipHintText}>or go VIP 👑</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </LinearGradient>

      {/* Tier track */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiersRow}>
        {tiers.map((tier) => {
          const reached = tier.reached;
          const commonKey = `${tier.level}:common`;
          const premiumKey = `${tier.level}:premium`;
          return (
            <View key={tier.level} style={[styles.tierCol, { borderColor: reached ? PASS_BG[0] : colors.border, backgroundColor: colors.card }]}>
              {/* Points node */}
              <View style={[styles.tierNode, { backgroundColor: reached ? PASS_BG[0] : colors.border }]}>
                <Text style={[styles.tierNodeText, { color: reached ? "#fff" : colors.subText }]}>{tier.points}</Text>
              </View>
              <Text style={[styles.tierLabel, { color: colors.text }]} numberOfLines={1}>{tier.label}</Text>

              {/* Common reward */}
              {tier.free_coins > 0 ? (
                <TierReward
                  colors={colors}
                  accent={COMMON_ACCENT}
                  coins={tier.free_coins}
                  claimed={tier.free_claimed}
                  claimable={tier.free_claimable}
                  reached={reached}
                  busy={busy === commonKey}
                  onPress={() => claim(tier, "common")}
                />
              ) : (
                <View style={styles.tierRewardEmpty} />
              )}

              {/* Premium reward */}
              {tier.premium_coins > 0 ? (
                <TierReward
                  colors={colors}
                  accent={PREMIUM_ACCENT}
                  coins={tier.premium_coins}
                  claimed={tier.premium_claimed}
                  claimable={tier.premium_claimable}
                  reached={reached}
                  premium
                  locked={!premiumUnlocked}
                  busy={busy === premiumKey}
                  onPress={() => claim(tier, "premium")}
                />
              ) : (
                <View style={styles.tierRewardEmpty} />
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Track legend */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COMMON_ACCENT[0] }]} />
          <Text style={[styles.legendText, { color: colors.subText }]}>Common (free)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: PREMIUM_ACCENT[0] }]} />
          <Text style={[styles.legendText, { color: colors.subText }]}>Premium (VIP)</Text>
        </View>
      </View>
    </View>
  );
}

function TierReward({
  colors,
  accent,
  coins,
  claimed,
  claimable,
  reached,
  premium,
  locked,
  busy,
  onPress,
}: {
  colors: ReturnType<typeof useColors>;
  accent: readonly [string, string];
  coins: number;
  claimed: boolean;
  claimable: boolean;
  reached: boolean;
  premium?: boolean;
  locked?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  if (claimed) {
    return (
      <View style={[styles.tierReward, styles.tierRewardClaimed]}>
        <Text style={styles.tierRewardClaimedText}>✓</Text>
        <Text style={styles.tierRewardClaimedCoins}>+{coins}</Text>
      </View>
    );
  }
  if (claimable) {
    return (
      <TouchableOpacity onPress={onPress} disabled={busy} activeOpacity={0.85} style={styles.tierRewardBtnWrap}>
        <LinearGradient colors={accent as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tierReward}>
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.tierRewardClaimLabel}>Claim</Text>
              <Text style={styles.tierRewardClaimCoins}>+{coins}</Text>
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  }
  // Not yet claimable — reached-but-locked (premium) vs not-reached vs available-later.
  return (
    <View style={[styles.tierReward, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}>
      <Text style={styles.tierRewardLockIcon}>{premium && locked ? "🔒" : reached ? "🔒" : "🎁"}</Text>
      <Text style={[styles.tierRewardCoins, { color: colors.subText }]}>+{coins}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { height: 90, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  wrap: { borderRadius: 18, overflow: "hidden" },

  banner: { padding: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  bannerTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bannerKicker: { color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: "Poppins_600SemiBold", letterSpacing: 1.2 },
  bannerTitle: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold", marginTop: 1 },
  endsPill: { backgroundColor: "rgba(0,0,0,0.22)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  endsPillText: { color: "#fff", fontSize: 10.5, fontFamily: "Poppins_600SemiBold" },

  pointsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, marginBottom: 5 },
  pointsText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold" },
  pointsMax: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontFamily: "Poppins_500Medium" },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.25)", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#FCD34D", borderRadius: 4 },

  unlockedRow: { marginTop: 12, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingVertical: 7, alignItems: "center" },
  unlockedText: { color: "#fff", fontSize: 12.5, fontFamily: "Poppins_600SemiBold" },

  unlockCtaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  unlockBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff", paddingHorizontal: 14, height: 40, borderRadius: 12, flex: 1 },
  unlockBtnText: { color: "#6D28D9", fontSize: 14, fontFamily: "Poppins_700Bold" },
  unlockPriceChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FFB800", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9 },
  unlockPriceCoin: { width: 12, height: 12 },
  unlockPriceText: { color: "#5A2B00", fontSize: 11.5, fontFamily: "Poppins_700Bold" },
  vipHintBtn: { paddingHorizontal: 4 },
  vipHintText: { color: "#fff", fontSize: 12, fontFamily: "Poppins_600SemiBold", textDecorationLine: "underline" },

  tiersRow: { paddingHorizontal: 12, paddingVertical: 12, gap: 10 },
  tierCol: { width: 96, borderRadius: 14, borderWidth: 1.5, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 6 },
  tierNode: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  tierNodeText: { fontSize: 12, fontFamily: "Poppins_700Bold" },
  tierLabel: { fontSize: 11.5, fontFamily: "Poppins_600SemiBold" },

  tierReward: { width: "100%", height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tierRewardBtnWrap: { width: "100%", borderRadius: 10, overflow: "hidden" },
  tierRewardEmpty: { width: "100%", height: 42 },
  tierRewardClaimLabel: { color: "#fff", fontSize: 10.5, fontFamily: "Poppins_700Bold" },
  tierRewardClaimCoins: { color: "#fff", fontSize: 11, fontFamily: "Poppins_700Bold" },
  tierRewardClaimed: { backgroundColor: "rgba(16,185,129,0.14)" },
  tierRewardClaimedText: { color: "#059669", fontSize: 14, fontFamily: "Poppins_700Bold" },
  tierRewardClaimedCoins: { color: "#059669", fontSize: 10, fontFamily: "Poppins_600SemiBold" },
  tierRewardLockIcon: { fontSize: 14 },
  tierRewardCoins: { fontSize: 10.5, fontFamily: "Poppins_600SemiBold" },

  legendRow: { flexDirection: "row", justifyContent: "center", gap: 18, paddingBottom: 12, paddingTop: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 11, fontFamily: "Poppins_500Medium" },
});
