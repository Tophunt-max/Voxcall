import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
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
import MonthlyPassCard from "@/components/MonthlyPassCard";

// ─────────────────────────────────────────────────────────────────────────────
// Tasks & Rewards — Chamet-style two-tab surface.
// ─────────────────────────────────────────────────────────────────────────────
//   • "Tasks" tab: daily check-in, Daily Tasks (with a resets-at-midnight
//     countdown), Monthly Tasks (with a resets-at-month-end countdown) and the
//     Monthly Pass entry (Common + VIP tracks).
//   • "Rewards" tab: limited-time campaigns, Lucky Spin, coupon redemption,
//     the remaining one-time / ongoing tasks, and Achievements.
//
// Shares the same GET /api/user/rewards payload as the classic Rewards Hub
// (app/user/rewards.tsx) — this screen just re-organises it to match the
// Chamet layout and layers the Monthly Pass on top.

const ACCENT = ["#C64BE8", "#8A2BD8"] as const;
const HEADER_BG = ["#7C3AED", "#4F46E5"] as const;
const SPIN_BG = ["#F59E0B", "#EF4444"] as const;
const CAMPAIGN_BG = ["#3B82F6", "#8B5CF6"] as const;
const CHECKIN_BG = ["#10B981", "#059669"] as const;

const ICON_EMOJI: Record<string, string> = {
  calendar: "📅", call: "📞", invite: "🎁", coin: "🪙",
  video: "📺", share: "🔗", gift: "🎁", trophy: "🏆", flame: "🔥",
};

