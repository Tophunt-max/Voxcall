import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Image,
  Platform,
  Share,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import { WEB_INPUT_RESET } from "@workspace/shared-ui/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Rewards Hub
// ─────────────────────────────────────────────────────────────────────────────
// Full production-grade rewards surface. Sections:
//   1. Header (coins / earned / claimable)
//   2. Active Campaigns strip (FOMO — countdown)
//   3. Lucky Spin entry card (variable reward)
//   4. Coupon redeem row (marketing lever)
//   5. Task cards grouped by category (Daily / One-Time / Ongoing)
//   6. Achievements strip (silent milestones)
//
// See .kiro/steering/rewards-spec.md for the full architecture rationale.

const ACCENT = ["#C64BE8", "#8A2BD8"] as const;
const HEADER_BG = ["#FFB800", "#FF6A00"] as const;
const SPIN_BG = ["#F59E0B", "#EF4444"] as const;
const CAMPAIGN_BG = ["#3B82F6", "#8B5CF6"] as const;

const ICON_EMOJI: Record<string, string> = {
  calendar: "📅", call: "📞", invite: "🎁", coin: "🪙",
  video: "📺", share: "🔗", gift: "🎁", trophy: "🏆", flame: "🔥",
};

const TIER_COLORS: Record<string, string> = {
  bronze:  "#B87333",
  silver:  "#94A3B8",
  gold:    "#F59E0B",
  platinum:"#8B5CF6",
};

type RewardsResponse = Awaited<ReturnType<typeof API.getRewards>>;
type RewardTask = RewardsResponse["tasks"][number];
type Campaign = RewardsResponse["campaigns"][number];

