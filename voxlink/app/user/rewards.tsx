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
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

// ─────────────────────────────────────────────────────────────────────────────
// Rewards Hub
// ─────────────────────────────────────────────────────────────────────────────
// A user-facing page listing every active reward task with its progress and
// claim button. Data comes from GET /api/user/rewards; claims are POST'd to
// /api/user/rewards/claim; ad / share events are POST'd to /track.
//
// Design goals:
//   • Show what's *claimable right now* first — that's why we group by
//     `claimable → progress → cooldown` on top of the admin sort_order.
//   • Every claim updates the user's coin balance locally (updateCoins) and
//     re-fetches the task list so cooldowns tick correctly.
//   • Client-driven events (watch_ad, share_app) call trackReward before
//     re-fetching, so if the user completes and claims in one gesture the
//     backend already reflects the increment.

const ACCENT = ["#C64BE8", "#8A2BD8"] as const;
const HEADER_BG = ["#FFB800", "#FF6A00"] as const; // gold → orange (celebration)

// Semantic icon mapping — the backend stores a short `icon` code and the
// client renders whatever visual it wants. Emoji is a portable fallback that
// works on every platform without asset registration.
const ICON_EMOJI: Record<string, string> = {
  calendar: "📅",
  call: "📞",
  invite: "🎁",
  coin: "🪙",
  video: "📺",
  share: "🔗",
  gift: "🎁",
};

type RewardTask = Awaited<ReturnType<typeof API.getRewards>>["tasks"][number];

