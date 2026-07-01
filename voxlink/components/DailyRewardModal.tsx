// DailyRewardModal — celebratory pop-up for the daily streak feature.
//
// Two visual states share one modal so the user never sees the modal flicker
// closed mid-claim:
//   1. CLAIMABLE  — "Day N · earn X coins" with a Claim CTA + at-risk countdown.
//   2. CELEBRATE  — animated count-up + confetti burst + streak chip. Auto
//                   transitions into here on a successful claim, driving the
//                   user dopamine → next-day return.
//
// Driven entirely by the `useDailyStreak` hook in _layout.tsx — this
// component is purely presentational.
//
// Theme-aware (light/dark via useColors) and fully localized (useLanguage).

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Animated, Easing, Image, ScrollView, useColorScheme,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import type { DailyStreakStatus, DailyStreakClaimResult } from "@/hooks/useDailyStreak";

const GRADIENT: [string, string] = ["#CF00FD", "#8400FF"];
// Richer 3-stop gradient for the header hero (more vibrant than the flat CTA).
// Slightly deeper/less glaring variant for dark mode so it doesn't blast the
// user's eyes on an otherwise dark screen.
const HEADER_GRADIENT: [string, string, string] = ["#E24DFF", "#B026FF", "#7A00FF"];
const HEADER_GRADIENT_DARK: [string, string, string] = ["#B93DE8", "#8A1FD0", "#5A00C4"];
const COIN_GOLD = "#FFC93C";
const COIN_GOLD_DARK = "#FFD87A"; // brighter gold — readable on dark surfaces
const CONFETTI_COLORS = ["#FFC93C", "#CF00FD", "#8400FF", "#22C55E", "#38BDF8", "#FF6B9D"];

interface DailyRewardModalProps {
  visible: boolean;
  status: DailyStreakStatus | null;
  /** Set when the user just successfully claimed — switches modal into
   *  the celebration view. Null otherwise. */
  lastClaim: DailyStreakClaimResult | null;
  claiming: boolean;
  onClaim: () => void;
  onClose: () => void;
  /** Repair (streak-saver) in flight — disables the repair button. */
  repairing?: boolean;
  /** Restore a lapsed streak (shown only when status.can_repair). */
  onRepair?: () => void;
}

/* ─── Small helpers ───────────────────────────────────────────────────── */

// Compact, language-neutral duration ("3h 24m", "12m 30s", "45s").
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return Object.keys(vars).reduce(
    (acc, k) => acc.split(`{${k}}`).join(String(vars[k])),
    template
  );
}

// Counts a displayed number up from 0 → target when `run` flips true.
function useCountUp(target: number, run: boolean): number {
  const [val, setVal] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) { setVal(target); return; }
    if (target <= 0) { setVal(target); return; }
    const frames = 26;
    let i = 0;
    setVal(0);
    const timer = setInterval(() => {
      i++;
      // easeOutCubic ramp for a satisfying decelerating count.
      const t = i / frames;
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(i >= frames ? target : Math.round(target * eased));
      if (i >= frames) clearInterval(timer);
    }, 26);
    return () => clearInterval(timer);
  }, [target, run]);
  return val;
}