function formatCooldown(sec: number): string {
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const CATEGORY_META: Record<string, { label: string; order: number }> = {
  daily: { label: "Daily Tasks", order: 1 },
  one_time: { label: "One-Time Bonuses", order: 2 },
  ongoing: { label: "Ongoing Rewards", order: 3 },
};

export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateCoins } = useAuth();

  const [data, setData] = useState<RewardsResponse | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [redeemingCoupon, setRedeemingCoupon] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await API.getRewards();
      setData(res);
      setServerOffsetMs(Date.now() - res.server_time * 1000);
    } catch (e: any) {
      showErrorToast(e?.message ?? "Could not load rewards");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Live tick for cooldown / campaign countdowns.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Math.floor((Date.now() - serverOffsetMs) / 1000);

  // Live-derived task states (cooldown countdown ticks locally).
  const liveTasks: RewardTask[] = useMemo(() => {
    if (!data) return [];
    return data.tasks.map((t) => {
      if (!t.last_claimed_at || t.cooldown_hours === 0) return t;
      const nextAvailableAt = t.last_claimed_at + t.cooldown_hours * 3600;
      const remaining = Math.max(0, nextAvailableAt - now);
      return {
        ...t,
        cooldown_remaining_sec: remaining,
        already_claimed: remaining > 0,
        claimable: remaining === 0 && (t.task_type === "daily_checkin" || t.current_count >= t.target_count),
      };
    });
  }, [data, now]);

  const grouped = useMemo(() => {
    const groups: Record<string, RewardTask[]> = {};
    for (const t of liveTasks) {
      const cat = t.category in CATEGORY_META ? t.category : "ongoing";
      (groups[cat] ||= []).push(t);
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => {
        if (a.claimable !== b.claimable) return a.claimable ? -1 : 1;
        if (a.already_claimed !== b.already_claimed) return a.already_claimed ? 1 : -1;
        return 0;
      });
    }
    return Object.keys(groups)
      .sort((a, b) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99))
      .map((cat) => ({ cat, label: CATEGORY_META[cat]?.label ?? cat, tasks: groups[cat] }));
  }, [liveTasks]);

  const activeCampaigns: Campaign[] = useMemo(() => {
    if (!data) return [];
    return data.campaigns.map((c) => ({ ...c, ends_in_sec: Math.max(0, c.ends_at - now) })).filter((c) => c.ends_in_sec > 0);
  }, [data, now]);

  // ── Claim a task ─────────────────────────────────────────────────────────
  const claim = useCallback(
    async (task: RewardTask) => {
      if (!task.claimable || claimingId) return;
      setClaimingId(task.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      try {
        const res = await API.claimReward(task.id);
        updateCoins(res.new_balance);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        const bonus = res.multiplier > 1 ? ` (×${res.multiplier} bonus!)` : "";
        showSuccessToast(`+${res.coins_awarded} coins!${bonus}`, "Reward claimed");
        await load();
      } catch (e: any) {
        showErrorToast(e?.message ?? "Could not claim reward");
      } finally {
        setClaimingId(null);
      }
    },
    [claimingId, updateCoins, load],
  );

  // ── Share app ────────────────────────────────────────────────────────────
  const shareApp = useCallback(
    async (task: RewardTask) => {
      try {
        await Share.share({ message: "Come chat on VoxCall! https://voxcall.pages.dev" });
        try { await API.trackReward("share_app"); } catch { /* non-fatal */ }
        await load();
        const fresh = await API.getRewards();
        const updated = fresh.tasks.find((t) => t.id === task.id);
        if (updated?.claimable) await claim(updated);
        else setData(fresh);
      } catch (e: any) {
        showErrorToast(e?.message ?? "Could not share");
      }
    },
    [claim, load],
  );

  // ── Watch ad (stub — real rewarded-ad SDK integration lives elsewhere) ───
  const watchAd = useCallback(
    async (task: RewardTask) => {
      try {
        await API.trackReward("watch_ad");
        const fresh = await API.getRewards();
        const updated = fresh.tasks.find((t) => t.id === task.id);
        if (updated?.claimable) await claim(updated);
        else setData(fresh);
      } catch (e: any) {
        showErrorToast(e?.message ?? "Could not track ad");
      }
    },
    [claim],
  );

  // ── Redeem coupon ────────────────────────────────────────────────────────
  const redeemCoupon = useCallback(async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code || redeemingCoupon) return;
    setRedeemingCoupon(true);
    try {
      const res = await API.redeemCoupon(code);
      updateCoins(res.new_balance);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showSuccessToast(`+${res.coins_awarded} coins!`, `Coupon ${code} redeemed`);
      setCouponCode("");
      await load();
    } catch (e: any) {
      const msg = e?.message ?? "Could not redeem coupon";
      showErrorToast(msg);
    } finally {
      setRedeemingCoupon(false);
    }
  }, [couponCode, redeemingCoupon, updateCoins, load]);

  const primaryAction = (task: RewardTask): { label: string; onPress: () => void; variant: "primary" | "secondary" | "disabled" } => {
    if (task.claimable) return { label: `Claim +${task.coins_reward}`, onPress: () => claim(task), variant: "primary" };
    if (task.already_claimed) {
      const cooldownLabel = task.cooldown_hours > 0 && task.cooldown_remaining_sec > 0
        ? `Next in ${formatCooldown(task.cooldown_remaining_sec)}`
        : "Claimed";
      return { label: cooldownLabel, onPress: () => {}, variant: "disabled" };
    }
    switch (task.task_type) {
      case "complete_calls":
      case "spend_coins":
        return { label: "Start a call", onPress: () => router.push("/user/screens/home/search" as any), variant: "secondary" };
      case "refer_friend":
        return { label: "Invite friends", onPress: () => router.push("/user/referral" as any), variant: "secondary" };
      case "watch_ad":
        return { label: "Watch ad", onPress: () => watchAd(task), variant: "secondary" };
      case "share_app":
        return { label: "Share app", onPress: () => shareApp(task), variant: "secondary" };
      default:
        return { label: task.cta_link ? "Open" : "In progress", onPress: () => task.cta_link && router.push(task.cta_link as any), variant: "secondary" };
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <LinearGradient
        colors={HEADER_BG as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBackBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.headerBackText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Rewards</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Your coins</Text>
            <View style={styles.summaryValueRow}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={styles.summaryCoinIcon} resizeMode="contain" />
              <Text style={styles.summaryValue}>{user?.coins?.toLocaleString() ?? 0}</Text>
            </View>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Earned from tasks</Text>
            <Text style={[styles.summaryValue, { marginTop: 4 }]}>{(data?.total_earned ?? 0).toLocaleString()}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Ready to claim</Text>
            <Text style={[styles.summaryValue, { marginTop: 4 }]}>{data?.claimable_count ?? 0}</Text>
          </View>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={ACCENT[1]} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT[1]} />}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Active campaign banners (FOMO) ────────────────────────── */}
          {activeCampaigns.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>🔥 Limited time</Text>
              {activeCampaigns.map((c) => (
                <View key={c.id} style={styles.campaignCardWrap}>
                  <LinearGradient
                    colors={CAMPAIGN_BG as any}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.campaignCard}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.campaignBadge}>
                        <Text style={styles.campaignBadgeText}>×{c.multiplier} MULTIPLIER</Text>
                      </View>
                      <Text style={styles.campaignTitle}>{c.title}</Text>
                      {c.description ? <Text style={styles.campaignDesc}>{c.description}</Text> : null}
                      <Text style={styles.campaignCountdown}>Ends in {formatCooldown(c.ends_in_sec) || "soon"}</Text>
                    </View>
                    <Text style={styles.campaignEmoji}>⚡</Text>
                  </LinearGradient>
                </View>
              ))}
            </View>
          )}

          {/* ── Lucky Spin entry card ─────────────────────────────────── */}
          {data?.spin?.enabled && (
            <View style={styles.section}>
              <TouchableOpacity
                onPress={() => router.push("/user/rewards-spin" as any)}
                activeOpacity={0.9}
                style={styles.spinCardWrap}
                accessibilityRole="button"
                accessibilityLabel="Open lucky spin"
              >
                <LinearGradient
                  colors={SPIN_BG as any}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.spinCard}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.spinCardKicker}>LUCKY SPIN</Text>
                    <Text style={styles.spinCardTitle}>
                      {data.spin.free_spins_remaining > 0
                        ? "Free spin ready!"
                        : data.spin.earned_spins_remaining > 0
                          ? `${data.spin.earned_spins_remaining} earned spin${data.spin.earned_spins_remaining === 1 ? "" : "s"}`
                          : "Come back tomorrow"}
                    </Text>
                    <Text style={styles.spinCardSub}>Win up to 1,000 coins per spin</Text>
                  </View>
                  <Text style={styles.spinCardEmoji}>🎡</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Coupon redeem row ─────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Have a code?</Text>
            <View style={[styles.couponRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TextInput
                value={couponCode}
                onChangeText={(t) => setCouponCode(t.toUpperCase())}
                placeholder="Enter code (e.g. WELCOME50)"
                placeholderTextColor={colors.subText}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.couponInput, { color: colors.text }]}
                returnKeyType="done"
                onSubmitEditing={redeemCoupon}
                maxLength={40}
                editable={!redeemingCoupon}
              />
              <TouchableOpacity
                onPress={redeemCoupon}
                disabled={!couponCode.trim() || redeemingCoupon}
                activeOpacity={0.85}
                style={styles.couponBtnWrap}
                accessibilityRole="button"
              >
                <LinearGradient
                  colors={couponCode.trim() && !redeemingCoupon ? (ACCENT as any) : (["#9CA3AF", "#6B7280"] as any)}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.couponBtn}
                >
                  {redeemingCoupon ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.couponBtnText}>Redeem</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Task groups ────────────────────────────────────────────── */}
          {grouped.map((group) => (
            <View key={group.cat} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{group.label}</Text>
              {group.tasks.map((task) => {
                const action = primaryAction(task);
                const progressPct = task.target_count > 0 ? Math.min(100, Math.round((task.current_count / task.target_count) * 100)) : 0;
                const showProgressBar = task.task_type !== "daily_checkin" && task.target_count > 1;
                return (
                  <View key={task.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.cardHead}>
                      <View style={styles.cardIconBox}>
                        <Text style={styles.cardIconEmoji}>{ICON_EMOJI[task.icon] ?? "🎁"}</Text>
                      </View>
                      <View style={styles.cardTitleCol}>
                        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{task.title}</Text>
                        <Text style={[styles.cardDesc, { color: colors.subText }]} numberOfLines={2}>{task.description}</Text>
                      </View>
                      <View style={styles.cardRewardCol}>
                        <Image source={require("@/assets/icons/ic_coin.png")} style={styles.cardRewardCoin} resizeMode="contain" />
                        <Text style={styles.cardRewardText}>+{task.coins_reward}</Text>
                      </View>
                    </View>
                    {showProgressBar && (
                      <View style={styles.progressWrap}>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                        </View>
                        <Text style={[styles.progressLabel, { color: colors.subText }]}>{task.current_count}/{task.target_count}</Text>
                      </View>
                    )}
                    <TouchableOpacity
                      disabled={action.variant === "disabled" || claimingId === task.id}
                      onPress={action.onPress}
                      activeOpacity={0.9}
                      style={styles.actionBtnWrap}
                      accessibilityRole="button"
                      accessibilityLabel={`${action.label} — ${task.title}`}
                    >
                      {action.variant === "primary" ? (
                        <LinearGradient colors={ACCENT as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.actionBtn}>
                          {claimingId === task.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnPrimaryText}>{action.label}</Text>}
                        </LinearGradient>
                      ) : action.variant === "disabled" ? (
                        <View style={[styles.actionBtn, styles.actionBtnDisabled]}>
                          <Text style={[styles.actionBtnSecondaryText, { color: colors.subText }]}>{action.label}</Text>
                        </View>
                      ) : (
                        <View style={[styles.actionBtn, styles.actionBtnSecondary, { borderColor: ACCENT[1] }]}>
                          <Text style={[styles.actionBtnSecondaryText, { color: ACCENT[1] }]}>{action.label}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}

          {/* ── Achievements ────────────────────────────────────────────── */}
          {data?.achievements && data.achievements.length > 0 && (() => {
            // Sort: newly-unlocked first, then in-progress (highest % first),
            // then not-started. Gives users a clear "you're close!" signal.
            const sorted = [...data.achievements].sort((a, b) => {
              if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
              if (!a.unlocked && !b.unlocked) return b.progress_pct - a.progress_pct;
              return (b.unlocked_at ?? 0) - (a.unlocked_at ?? 0);
            });
            const unlocked = data.achievements.filter((a) => a.unlocked).length;
            const total = data.achievements.length;
            const totalEarnedFromAch = data.achievements
              .filter((a) => a.unlocked)
              .reduce((s, a) => s + a.coins_reward, 0);

            return (
              <View style={styles.section}>
                {/* Header + summary strip */}
                <View style={styles.achHeaderRow}>
                  <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Achievements</Text>
                  <Text style={[styles.achHeaderMeta, { color: colors.subText }]}>
                    {unlocked}/{total} unlocked  ·  +{totalEarnedFromAch.toLocaleString()} coins earned
                  </Text>
                </View>

                {/* 2-column grid — each card shows icon, title, progress bar, reward */}
                <View style={styles.achGrid}>
                  {sorted.map((a) => {
                    const tierColor = TIER_COLORS[a.tier] ?? "#F59E0B";
                    return (
                      <View
                        key={a.id}
                        style={[
                          styles.achCardV2,
                          { backgroundColor: colors.card, borderColor: a.unlocked ? tierColor : colors.border },
                          a.unlocked && styles.achCardV2Unlocked,
                        ]}
                      >
                        <View style={styles.achTopRow}>
                          <View style={[styles.achIconBox, { backgroundColor: tierColor + "22" }]}>
                            <Text style={[styles.achIconEmoji, !a.unlocked && styles.achIconLocked]}>
                              {ICON_EMOJI[a.icon] ?? "🏆"}
                            </Text>
                          </View>
                          <View style={[styles.achTierPill, { backgroundColor: tierColor }]}>
                            <Text style={styles.achTierText}>{a.tier.toUpperCase()}</Text>
                          </View>
                        </View>

                        <Text style={[styles.achTitleV2, { color: colors.text }]} numberOfLines={2}>{a.title}</Text>
                        <Text style={[styles.achDescV2, { color: colors.subText }]} numberOfLines={2}>{a.description}</Text>

                        {/* Duration chip — only for time-bound quests that
                            have been started AND aren't yet unlocked. Live-
                            ticks against `serverOffsetMs` so the countdown
                            is accurate even if the device clock drifts. */}
                        {!a.unlocked && a.duration_days > 0 && a.started_at != null && (() => {
                          const remainingSec = Math.max(0, (a.expires_at ?? 0) - now);
                          const days = Math.floor(remainingSec / 86400);
                          const hours = Math.floor((remainingSec % 86400) / 3600);
                          const label = remainingSec === 0
                            ? "⏱ Expired · resets on next progress"
                            : days > 0
                              ? `⏱ ${days}d ${hours}h left`
                              : `⏱ ${hours}h left`;
                          const isUrgent = remainingSec > 0 && remainingSec < 86400;
                          return (
                            <View style={[styles.achDurationChip, isUrgent && styles.achDurationChipUrgent]}>
                              <Text style={[styles.achDurationText, isUrgent && styles.achDurationTextUrgent]}>{label}</Text>
                            </View>
                          );
                        })()}
                        {/* Duration hint for NOT-YET-STARTED time-bound quests. */}
                        {!a.unlocked && a.duration_days > 0 && a.started_at == null && (
                          <View style={styles.achDurationChip}>
                            <Text style={styles.achDurationText}>⏱ {a.duration_days}-day quest — starts on first progress</Text>
                          </View>
                        )}

                        {/* Progress row — full bar for unlocked, live bar for in-progress. */}
                        <View style={styles.achProgressRow}>
                          <View style={styles.achProgressTrack}>
                            <View
                              style={[
                                styles.achProgressFill,
                                { width: `${a.unlocked ? 100 : a.progress_pct}%`, backgroundColor: tierColor },
                              ]}
                            />
                          </View>
                          <Text style={[styles.achProgressLabel, { color: colors.subText }]}>
                            {a.unlocked
                              ? "✓ Complete"
                              : `${a.current_progress.toLocaleString()} / ${a.trigger_threshold.toLocaleString()}`}
                          </Text>
                        </View>

                        {/* Reward chip — gold when unlocked, muted when still locked. */}
                        <View style={styles.achRewardRow}>
                          <View style={[styles.achRewardChip, a.unlocked ? styles.achRewardChipUnlocked : styles.achRewardChipLocked]}>
                            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.achRewardCoin} resizeMode="contain" />
                            <Text style={[styles.achRewardText, !a.unlocked && { color: colors.subText }]}>
                              +{a.coins_reward}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })()}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    paddingHorizontal: 16, paddingBottom: 20,
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerBackBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  headerBackText: { color: "#fff", fontSize: 26, marginTop: -3 },
  headerTitle: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold" },
  summaryRow: { flexDirection: "row", gap: 8 },
  summaryCard: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
  },
  summaryLabel: { color: "rgba(255,255,255,0.9)", fontSize: 10.5, fontFamily: "Poppins_500Medium" },
  summaryValueRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  summaryCoinIcon: { width: 15, height: 15 },
  summaryValue: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold" },

  section: { paddingHorizontal: 14, paddingTop: 18 },
  sectionTitle: { fontSize: 15, fontFamily: "Poppins_700Bold", marginBottom: 10 },

  // Campaign banner
  campaignCardWrap: { marginBottom: 10, borderRadius: 16, overflow: "hidden", ...Platform.select({ ios: { shadowColor: "#3B82F6", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, android: { elevation: 3 }, web: { boxShadow: "0 3px 10px rgba(59,130,246,0.25)" } as any }) },
  campaignCard: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  campaignBadge: { alignSelf: "flex-start", backgroundColor: "#FFB800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginBottom: 6 },
  campaignBadgeText: { color: "#5A2B00", fontSize: 10, fontFamily: "Poppins_700Bold", letterSpacing: 0.5 },
  campaignTitle: { color: "#fff", fontSize: 15, fontFamily: "Poppins_700Bold" },
  campaignDesc: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  campaignCountdown: { color: "#FDF3C4", fontSize: 11, fontFamily: "Poppins_600SemiBold", marginTop: 4 },
  campaignEmoji: { fontSize: 34 },

  // Spin card
  spinCardWrap: { borderRadius: 16, overflow: "hidden", ...Platform.select({ ios: { shadowColor: "#EF4444", shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 }, web: { boxShadow: "0 4px 12px rgba(239,68,68,0.3)" } as any }) },
  spinCard: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  spinCardKicker: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontFamily: "Poppins_600SemiBold", letterSpacing: 1 },
  spinCardTitle: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold", marginTop: 2 },
  spinCardSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  spinCardEmoji: { fontSize: 42 },

  // Coupon row
  couponRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, borderWidth: 1, overflow: "hidden",
  },
  couponInput: { flex: 1, height: 46, paddingHorizontal: 14, fontSize: 14, fontFamily: "Poppins_500Medium", letterSpacing: 1, ...(WEB_INPUT_RESET as any) },
  couponBtnWrap: { padding: 4 },
  couponBtn: { paddingHorizontal: 18, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  couponBtnText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold" },

  // Task card
  card: {
    borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1,
    ...Platform.select({ ios: { shadowColor: "#0B1A2B", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 1 }, web: { boxShadow: "0 1px 4px rgba(11,26,43,0.06)" } as any }),
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(198,75,232,0.12)", alignItems: "center", justifyContent: "center" },
  cardIconEmoji: { fontSize: 24 },
  cardTitleCol: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  cardDesc: { fontSize: 11.5, fontFamily: "Poppins_400Regular", marginTop: 2, lineHeight: 15 },
  cardRewardCol: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FFB800", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  cardRewardCoin: { width: 13, height: 13 },
  cardRewardText: { color: "#5A2B00", fontSize: 12, fontFamily: "Poppins_700Bold" },

  progressWrap: { marginTop: 10, marginBottom: 4 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(198,75,232,0.15)", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#C64BE8", borderRadius: 3 },
  progressLabel: { fontSize: 10.5, fontFamily: "Poppins_500Medium", marginTop: 4, textAlign: "right" },

  actionBtnWrap: { marginTop: 10, borderRadius: 12, overflow: "hidden" },
  actionBtn: { height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  actionBtnPrimaryText: { color: "#fff", fontSize: 13.5, fontFamily: "Poppins_700Bold" },
  actionBtnSecondary: { backgroundColor: "transparent", borderWidth: 1.5 },
  actionBtnDisabled: { backgroundColor: "rgba(148,163,184,0.15)" },
  actionBtnSecondaryText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },

  // Achievements — header + 2-column grid
  achHeaderRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    flexWrap: "wrap", marginBottom: 10, gap: 6,
  },
  achHeaderMeta: { fontSize: 11.5, fontFamily: "Poppins_500Medium" },

  achGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  achCardV2: {
    // 2 columns → each card width = (containerWidth - gap) / 2. Using `48%`
    // avoids computing at runtime — RN honours percentages on flex children.
    width: "48%",
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 12,
    gap: 6,
    ...Platform.select({
      ios: { shadowColor: "#0B1A2B", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
      android: { elevation: 1 },
      web: { boxShadow: "0 1px 3px rgba(11,26,43,0.05)" } as any,
    }),
  },
  achCardV2Unlocked: {
    // A subtle glow around unlocked cards to celebrate the tier colour.
    ...Platform.select({
      ios: { shadowColor: "#F59E0B", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
      web: { boxShadow: "0 2px 6px rgba(245,158,11,0.25)" } as any,
    }),
  },
  achTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  achIconBox: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  achIconEmoji: { fontSize: 22 },
  achIconLocked: { opacity: 0.35 },       // grayscale-ish effect for locked
  achTierPill: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 7 },
  achTierText: { color: "#fff", fontSize: 9, fontFamily: "Poppins_700Bold", letterSpacing: 0.6 },

  achTitleV2: { fontSize: 13, fontFamily: "Poppins_700Bold" },
  achDescV2: { fontSize: 11, fontFamily: "Poppins_400Regular", lineHeight: 14, minHeight: 28 },

  achDurationChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(59,130,246,0.12)",
    marginTop: 2,
  },
  achDurationChipUrgent: { backgroundColor: "rgba(239,68,68,0.14)" },
  achDurationText: { fontSize: 10, fontFamily: "Poppins_600SemiBold", color: "#2563EB" },
  achDurationTextUrgent: { color: "#DC2626" },

  achProgressRow: { marginTop: 4, gap: 4 },
  achProgressTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(148,163,184,0.2)", overflow: "hidden" },
  achProgressFill: { height: "100%", borderRadius: 3 },
  achProgressLabel: { fontSize: 10, fontFamily: "Poppins_600SemiBold" },

  achRewardRow: { flexDirection: "row" },
  achRewardChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12,
  },
  achRewardChipUnlocked: { backgroundColor: "#FFB800" },
  achRewardChipLocked: { backgroundColor: "rgba(148,163,184,0.18)" },
  achRewardCoin: { width: 12, height: 12 },
  achRewardText: { color: "#5A2B00", fontSize: 11, fontFamily: "Poppins_700Bold" },

  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
});

export { ErrorBoundary } from "@/components/RouteErrorBoundary";