const TIER_COLORS: Record<string, string> = {
  bronze: "#B87333", silver: "#94A3B8", gold: "#F59E0B", platinum: "#8B5CF6",
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

// HH:MM:SS clock (used for the daily-reset countdown).
function formatClock(sec: number): string {
  if (sec <= 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// "Xd HH:MM:SS" (used for the monthly-reset countdown).
function formatDaysClock(sec: number): string {
  if (sec <= 0) return "0d 00:00:00";
  const days = Math.floor(sec / 86400);
  const rest = sec % 86400;
  return `${days}d ${formatClock(rest)}`;
}

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateCoins } = useAuth();

  const [tab, setTab] = useState<"tasks" | "rewards">("tasks");
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
      showErrorToast(e?.message ?? "Could not load tasks");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useSocketEvent(
    SocketEvents.DATA_CHANGED,
    (d: any) => { if (d?.resource === "rewards") load(); },
    [load]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Live tick for cooldown / campaign / cycle countdowns.
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
        claimable: remaining === 0 && !t.vip_locked && (t.task_type === "daily_checkin" || t.current_count >= t.target_count),
      };
    });
  }, [data, now]);

  const checkinTask = useMemo(
    () => liveTasks.find((t) => t.task_type === "daily_checkin") ?? null,
    [liveTasks]
  );
  const dailyTasks = useMemo(
    () => liveTasks.filter((t) => t.category === "daily" && t.task_type !== "daily_checkin"),
    [liveTasks]
  );
  const monthlyTasks = useMemo(
    () => liveTasks.filter((t) => t.category === "monthly"),
    [liveTasks]
  );
  const otherTasks = useMemo(
    () => liveTasks.filter((t) => t.category === "one_time" || t.category === "ongoing"),
    [liveTasks]
  );

  const activeCampaigns: Campaign[] = useMemo(() => {
    if (!data) return [];
    return data.campaigns.map((c) => ({ ...c, ends_in_sec: Math.max(0, c.ends_at - now) })).filter((c) => c.ends_in_sec > 0);
  }, [data, now]);

  const dailyResetSec = data ? Math.max(0, data.daily_reset - now) : 0;
  const monthEndSec = data ? Math.max(0, data.month_end - now) : 0;

  const countDone = (list: RewardTask[]) => list.filter((t) => t.already_claimed).length;

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
      showErrorToast(e?.message ?? "Could not redeem coupon");
    } finally {
      setRedeemingCoupon(false);
    }
  }, [couponCode, redeemingCoupon, updateCoins, load]);

  const primaryAction = (task: RewardTask): { label: string; onPress: () => void; variant: "primary" | "secondary" | "disabled" | "vip" } => {
    // VIP-only task shown to a free user → locked upsell CTA.
    if (task.vip_locked) return { label: "🔒 Unlock with VIP", onPress: () => router.push("/user/vip" as any), variant: "vip" };
    if (task.claimable) return { label: `Claim +${task.coins_reward}`, onPress: () => claim(task), variant: "primary" };
    if (task.already_claimed) {
      const cooldownLabel = task.cooldown_hours > 0 && task.cooldown_remaining_sec > 0
        ? `Next in ${formatCooldown(task.cooldown_remaining_sec)}`
        : task.category === "monthly" ? "Claimed this month" : "Claimed";
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

  // ── Reusable task card renderer ────────────────────────────────────────────
  const renderTaskCard = (task: RewardTask) => {
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
            <View style={styles.cardTitleRow}>
              <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{task.title}</Text>
              {task.audience === "vip" ? (
                <View style={styles.vipTag}>
                  <Text style={styles.vipTagText}>👑 VIP</Text>
                </View>
              ) : null}
            </View>
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
          ) : action.variant === "vip" ? (
            <LinearGradient colors={["#F59E0B", "#D97706"] as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.actionBtn}>
              <Text style={styles.actionBtnPrimaryText}>{action.label}</Text>
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
  };

  const sectionHeader = (title: string, done: number, total: number, countdown: string, countdownLabel: string) => (
    <View style={styles.sectionHeaderRow}>
      <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
        {title} <Text style={{ color: colors.subText }}>({done}/{total})</Text>
      </Text>
      {total > 0 && countdown ? (
        <View style={styles.countdownPill}>
          <Text style={styles.countdownPillText}>{countdownLabel} {countdown}</Text>
        </View>
      ) : null}
    </View>
  );

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
          <Text style={styles.headerTitle}>Tasks & Rewards</Text>
          <View style={styles.coinPill}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinPillIcon} resizeMode="contain" />
            <Text style={styles.coinPillText}>{user?.coins?.toLocaleString() ?? 0}</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          {(["tasks", "rewards"] as const).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} activeOpacity={0.85} style={[styles.tabBtn, tab === t && styles.tabBtnActive]}>
              <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>{t === "tasks" ? "Tasks" : "Rewards"}</Text>
            </TouchableOpacity>
          ))}
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
          {tab === "tasks" ? (
            <>
              {/* ── Monthly Pass entry ─────────────────────────────────── */}
              <View style={styles.section}>
                <MonthlyPassCard onChanged={load} />
              </View>

              {/* ── Daily Check-in ─────────────────────────────────────── */}
              {checkinTask && (
                <View style={styles.section}>
                  <TouchableOpacity
                    activeOpacity={checkinTask.claimable ? 0.9 : 1}
                    disabled={!checkinTask.claimable || claimingId === checkinTask.id}
                    onPress={() => claim(checkinTask)}
                    style={styles.checkinWrap}
                  >
                    <LinearGradient colors={CHECKIN_BG as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.checkinCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.checkinKicker}>DAILY CHECK-IN</Text>
                        <Text style={styles.checkinTitle}>
                          {checkinTask.claimable ? `Check in & get +${checkinTask.coins_reward}` : checkinTask.already_claimed ? "Checked in today ✓" : checkinTask.title}
                        </Text>
                        {checkinTask.already_claimed && checkinTask.cooldown_remaining_sec > 0 ? (
                          <Text style={styles.checkinSub}>Come back in {formatCooldown(checkinTask.cooldown_remaining_sec)}</Text>
                        ) : (
                          <Text style={styles.checkinSub}>Open the app daily to keep earning</Text>
                        )}
                      </View>
                      <View style={styles.checkinBtn}>
                        {claimingId === checkinTask.id ? (
                          <ActivityIndicator color="#059669" />
                        ) : (
                          <Text style={styles.checkinBtnText}>{checkinTask.claimable ? "Check in" : "✓"}</Text>
                        )}
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Daily Tasks ────────────────────────────────────────── */}
              {dailyTasks.length > 0 && (
                <View style={styles.section}>
                  {sectionHeader("Daily Tasks", countDone(dailyTasks), dailyTasks.length, formatClock(dailyResetSec), "Resets in")}
                  <View style={{ height: 10 }} />
                  {dailyTasks.map(renderTaskCard)}
                </View>
              )}

              {/* ── Monthly Tasks ──────────────────────────────────────── */}
              {monthlyTasks.length > 0 && (
                <View style={styles.section}>
                  {sectionHeader("Monthly Tasks", countDone(monthlyTasks), monthlyTasks.length, formatDaysClock(monthEndSec), "Ends in")}
                  <View style={{ height: 10 }} />
                  {monthlyTasks.map(renderTaskCard)}
                </View>
              )}

              {dailyTasks.length === 0 && monthlyTasks.length === 0 && !checkinTask && (
                <View style={styles.emptyWrap}>
                  <Text style={[styles.emptyText, { color: colors.subText }]}>No tasks available right now. Check back soon!</Text>
                </View>
              )}
            </>
          ) : (
            <>
              {/* ── Active campaign banners (FOMO) ─────────────────────── */}
              {activeCampaigns.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>🔥 Limited time</Text>
                  {activeCampaigns.map((c) => (
                    <View key={c.id} style={styles.campaignCardWrap}>
                      <LinearGradient colors={CAMPAIGN_BG as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.campaignCard}>
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

              {/* ── Lucky Spin entry card ──────────────────────────────── */}
              {data?.spin?.enabled && (
                <View style={styles.section}>
                  <TouchableOpacity onPress={() => router.push("/user/rewards-spin" as any)} activeOpacity={0.9} style={styles.spinCardWrap}>
                    <LinearGradient colors={SPIN_BG as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.spinCard}>
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

              {/* ── Coupon redeem row ──────────────────────────────────── */}
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
                  <TouchableOpacity onPress={redeemCoupon} disabled={!couponCode.trim() || redeemingCoupon} activeOpacity={0.85} style={styles.couponBtnWrap}>
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

              {/* ── Other tasks (one-time / ongoing) ───────────────────── */}
              {otherTasks.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Bonus Tasks</Text>
                  {otherTasks.map(renderTaskCard)}
                </View>
              )}

              {/* ── Achievements ───────────────────────────────────────── */}
              {data?.achievements && data.achievements.length > 0 && (() => {
                const sorted = [...data.achievements].sort((a, b) => {
                  if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
                  if (!a.unlocked && !b.unlocked) return b.progress_pct - a.progress_pct;
                  return (b.unlocked_at ?? 0) - (a.unlocked_at ?? 0);
                });
                const unlocked = data.achievements.filter((a) => a.unlocked).length;
                const total = data.achievements.length;
                return (
                  <View style={styles.section}>
                    <View style={styles.achHeaderRow}>
                      <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Achievements</Text>
                      <Text style={[styles.achHeaderMeta, { color: colors.subText }]}>{unlocked}/{total} unlocked</Text>
                    </View>
                    <View style={styles.achGrid}>
                      {sorted.map((a) => {
                        const tierColor = TIER_COLORS[a.tier] ?? "#F59E0B";
                        return (
                          <View key={a.id} style={[styles.achCardV2, { backgroundColor: colors.card, borderColor: a.unlocked ? tierColor : colors.border }, a.unlocked && styles.achCardV2Unlocked]}>
                            <View style={styles.achTopRow}>
                              <View style={[styles.achIconBox, { backgroundColor: tierColor + "22" }]}>
                                <Text style={[styles.achIconEmoji, !a.unlocked && styles.achIconLocked]}>{ICON_EMOJI[a.icon] ?? "🏆"}</Text>
                              </View>
                              <View style={[styles.achTierPill, { backgroundColor: tierColor }]}>
                                <Text style={styles.achTierText}>{a.tier.toUpperCase()}</Text>
                              </View>
                            </View>
                            <Text style={[styles.achTitleV2, { color: colors.text }]} numberOfLines={2}>{a.title}</Text>
                            <Text style={[styles.achDescV2, { color: colors.subText }]} numberOfLines={2}>{a.description}</Text>
                            <View style={styles.achProgressRow}>
                              <View style={styles.achProgressTrack}>
                                <View style={[styles.achProgressFill, { width: `${a.unlocked ? 100 : a.progress_pct}%`, backgroundColor: tierColor }]} />
                              </View>
                              <Text style={[styles.achProgressLabel, { color: colors.subText }]}>
                                {a.unlocked ? "✓ Complete" : `${a.current_progress.toLocaleString()} / ${a.trigger_threshold.toLocaleString()}`}
                              </Text>
                            </View>
                            <View style={styles.achRewardRow}>
                              <View style={[styles.achRewardChip, a.unlocked ? styles.achRewardChipUnlocked : styles.achRewardChipLocked]}>
                                <Image source={require("@/assets/icons/ic_coin.png")} style={styles.achRewardCoin} resizeMode="contain" />
                                <Text style={[styles.achRewardText, !a.unlocked && { color: colors.subText }]}>+{a.coins_reward}</Text>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })()}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerBackBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  headerBackText: { color: "#fff", fontSize: 26, marginTop: -3 },
  headerTitle: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold" },
  coinPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  coinPillIcon: { width: 15, height: 15 },
  coinPillText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold" },

  tabsRow: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 4, gap: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  tabBtnActive: { backgroundColor: "#fff" },
  tabBtnText: { color: "rgba(255,255,255,0.9)", fontSize: 13.5, fontFamily: "Poppins_600SemiBold" },
  tabBtnTextActive: { color: "#4F46E5" },

  section: { paddingHorizontal: 14, paddingTop: 18 },
  sectionTitle: { fontSize: 15, fontFamily: "Poppins_700Bold", marginBottom: 10 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 },
  countdownPill: { backgroundColor: "rgba(124,58,237,0.12)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  countdownPillText: { color: "#7C3AED", fontSize: 11.5, fontFamily: "Poppins_600SemiBold" },

  emptyWrap: { padding: 40, alignItems: "center" },
  emptyText: { fontSize: 13, fontFamily: "Poppins_500Medium", textAlign: "center" },

  // Check-in card
  checkinWrap: { borderRadius: 16, overflow: "hidden", ...Platform.select({ ios: { shadowColor: "#059669", shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 }, web: { boxShadow: "0 4px 12px rgba(5,150,105,0.3)" } as any }) },
  checkinCard: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  checkinKicker: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontFamily: "Poppins_600SemiBold", letterSpacing: 1 },
  checkinTitle: { color: "#fff", fontSize: 17, fontFamily: "Poppins_700Bold", marginTop: 2 },
  checkinSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  checkinBtn: { backgroundColor: "#fff", paddingHorizontal: 16, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", minWidth: 64 },
  checkinBtnText: { color: "#059669", fontSize: 14, fontFamily: "Poppins_700Bold" },

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
  couponRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  couponInput: { flex: 1, height: 46, paddingHorizontal: 14, fontSize: 14, fontFamily: "Poppins_500Medium", letterSpacing: 1, ...(WEB_INPUT_RESET as any) },
  couponBtnWrap: { padding: 4 },
  couponBtn: { paddingHorizontal: 18, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  couponBtnText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold" },

  // Task card
  card: { borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1, ...Platform.select({ ios: { shadowColor: "#0B1A2B", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 1 }, web: { boxShadow: "0 1px 4px rgba(11,26,43,0.06)" } as any }) },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(198,75,232,0.12)", alignItems: "center", justifyContent: "center" },
  cardIconEmoji: { fontSize: 24 },
  cardTitleCol: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  cardTitle: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  vipTag: { backgroundColor: "#FEF3C7", borderColor: "#F59E0B", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  vipTagText: { color: "#B45309", fontSize: 9.5, fontFamily: "Poppins_700Bold" },
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

  // Achievements
  achHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 10, gap: 6 },
  achHeaderMeta: { fontSize: 11.5, fontFamily: "Poppins_500Medium" },
  achGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  achCardV2: { width: "48%", borderRadius: 14, borderWidth: 1.5, padding: 12, gap: 6, ...Platform.select({ ios: { shadowColor: "#0B1A2B", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }, android: { elevation: 1 }, web: { boxShadow: "0 1px 3px rgba(11,26,43,0.05)" } as any }) },
  achCardV2Unlocked: { ...Platform.select({ ios: { shadowColor: "#F59E0B", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 2 }, web: { boxShadow: "0 2px 6px rgba(245,158,11,0.25)" } as any }) },
  achTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  achIconBox: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  achIconEmoji: { fontSize: 22 },
  achIconLocked: { opacity: 0.35 },
  achTierPill: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 7 },
  achTierText: { color: "#fff", fontSize: 9, fontFamily: "Poppins_700Bold", letterSpacing: 0.6 },
  achTitleV2: { fontSize: 13, fontFamily: "Poppins_700Bold" },
  achDescV2: { fontSize: 11, fontFamily: "Poppins_400Regular", lineHeight: 14, minHeight: 28 },
  achProgressRow: { marginTop: 4, gap: 4 },
  achProgressTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(148,163,184,0.2)", overflow: "hidden" },
  achProgressFill: { height: "100%", borderRadius: 3 },
  achProgressLabel: { fontSize: 10, fontFamily: "Poppins_600SemiBold" },
  achRewardRow: { flexDirection: "row" },
  achRewardChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  achRewardChipUnlocked: { backgroundColor: "#FFB800" },
  achRewardChipLocked: { backgroundColor: "rgba(148,163,184,0.18)" },
  achRewardCoin: { width: 12, height: 12 },
  achRewardText: { color: "#5A2B00", fontSize: 11, fontFamily: "Poppins_700Bold" },

  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
});

export { ErrorBoundary } from "@/components/RouteErrorBoundary";