// Live, second-by-second countdown from an initial snapshot value.
function useCountdown(initialSeconds: number | undefined, run: boolean): number | null {
  const [remaining, setRemaining] = useState<number | null>(
    typeof initialSeconds === "number" ? initialSeconds : null
  );
  useEffect(() => {
    if (!run || typeof initialSeconds !== "number") { setRemaining(typeof initialSeconds === "number" ? initialSeconds : null); return; }
    setRemaining(initialSeconds);
    const timer = setInterval(() => {
      setRemaining((prev) => (prev == null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(timer);
  }, [initialSeconds, run]);
  return remaining;
}

export default function DailyRewardModal({
  visible,
  status,
  lastClaim,
  claiming,
  onClaim,
  onClose,
  repairing = false,
  onRepair,
}: DailyRewardModalProps) {
  const colors = useColors();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const { t } = useLanguage();
  const tr = t.dailyReward;

  // Shared scale animation — bouncy "pop" on open, used for both views.
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // Coin glow pulse (loops gently while open).
  const glow = useRef(new Animated.Value(0)).current;
  // Gentle idle bounce for the gift box (claimable state only).
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, tension: 65, friction: 7, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      const bounceLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(bounce, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bounce, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      bounceLoop.start();
      return () => { loop.stop(); bounceLoop.stop(); };
    } else {
      scale.setValue(0.85);
      opacity.setValue(0);
      glow.setValue(0);
      bounce.setValue(0);
    }
  }, [visible, scale, opacity, glow, bounce]);

  const isCelebrating = lastClaim?.claimed === true;
  const isMilestone = isCelebrating && (lastClaim?.milestone_bonus ?? 0) > 0;

  // Trigger haptic feedback when the celebration view appears.
  useEffect(() => {
    if (visible && isCelebrating) {
      try { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    }
  }, [visible, isCelebrating]);

  if (!visible || !status) return null;

  // Streak we WILL be on after claiming (shown on the claimable card so the
  // user knows what they're earning). After claim, use the response streak.
  const streakAfter = isCelebrating ? lastClaim.streak_days : status.streak_days + 1;

  const coinPulse = {
    transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
  };
  // Soft pulsing ring that breathes out from behind the header icon.
  const haloStyle = {
    opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.55] }) }],
  };
  // Golden glow that pulses behind the big coin number.
  const coinHaloStyle = {
    opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.5] }),
    transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.12] }) }],
  };
  // Idle gift-box bounce: a gentle rise + tilt + squash, celebration-safe
  // (only applied to the 🎁 in the claimable state).
  const giftBounce = {
    transform: [
      { translateY: bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
      { scale: bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) },
      { rotate: bounce.interpolate({ inputRange: [0, 1], outputRange: ["-5deg", "5deg"] }) },
    ],
  };
  const headerColors = isDark ? HEADER_GRADIENT_DARK : HEADER_GRADIENT;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity, backgroundColor: colors.overlay }]}>
        <Animated.View style={[styles.card, { backgroundColor: colors.card, transform: [{ scale }] }]}>
          {/* Gradient header */}
          <LinearGradient
            colors={headerColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            {/* Decorative bokeh circles for depth */}
            <View pointerEvents="none" style={styles.bokehTop} />
            <View pointerEvents="none" style={styles.bokehBottom} />
            {/* Floating sparkles */}
            <Text pointerEvents="none" style={styles.sparkleTL}>✨</Text>
            <Text pointerEvents="none" style={styles.sparkleTR}>✨</Text>
            {isCelebrating ? <Confetti intense={isMilestone} /> : null}
            <View style={styles.headerEmojiWrap}>
              {/* Slowly rotating sunburst rays behind the icon */}
              <Sunburst />
              <Animated.View pointerEvents="none" style={[styles.emojiHalo, haloStyle]} />
              <View style={styles.emojiInner}>
                <Animated.Text style={[styles.headerEmoji, !isCelebrating && giftBounce]}>
                  {isCelebrating ? "🎉" : "🎁"}
                </Animated.Text>
              </View>
            </View>
            <Text style={styles.headerTitle}>
              {isCelebrating ? tr.titleClaimed : tr.title}
            </Text>
            <Text style={styles.headerSub}>
              {isCelebrating
                ? interpolate(tr.streakUnlocked, { day: streakAfter })
                : interpolate(tr.dayOfStreak, { day: streakAfter })}
            </Text>
            {/* Streak flame chip */}
            <View style={styles.streakChip}>
              <Text style={styles.streakChipTxt}>🔥 {streakAfter}</Text>
            </View>
          </LinearGradient>

          {/* Body */}
          {isCelebrating ? (
            <CelebrationBody result={lastClaim} status={status} colors={colors} tr={tr} coinPulse={coinPulse} coinHalo={coinHaloStyle} isDark={isDark} />
          ) : (
            <ClaimableBody status={status} streakAfter={streakAfter} colors={colors} tr={tr} coinPulse={coinPulse} coinHalo={coinHaloStyle} isDark={isDark} />
          )}

          {/* Schedule strip — visible in BOTH states. */}
          <ScheduleStrip
            schedule={status.schedule}
            milestones={status.milestones}
            currentDay={streakAfter}
            isCelebrating={isCelebrating}
            colors={colors}
            label={tr.scheduleLabel}
          />

          {/* Streak-saver / at-risk banner — only in the claimable state. */}
          {!isCelebrating && status.can_repair ? (
            <RepairBanner status={status} repairing={repairing} onRepair={onRepair} tr={tr} />
          ) : !isCelebrating ? (
            <AtRiskBanner status={status} tr={tr} />
          ) : null}

          {/* CTA */}
          <View style={styles.ctaRow}>
            {isCelebrating ? (
              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.85}
                style={styles.primaryBtnWrap}
                accessibilityRole="button"
                accessibilityLabel={tr.awesome}
              >
                <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                  <Shimmer />
                  <Text style={styles.primaryBtnTxt}>{tr.awesome}</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  onPress={onClose}
                  activeOpacity={0.7}
                  style={styles.skipBtn}
                  accessibilityRole="button"
                  accessibilityLabel={tr.later}
                >
                  <Text style={[styles.skipBtnTxt, { color: colors.mutedForeground }]}>{tr.later}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onClaim}
                  activeOpacity={0.85}
                  disabled={claiming}
                  style={[styles.primaryBtnWrap, claiming && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: claiming, busy: claiming }}
                  accessibilityLabel={interpolate(tr.claim, { count: status.next_reward })}
                >
                  <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                    <Shimmer />
                    <Text style={styles.primaryBtnTxt}>
                      {claiming ? tr.claiming : interpolate(tr.claim, { count: status.next_reward })}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

type TR = ReturnType<typeof useLanguage>["t"]["dailyReward"];
type Colors = ReturnType<typeof useColors>;

/* ─── Sub-views ───────────────────────────────────────────────────────── */

function ClaimableBody({
  status, streakAfter, colors, tr, coinPulse, coinHalo, isDark,
}: {
  status: DailyStreakStatus; streakAfter: number; colors: Colors; tr: TR; coinPulse: any; coinHalo: any; isDark: boolean;
}) {
  const milestone = status.next_reward_milestone;

  // Find the next FUTURE milestone day so we can nudge the user toward it.
  const nextMilestoneHint = useMemo(() => {
    if (milestone > 0) return null; // today already is a milestone — badge handles it
    const entries = Object.entries(status.milestones ?? {})
      .map(([d, bonus]) => [Number(d), bonus] as const)
      .filter(([d, bonus]) => bonus > 0 && d > streakAfter)
      .sort((a, b) => a[0] - b[0]);
    if (!entries.length) return null;
    const day = entries[0][0];
    const daysAway = day - streakAfter;
    const tmpl = daysAway === 1 ? tr.nextMilestone : tr.nextMilestonePlural;
    return interpolate(tmpl, { count: daysAway, day });
  }, [status.milestones, milestone, streakAfter, tr]);

  return (
    <View style={styles.body}>
      <View style={styles.coinWrap}>
        <Animated.View pointerEvents="none" style={[styles.coinHalo, coinHalo]} />
          <CoinSparkles />
        <Animated.View style={[styles.coinRow, coinPulse]}>
          <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
          <Text style={[styles.bigNumber, { color: colors.text }]}>{status.next_reward}</Text>
        </Animated.View>
      </View>
      <Text style={[styles.bodyHint, { color: colors.mutedForeground }]}>{tr.claimHint}</Text>
      {milestone > 0 ? (
        <View style={[styles.milestoneBadge, isDark && styles.milestoneBadgeDark]}>
          <Text style={[styles.milestoneTxt, isDark && { color: COIN_GOLD_DARK }]}>
            🎉 {interpolate(tr.dayBonus, { day: streakAfter, count: milestone })}
          </Text>
        </View>
      ) : nextMilestoneHint ? (
        <Text style={[styles.nextMilestoneHint, { color: colors.mutedForeground }]}>⭐ {nextMilestoneHint}</Text>
      ) : null}
    </View>
  );
}

function CelebrationBody({
  result, status, colors, tr, coinPulse, coinHalo, isDark,
}: {
  result: DailyStreakClaimResult; status: DailyStreakStatus; colors: Colors; tr: TR; coinPulse: any; coinHalo: any; isDark: boolean;
}) {
  // Lucky-wheel reveal — only when the server says this reward was drawn by
  // the variable engine. Expected payout unchanged (budget-neutral).
  const segments = (status.variable_table ?? []).map((s) => s.m).filter((m) => Number.isFinite(m) && m > 0);
  const counted = useCountUp(result.reward, true);

  return (
    <View style={styles.body}>
      {result.variable ? (
        <LuckyMultiplier multiplier={result.multiplier ?? 1} segments={segments} tr={tr} />
      ) : null}
      <View style={styles.coinWrap}>
        <Animated.View pointerEvents="none" style={[styles.coinHalo, coinHalo]} />
          <CoinSparkles />
        <Animated.View style={[styles.coinRow, coinPulse]}>
          <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
          <Text style={[styles.bigNumber, { color: colors.text }]}>+{counted}</Text>
        </Animated.View>
      </View>
      {result.milestone_bonus > 0 ? <MilestoneCelebration bonus={result.milestone_bonus} /> : null}
      {result.milestone_bonus > 0 ? (
        (() => {
          // Split the localized template at {bonus} so we can highlight the
          // bonus amount in gold while keeping the rest muted — works for all
          // languages regardless of word order.
          const parts = tr.baseMilestone.split("{bonus}");
          const before = interpolate(parts[0] ?? "", { base: result.base_reward });
          const after = parts[1] ?? "";
          return (
            <Text style={[styles.celebrationSub, { color: colors.mutedForeground }]}>
              {before}
              <Text style={[styles.celebrationBonus, isDark && { color: COIN_GOLD_DARK }]}>{result.milestone_bonus}{after}</Text>
            </Text>
          );
        })()
      ) : (
        <Text style={[styles.celebrationSub, { color: colors.mutedForeground }]}>{tr.addedToWallet}</Text>
      )}
      {typeof result.new_balance === "number" ? (
        <Text style={[styles.balanceLine, { color: colors.text }]}>
          {tr.newBalance}: <Text style={styles.balanceVal}>{result.new_balance} {tr.coins}</Text>
        </Text>
      ) : null}
      {/* Engagement v2 extras — only render when present (> 0). */}
      {(result.minutes_reward ?? 0) > 0 ? (
        <View style={styles.extraBadge}>
          <Text style={styles.extraTxt}>📞 {interpolate(tr.freeMinutes, { count: result.minutes_reward ?? 0 })}</Text>
        </View>
      ) : null}
      {(result.chest_bonus ?? 0) > 0 ? (
        <View style={[styles.extraBadge, styles.chestBadge]}>
          <Text style={styles.extraTxt}>🎁 {interpolate(tr.monthlyChest, { count: result.chest_bonus ?? 0 })}</Text>
        </View>
      ) : null}
      {(result.comeback_bonus ?? 0) > 0 ? (
        <View style={styles.extraBadge}>
          <Text style={styles.extraTxt}>👋 {interpolate(tr.comebackBonus, { count: result.comeback_bonus ?? 0 })}</Text>
        </View>
      ) : null}
    </View>
  );
}

function LuckyMultiplier({
  multiplier, segments, tr,
}: {
  multiplier: number; segments: number[]; tr: TR;
}) {
  const pool = segments.length ? segments : [0.5, 0.8, 1, 2, 5];
  const [display, setDisplay] = useState<number>(pool[0]);
  const [settled, setSettled] = useState(false);
  const pop = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    let i = 0;
    const ticks = 12;
    const timer = setInterval(() => {
      i++;
      if (i >= ticks) {
        clearInterval(timer);
        setDisplay(multiplier);
        setSettled(true);
        try { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
        Animated.spring(pop, { toValue: 1, tension: 80, friction: 5, useNativeDriver: true }).start();
      } else {
        setDisplay(pool[Math.floor(Math.random() * pool.length)]);
      }
    }, 80);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplier]);

  const big = settled && multiplier >= 2;
  const fmt = (m: number) => (Number.isInteger(m) ? String(m) : m.toFixed(1));
  return (
    <Animated.View style={[styles.luckyWrap, big && styles.luckyWrapBig, { transform: [{ scale: pop }] }]}>
      <Text style={styles.luckyLabel}>{settled ? (big ? tr.lucky : tr.luckyWheel) : tr.spinning}</Text>
      <Text style={[styles.luckyMult, big && styles.luckyMultBig]}>{fmt(display)}×</Text>
    </Animated.View>
  );
}