// Format a seconds duration to "5h 42m" / "3m 12s" / "12s".
function formatCooldown(sec: number): string {
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Human-readable category label + ordering weight.
const CATEGORY_META: Record<string, { label: string; order: number }> = {
  daily: { label: "Daily Tasks", order: 1 },
  one_time: { label: "One-Time Bonuses", order: 2 },
  ongoing: { label: "Ongoing Rewards", order: 3 },
};

export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateCoins } = useAuth();

  const [tasks, setTasks] = useState<RewardTask[]>([]);
  const [totalEarned, setTotalEarned] = useState(0);
  const [claimableCount, setClaimableCount] = useState(0);
  const [serverOffsetMs, setServerOffsetMs] = useState(0); // client_now - server_now
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await API.getRewards();
      setTasks(res.tasks);
      setTotalEarned(res.total_earned);
      setClaimableCount(res.claimable_count);
      // Server clock offset — used to keep the cooldown countdown accurate
      // even if the device clock is skewed.
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

  // Live-tick every 1s so daily-task cooldowns count down visibly. Only mounts
  // a timer when the screen is on-screen (component mounted) — the interval
  // is fully released on unmount.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Compute derived "live" state (cooldown countdown) from server-provided
  // absolute time (`last_claimed_at` + cooldown seconds), corrected by the
  // server clock offset captured at load time.
  const now = Math.floor((Date.now() - serverOffsetMs) / 1000);

  const liveTasks = useMemo(() => {
    return tasks.map((t) => {
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
  }, [tasks, now]);

  const grouped = useMemo(() => {
    // Sort claimable-first inside each category, then by admin sort order.
    const groups: Record<string, RewardTask[]> = {};
    for (const t of liveTasks) {
      const cat = t.category in CATEGORY_META ? t.category : "ongoing";
      (groups[cat] ||= []).push(t);
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => {
        // Claimable first
        if (a.claimable !== b.claimable) return a.claimable ? -1 : 1;
        // Then still-cooling-down / in-progress before one-time-completed
        if (a.already_claimed !== b.already_claimed) return a.already_claimed ? 1 : -1;
        return 0;
      });
    }
    return Object.keys(groups)
      .sort((a, b) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99))
      .map((cat) => ({ cat, label: CATEGORY_META[cat]?.label ?? cat, tasks: groups[cat] }));
  }, [liveTasks]);

  const claim = useCallback(
    async (task: RewardTask) => {
      if (!task.claimable || claimingId) return;
      setClaimingId(task.id);
      try {
        const res = await API.claimReward(task.id);
        updateCoins(res.new_balance);
        showSuccessToast(`+${res.coins_awarded} coins!`, "Reward claimed");
        await load();
      } catch (e: any) {
        showErrorToast(e?.message ?? "Could not claim reward");
      } finally {
        setClaimingId(null);
      }
    },
    [claimingId, updateCoins, load],
  );

  // Client-driven event: sharing the app. On successful share we tell the
  // backend to bump the share_app task; the next `load()` will show it as
  // claimable if the target is met.
  const shareApp = useCallback(
    async (task: RewardTask) => {
      try {
        await Share.share({
          message: "Come chat on VoxCall! https://voxcall.pages.dev",
        });
        try {
          await API.trackReward("share_app");
        } catch {
          /* non-fatal: analytics only */
        }
        await load();
        // If the user shared AND task is now claimable, auto-claim for a
        // frictionless flow. If it's not (e.g. multi-share task), just refresh.
        // Re-read the freshest task state:
        const fresh = await API.getRewards();
        const updated = fresh.tasks.find((t) => t.id === task.id);
        if (updated?.claimable) await claim(updated);
        else {
          setTasks(fresh.tasks);
          setClaimableCount(fresh.claimable_count);
          setTotalEarned(fresh.total_earned);
        }
      } catch (e: any) {
        showErrorToast(e?.message ?? "Could not share");
      }
    },
    [claim, load],
  );

  // Client-driven event: watch_ad. Simulated here (production would call an
  // AdMob / IronSource rewarded ad SDK; the reward payload is only granted
  // AFTER the SDK's `onRewarded` callback fires successfully).
  const watchAd = useCallback(
    async (task: RewardTask) => {
      // TODO: replace with real rewarded-ad SDK integration.
      // For now, we mark it as done and refresh so admins can validate the
      // task flow end-to-end without ad SDK setup.
      try {
        await API.trackReward("watch_ad");
        const fresh = await API.getRewards();
        const updated = fresh.tasks.find((t) => t.id === task.id);
        if (updated?.claimable) await claim(updated);
        else {
          setTasks(fresh.tasks);
          setClaimableCount(fresh.claimable_count);
          setTotalEarned(fresh.total_earned);
        }
      } catch (e: any) {
        showErrorToast(e?.message ?? "Could not track ad");
      }
    },
    [claim],
  );

  const primaryAction = (task: RewardTask): { label: string; onPress: () => void; variant: "primary" | "secondary" | "disabled" } => {
    if (task.claimable) {
      return { label: `Claim +${task.coins_reward}`, onPress: () => claim(task), variant: "primary" };
    }
    if (task.already_claimed) {
      const cooldownLabel = task.cooldown_hours > 0 && task.cooldown_remaining_sec > 0
        ? `Next in ${formatCooldown(task.cooldown_remaining_sec)}`
        : "Claimed";
      return { label: cooldownLabel, onPress: () => {}, variant: "disabled" };
    }
    // Task in progress → offer action / deep link.
    switch (task.task_type) {
      case "complete_calls":
        return { label: "Start a call", onPress: () => router.push("/user/screens/home/search" as any), variant: "secondary" };
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

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <LinearGradient
        colors={HEADER_BG as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBackBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
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
            <View style={styles.summaryValueRow}>
              <Text style={styles.summaryValue}>{totalEarned.toLocaleString()}</Text>
            </View>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Ready to claim</Text>
            <View style={styles.summaryValueRow}>
              <Text style={styles.summaryValue}>{claimableCount}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={ACCENT[1]} />
        </View>
      ) : liveTasks.length === 0 ? (
        <View style={styles.centerWrap}>
          <Text style={styles.emptyEmoji}>🎁</Text>
          <Text style={[styles.emptyText, { color: colors.text }]}>No rewards available yet</Text>
          <Text style={[styles.emptySub, { color: colors.subText }]}>Check back later — new tasks arrive often.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT[1]} />}
          showsVerticalScrollIndicator={false}
        >
          {grouped.map((group) => (
            <View key={group.cat} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{group.label}</Text>
              {group.tasks.map((task) => {
                const action = primaryAction(task);
                const progressPct = task.target_count > 0
                  ? Math.min(100, Math.round((task.current_count / task.target_count) * 100))
                  : 0;
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
                        <Text style={[styles.progressLabel, { color: colors.subText }]}>
                          {task.current_count}/{task.target_count}
                        </Text>
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
                          {claimingId === task.id ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.actionBtnPrimaryText}>{action.label}</Text>
                          )}
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
        </ScrollView>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerBackBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  headerBackText: { color: "#fff", fontSize: 26, marginTop: -3 },
  headerTitle: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold" },

  summaryRow: { flexDirection: "row", gap: 8 },
  summaryCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  summaryLabel: { color: "rgba(255,255,255,0.9)", fontSize: 10.5, fontFamily: "Poppins_500Medium" },
  summaryValueRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  summaryCoinIcon: { width: 15, height: 15 },
  summaryValue: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold" },

  // Section
  section: { paddingHorizontal: 14, paddingTop: 18 },
  sectionTitle: { fontSize: 15, fontFamily: "Poppins_700Bold", marginBottom: 10 },

  // Card
  card: {
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    ...Platform.select({
      ios: { shadowColor: "#0B1A2B", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      web: { boxShadow: "0 1px 4px rgba(11,26,43,0.06)" } as any,
    }),
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIconBox: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(198,75,232,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  cardIconEmoji: { fontSize: 24 },
  cardTitleCol: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  cardDesc: { fontSize: 11.5, fontFamily: "Poppins_400Regular", marginTop: 2, lineHeight: 15 },
  cardRewardCol: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FFB800", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  cardRewardCoin: { width: 13, height: 13 },
  cardRewardText: { color: "#5A2B00", fontSize: 12, fontFamily: "Poppins_700Bold" },

  // Progress bar
  progressWrap: { marginTop: 10, marginBottom: 4 },
  progressTrack: {
    height: 6, borderRadius: 3,
    backgroundColor: "rgba(198,75,232,0.15)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#C64BE8",
    borderRadius: 3,
  },
  progressLabel: { fontSize: 10.5, fontFamily: "Poppins_500Medium", marginTop: 4, textAlign: "right" },

  // Action button
  actionBtnWrap: { marginTop: 10, borderRadius: 12, overflow: "hidden" },
  actionBtn: {
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionBtnPrimaryText: { color: "#fff", fontSize: 13.5, fontFamily: "Poppins_700Bold" },
  actionBtnSecondary: { backgroundColor: "transparent", borderWidth: 1.5 },
  actionBtnDisabled: { backgroundColor: "rgba(148,163,184,0.15)" },
  actionBtnSecondaryText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },

  // Empty / loading
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyEmoji: { fontSize: 48 },
  emptyText: { fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center" },
});

// Per-screen error boundary — a render crash here won't blank the whole app.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