function ScheduleStrip({
  schedule, milestones, currentDay, isCelebrating, colors, label,
}: {
  schedule: number[];
  milestones: Record<string, number>;
  currentDay: number;
  isCelebrating: boolean;
  colors: Colors;
  label: string;
}) {
  // 7-day window centered on today. We expose the absolute streak day on each
  // pill so milestones (Day 7, 14, …) can be highlighted as the user nears them.
  const len = schedule.length;
  if (!len) return null;
  const startDay = Math.max(1, currentDay - 3);
  const days = Array.from({ length: 7 }, (_, i) => startDay + i);

  return (
    <View style={styles.stripWrap}>
      <Text style={[styles.stripLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripRow}>
        {days.map((day) => {
          const idx = ((day - 1) % len + len) % len;
          const baseReward = schedule[idx];
          const milestone = milestones[String(day)] ?? 0;
          const isToday = day === currentDay;
          // When celebrating, "today" has been claimed too.
          const isClaimed = day < currentDay || (isCelebrating && day === currentDay);
          return (
            <View
              key={day}
              style={[
                styles.stripPill,
                { backgroundColor: colors.surface, borderColor: "transparent" },
                isToday && { backgroundColor: colors.accentLight, borderColor: colors.accent },
                isClaimed && !isToday && { backgroundColor: colors.muted, opacity: 0.7 },
              ]}
            >
              <Text style={[styles.stripDay, { color: colors.mutedForeground }, isToday && { color: colors.accent }]}>
                D{day}
              </Text>
              <View style={styles.stripCoinRow}>
                <Text style={[styles.stripCoin, { color: colors.text }, isToday && { color: colors.accent }]}>
                  {baseReward + milestone}
                </Text>
              </View>
              {isClaimed && !isToday ? (
                <Text style={styles.stripCheck}>✓</Text>
              ) : milestone > 0 ? (
                <Text style={styles.stripStar}>★</Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function RepairBanner({
  status, repairing, onRepair, tr,
}: {
  status: DailyStreakStatus; repairing: boolean; onRepair?: () => void; tr: TR;
}) {
  const hasFreeze = (status.freezes_available ?? 0) > 0;
  const cost = status.repair_cost_coins ?? 0;
  return (
    <View style={styles.repairBanner}>
      <Text style={styles.repairTitle}>💔 {tr.missedDay}</Text>
      <Text style={styles.repairSub}>
        {hasFreeze
          ? interpolate(tr.restoreWithSaver, { streak: status.streak_days, count: status.freezes_available ?? 0 })
          : interpolate(tr.restoreWithCoins, { streak: status.streak_days, count: cost })}
      </Text>
      <TouchableOpacity
        onPress={onRepair}
        activeOpacity={0.85}
        disabled={repairing || !onRepair}
        style={[styles.repairBtn, (repairing || !onRepair) && { opacity: 0.7 }]}
        accessibilityRole="button"
      >
        <Text style={styles.repairBtnTxt}>
          {repairing
            ? tr.restoring
            : hasFreeze
              ? `🛡️ ${tr.useStreakSaver}`
              : `🔧 ${interpolate(tr.restoreForCoins, { count: cost })}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function AtRiskBanner({ status, tr }: { status: DailyStreakStatus; tr: TR }) {
  // Live countdown driven by the snapshot's seconds_until_reset.
  const remaining = useCountdown(status.seconds_until_reset, !!status.at_risk);
  if (!status.at_risk) return null;
  const text = remaining != null && remaining > 0
    ? interpolate(tr.atRiskCountdown, { time: formatDuration(remaining) })
    : tr.atRisk;
  return (
    <View style={styles.atRiskBanner}>
      <Text style={styles.atRiskTxt}>⚠️ {text}</Text>
    </View>
  );
}

/* ─── Sunburst rays (behind header icon) ──────────────────────────────── */

function Sunburst() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 16000, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const RAYS = 9; // 9 diameters → 18 evenly-spaced spokes (step 20°)
  return (
    <Animated.View pointerEvents="none" style={[styles.sunburst, { transform: [{ rotate }] }]}>
      {Array.from({ length: RAYS }).map((_, i) => (
        <View key={i} style={[styles.ray, { transform: [{ rotate: `${(180 / RAYS) * i}deg` }] }]} />
      ))}
    </Animated.View>
  );
}

/* ─── Floating sparkle particles (around the coin) ────────────────────── */

function CoinSparkles() {
  // A handful of ✨/⭐ that drift outward from the coin and fade, on a loop —
  // gives the reward a lively, "shiny treasure" feel.
  const parts = useRef(
    Array.from({ length: 7 }, (_, i) => ({
      key: i,
      angle: (Math.PI * 2 * i) / 7 + Math.random() * 0.5,
      dist: 44 + Math.random() * 22,
      delay: Math.random() * 1500,
      char: i % 3 === 0 ? "⭐" : "✨",
      size: 9 + Math.random() * 7,
      anim: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    const loops = parts.map((p) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.timing(p.anim, { toValue: 1, duration: 1700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="none" style={styles.sparkleLayer}>
      {parts.map((p) => {
        const tx = Math.cos(p.angle) * p.dist;
        const ty = Math.sin(p.angle) * p.dist;
        const translateX = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, tx] });
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, ty] });
        const opacity = p.anim.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });
        const scale = p.anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.3, 1, 0.5] });
        return (
          <Animated.Text
            key={p.key}
            style={{ position: "absolute", fontSize: p.size, opacity, transform: [{ translateX }, { translateY }, { scale }] }}
          >
            {p.char}
          </Animated.Text>
        );
      })}
    </View>
  );
}

/* ─── Shimmer sweep (over the CTA button) ─────────────────────────────── */

function Shimmer() {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(x, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(1100),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-90, 360] });
  return (
    <Animated.View pointerEvents="none" style={[styles.shimmer, { transform: [{ translateX }, { rotate: "18deg" }] }]}>
      <LinearGradient
        colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.5)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/* ─── Milestone flourish (celebration, milestone days only) ───────────── */

function MilestoneCelebration({ bonus }: { bonus: number }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(400),
      Animated.spring(pop, { toValue: 1, tension: 90, friction: 5, useNativeDriver: true }),
    ]).start();
    try { setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); }, 420); } catch {}
  }, [pop]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  return (
    <Animated.View style={{ opacity: pop, transform: [{ scale }] }}>
      <LinearGradient
        colors={["#FFDE86", "#FFB300"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.milestoneCelebrate}
      >
        <Text style={styles.milestoneCelebrateTxt}>🏆 +{bonus}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

/* ─── Confetti burst (celebration only) ───────────────────────────────── */

function Confetti({ intense = false }: { intense?: boolean }) {
  // 14 lightweight pieces normally; a denser gold-weighted burst on milestone
  // days so hitting Day 7/14/… feels like a genuine jackpot.
  const count = intense ? 28 : 14;
  const palette = intense ? [COIN_GOLD, "#FFD87A", "#FFB300", ...CONFETTI_COLORS] : CONFETTI_COLORS;
  const pieces = useRef(
    Array.from({ length: count }, (_, i) => ({
      key: i,
      left: Math.random() * 100,
      color: palette[i % palette.length],
      size: 6 + Math.random() * 6,
      delay: Math.random() * 250,
      drift: (Math.random() - 0.5) * 80,
      anim: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    const animations = pieces.map((p) =>
      Animated.timing(p.anim, {
        toValue: 1,
        duration: 1300,
        delay: p.delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    Animated.stagger(20, animations).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {pieces.map((p) => {
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [-10, 150] });
        const translateX = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = p.anim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "320deg"] });
        const opacity = p.anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={p.key}
            style={{
              position: "absolute",
              top: 0,
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center", alignItems: "center", padding: 20,
  },
  card: {
    width: "100%", maxWidth: 380,
    borderRadius: 28, overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#8400FF", shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  header: {
    paddingTop: 28, paddingBottom: 24, paddingHorizontal: 20,
    alignItems: "center", overflow: "hidden", position: "relative",
  },
  bokehTop: {
    position: "absolute", top: -40, right: -30, width: 130, height: 130,
    borderRadius: 65, backgroundColor: "rgba(255,255,255,0.12)",
  },
  bokehBottom: {
    position: "absolute", bottom: -50, left: -35, width: 120, height: 120,
    borderRadius: 60, backgroundColor: "rgba(255,255,255,0.08)",
  },
  sparkleTL: { position: "absolute", top: 16, left: 22, fontSize: 15, opacity: 0.9 },
  sparkleTR: { position: "absolute", top: 34, right: 26, fontSize: 11, opacity: 0.75 },
  headerEmojiWrap: {
    width: 76, height: 76, alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  sunburst: {
    position: "absolute", width: 132, height: 132, top: -28, left: -28,
    alignItems: "center", justifyContent: "center",
  },
  ray: {
    position: "absolute", width: 2.5, height: 132, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  emojiHalo: {
    position: "absolute", width: 76, height: 76, borderRadius: 38,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  emojiInner: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.45)",
    alignItems: "center", justifyContent: "center",
  },
  headerEmoji: { fontSize: 34 },
  headerTitle: {
    fontSize: 21, fontFamily: "Poppins_700Bold", color: "#fff",
    textShadowColor: "rgba(0,0,0,0.18)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  headerSub: { fontSize: 12.5, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.9)", marginTop: 3 },
  streakChip: {
    marginTop: 12, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.35)",
  },
  streakChipTxt: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "#fff" },

  confettiLayer: { ...StyleSheet.absoluteFillObject },

  body: { padding: 22, alignItems: "center" },
  coinWrap: { alignItems: "center", justifyContent: "center" },
  sparkleLayer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  coinHalo: {
    position: "absolute", width: 150, height: 150, borderRadius: 75,
    backgroundColor: "rgba(255,201,60,0.22)",
  },
  coinRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  coinIcon: { width: 40, height: 40 },
  bigNumber: {
    fontSize: 48, fontFamily: "Poppins_700Bold", letterSpacing: -1,
    textShadowColor: "rgba(255,201,60,0.35)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  bodyHint: { fontSize: 13, fontFamily: "Poppins_400Regular", marginTop: 8, textAlign: "center" },

  milestoneBadge: {
    marginTop: 14, paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: "rgba(255,201,60,0.15)", borderRadius: 999,
    borderWidth: 1, borderColor: "rgba(255,201,60,0.5)",
  },
  milestoneTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#A56A00", textAlign: "center" },
  milestoneBadgeDark: { backgroundColor: "rgba(255,201,60,0.20)", borderColor: "rgba(255,201,60,0.6)" },
  nextMilestoneHint: { fontSize: 12, fontFamily: "Poppins_500Medium", marginTop: 12, textAlign: "center" },

  celebrationSub: { fontSize: 13, fontFamily: "Poppins_500Medium", marginTop: 6 },
  celebrationBonus: { color: COIN_GOLD, fontFamily: "Poppins_700Bold" },
  milestoneCelebrate: {
    marginTop: 14, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 999,
    shadowColor: "#FFB300", shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  milestoneCelebrateTxt: { fontSize: 17, fontFamily: "Poppins_700Bold", color: "#6B3F00", letterSpacing: 0.3 },

  luckyWrap: {
    alignItems: "center", marginBottom: 10, paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 16, backgroundColor: "rgba(132,0,255,0.08)",
    borderWidth: 1, borderColor: "rgba(132,0,255,0.25)",
  },
  luckyWrapBig: { backgroundColor: "rgba(255,201,60,0.18)", borderColor: "rgba(255,201,60,0.6)" },
  luckyLabel: {
    fontSize: 10, fontFamily: "Poppins_600SemiBold", color: "#8400FF",
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  luckyMult: { fontSize: 30, fontFamily: "Poppins_700Bold", color: "#8400FF", letterSpacing: -0.5 },
  luckyMultBig: { fontSize: 38, color: "#B8860B" },
  balanceLine: { fontSize: 13, fontFamily: "Poppins_500Medium", marginTop: 12 },
  balanceVal: { fontFamily: "Poppins_700Bold", color: "#8400FF" },

  // Schedule strip
  stripWrap: { paddingHorizontal: 20, paddingBottom: 6 },
  stripLabel: {
    fontSize: 11, fontFamily: "Poppins_600SemiBold",
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
  },
  stripRow: { gap: 8, paddingRight: 4 },
  stripPill: {
    width: 48, paddingVertical: 8, borderRadius: 12,
    alignItems: "center", borderWidth: 1,
  },
  stripDay: { fontSize: 10, fontFamily: "Poppins_500Medium" },
  stripCoinRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  stripCoin: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  stripStar: { position: "absolute", top: 4, right: 5, fontSize: 9, color: COIN_GOLD },
  stripCheck: { position: "absolute", top: 3, right: 5, fontSize: 10, color: "#0BAF23", fontFamily: "Poppins_700Bold" },

  // Repair / at-risk banners
  repairBanner: {
    marginHorizontal: 20, marginBottom: 6, padding: 14, borderRadius: 14,
    backgroundColor: "rgba(255,71,87,0.08)", borderWidth: 1, borderColor: "rgba(255,71,87,0.35)",
    alignItems: "center",
  },
  repairTitle: { fontSize: 14, fontFamily: "Poppins_700Bold", color: "#E23744" },
  repairSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#9B6B70", textAlign: "center", marginTop: 4 },
  repairBtn: {
    marginTop: 10, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: "#E23744",
  },
  repairBtnTxt: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "#fff" },
  atRiskBanner: {
    marginHorizontal: 20, marginBottom: 6, padding: 10, borderRadius: 12,
    backgroundColor: "rgba(255,159,10,0.12)", borderWidth: 1, borderColor: "rgba(255,159,10,0.4)",
    alignItems: "center",
  },
  atRiskTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#B26B00", textAlign: "center" },

  // Celebration extra reward badges
  extraBadge: {
    marginTop: 10, paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: "rgba(132,0,255,0.10)", borderRadius: 999,
    borderWidth: 1, borderColor: "rgba(132,0,255,0.30)",
  },
  chestBadge: { backgroundColor: "rgba(255,201,60,0.18)", borderColor: "rgba(255,201,60,0.5)" },
  extraTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#6A1B9A", textAlign: "center" },

  // CTA
  ctaRow: { flexDirection: "row", gap: 10, padding: 20, paddingTop: 14 },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 18 },
  skipBtnTxt: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  primaryBtnWrap: {
    flex: 1, borderRadius: 14,
    shadowColor: "#8400FF", shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  primaryBtn: { paddingVertical: 15, borderRadius: 14, alignItems: "center", overflow: "hidden" },
  shimmer: { position: "absolute", top: -20, left: 0, width: 46, height: 100 },
  primaryBtnTxt: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#fff", letterSpacing: 0.2 },
});
