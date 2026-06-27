// DailyRewardModal — celebratory pop-up for the daily streak feature.
//
// Two visual states share one modal so the user never sees the modal flicker
// closed mid-claim:
//   1. CLAIMABLE  — "Day N · earn X coins" with a Claim CTA.
//   2. CELEBRATE  — "+X coins!" big number + streak chip + Done button. Auto
//                   transitions into here on a successful claim, drives the
//                   user dopamine → next-day return.
//
// Driven entirely by the `useDailyStreak` hook in _layout.tsx — this
// component is purely presentational.

import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Animated, Image, ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import type { DailyStreakStatus, DailyStreakClaimResult } from "@/hooks/useDailyStreak";

const GRADIENT: [string, string] = ["#CF00FD", "#8400FF"];
const COIN_GOLD = "#FFC93C";

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
  // Shared scale animation — bouncy "pop" on open, used for both views.
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, tension: 65, friction: 7, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(0.85);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  // Trigger haptic feedback when the celebration view appears.
  useEffect(() => {
    if (visible && lastClaim?.claimed) {
      try { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    }
  }, [visible, lastClaim?.claimed]);

  if (!visible || !status) return null;

  const isCelebrating = lastClaim?.claimed === true;
  // Streak we WILL be on after claiming (shown on the claimable card so
  // the user knows what they're earning). After claim, just use the new
  // streak from the response.
  const streakAfter = isCelebrating ? lastClaim.streak_days : (status.streak_days + 1) || 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          {/* Gold ribbon header */}
          <LinearGradient
            colors={GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.header}
          >
            <Text style={styles.headerEmoji}>🎁</Text>
            <Text style={styles.headerTitle}>
              {isCelebrating ? "Reward Claimed!" : "Daily Reward"}
            </Text>
            <Text style={styles.headerSub}>
              {isCelebrating ? `Day ${streakAfter} streak unlocked` : `Day ${streakAfter} of your streak`}
            </Text>
          </LinearGradient>

          {/* Body */}
          {isCelebrating ? (
            <CelebrationBody result={lastClaim} status={status} />
          ) : (
            <ClaimableBody status={status} streakAfter={streakAfter} />
          )}

          {/* Schedule strip — visible in BOTH states so the user sees what's
              coming next. Subtle reinforcement of the streak loop. */}
          <ScheduleStrip
            schedule={status.schedule}
            milestones={status.milestones}
            currentDay={streakAfter}
          />

          {/* Streak-saver / at-risk banner — only in the claimable state. */}
          {!isCelebrating && status.can_repair ? (
            <View style={styles.repairBanner}>
              <Text style={styles.repairTitle}>💔 You missed a day!</Text>
              <Text style={styles.repairSub}>
                Restore your {status.streak_days}-day streak
                {(status.freezes_available ?? 0) > 0
                  ? ` with a free streak saver (${status.freezes_available} left)`
                  : ` for ${status.repair_cost_coins ?? 0} coins`}
                .
              </Text>
              <TouchableOpacity
                onPress={onRepair}
                activeOpacity={0.85}
                disabled={repairing || !onRepair}
                style={styles.repairBtn}
              >
                <Text style={styles.repairBtnTxt}>
                  {repairing
                    ? "Restoring…"
                    : (status.freezes_available ?? 0) > 0
                      ? "🛡️ Use Streak Saver"
                      : `🔧 Restore for ${status.repair_cost_coins ?? 0} coins`}
                </Text>
              </TouchableOpacity>
            </View>
          ) : !isCelebrating && status.at_risk ? (
            <View style={styles.atRiskBanner}>
              <Text style={styles.atRiskTxt}>
                ⚠️ Claim soon — your streak resets at midnight!
              </Text>
            </View>
          ) : null}

          {/* CTA */}
          <View style={styles.ctaRow}>
            {isCelebrating ? (
              <TouchableOpacity onPress={onClose} activeOpacity={0.85} style={styles.primaryBtnWrap}>
                <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnTxt}>Awesome!</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.skipBtn}>
                  <Text style={styles.skipBtnTxt}>Later</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onClaim}
                  activeOpacity={0.85}
                  disabled={claiming}
                  style={styles.primaryBtnWrap}
                >
                  <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnTxt}>
                      {claiming ? "Claiming…" : `Claim ${status.next_reward} coins`}
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

/* ─── Sub-views ───────────────────────────────────────────────────────── */

function ClaimableBody({ status, streakAfter }: { status: DailyStreakStatus; streakAfter: number }) {
  const milestone = status.next_reward_milestone;
  return (
    <View style={styles.body}>
      <View style={styles.coinRow}>
        <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
        <Text style={styles.bigNumber}>{status.next_reward}</Text>
      </View>
      <Text style={styles.bodyHint}>
        Claim today to keep your streak going.
      </Text>
      {milestone > 0 ? (
        <View style={styles.milestoneBadge}>
          <Text style={styles.milestoneTxt}>
            🎉 Day {streakAfter} bonus: +{milestone} extra coins!
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function CelebrationBody({ result, status }: { result: DailyStreakClaimResult; status: DailyStreakStatus }) {
  // P2: lucky-wheel reveal. Only when the server says this reward was drawn by
  // the variable engine. The expected payout is unchanged (budget-neutral) —
  // the spin is pure dopamine on top of the guaranteed base.
  const segments = (status.variable_table ?? []).map((t) => t.m).filter((m) => Number.isFinite(m) && m > 0);
  return (
    <View style={styles.body}>
      {result.variable ? (
        <LuckyMultiplier multiplier={result.multiplier ?? 1} segments={segments} />
      ) : null}
      <View style={styles.coinRow}>
        <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
        <Text style={styles.bigNumber}>+{result.reward}</Text>
      </View>
      {result.milestone_bonus > 0 ? (
        <Text style={styles.celebrationSub}>
          {result.base_reward} base + <Text style={styles.celebrationBonus}>{result.milestone_bonus} milestone bonus</Text>
        </Text>
      ) : (
        <Text style={styles.celebrationSub}>added to your wallet</Text>
      )}
      {typeof result.new_balance === "number" ? (
        <Text style={styles.balanceLine}>
          New balance: <Text style={styles.balanceVal}>{result.new_balance} coins</Text>
        </Text>
      ) : null}
      {/* Engagement v2 extras — only render when present (> 0). */}
      {(result.minutes_reward ?? 0) > 0 ? (
        <View style={styles.extraBadge}>
          <Text style={styles.extraTxt}>📞 +{result.minutes_reward} free call minutes!</Text>
        </View>
      ) : null}
      {(result.chest_bonus ?? 0) > 0 ? (
        <View style={[styles.extraBadge, styles.chestBadge]}>
          <Text style={styles.extraTxt}>🎁 Monthly chest: +{result.chest_bonus} coins!</Text>
        </View>
      ) : null}
      {(result.comeback_bonus ?? 0) > 0 ? (
        <View style={styles.extraBadge}>
          <Text style={styles.extraTxt}>👋 Welcome back bonus: +{result.comeback_bonus} coins</Text>
        </View>
      ) : null}
    </View>
  );
}

function LuckyMultiplier({ multiplier, segments }: { multiplier: number; segments: number[] }) {
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
      <Text style={styles.luckyLabel}>{settled ? (big ? "🎉 LUCKY!" : "Lucky wheel") : "Spinning…"}</Text>
      <Text style={[styles.luckyMult, big && styles.luckyMultBig]}>{fmt(display)}×</Text>
    </Animated.View>
  );
}

function ScheduleStrip({
  schedule,
  milestones,
  currentDay,
}: {
  schedule: number[];
  milestones: Record<string, number>;
  currentDay: number;
}) {
  // Show a 7-day window centered on today. If schedule is shorter than 7
  // we just repeat. We expose the absolute streak day on each pill so
  // milestones (Day 7, 14, etc.) can be highlighted as the user gets close.
  const len = schedule.length;
  const startDay = Math.max(1, currentDay - 3);
  const days = Array.from({ length: 7 }, (_, i) => startDay + i);

  return (
    <View style={styles.stripWrap}>
      <Text style={styles.stripLabel}>Streak schedule</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripRow}>
        {days.map((day) => {
          const idx = ((day - 1) % len + len) % len;
          const baseReward = schedule[idx];
          const milestone = milestones[String(day)] ?? 0;
          const isToday = day === currentDay;
          const isPast = day < currentDay;
          return (
            <View
              key={day}
              style={[
                styles.stripPill,
                isToday && styles.stripPillToday,
                isPast && styles.stripPillPast,
              ]}
            >
              <Text style={[styles.stripDay, isToday && styles.stripDayToday]}>D{day}</Text>
              <Text style={[styles.stripCoin, isToday && styles.stripCoinToday]}>
                {baseReward + milestone}
              </Text>
              {milestone > 0 ? <Text style={styles.stripStar}>★</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center", alignItems: "center", padding: 20,
  },
  card: {
    width: "100%", maxWidth: 380, backgroundColor: "#fff",
    borderRadius: 24, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  header: {
    paddingTop: 22, paddingBottom: 18, paddingHorizontal: 20,
    alignItems: "center",
  },
  headerEmoji: { fontSize: 38, marginBottom: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.85)", marginTop: 2 },

  body: { padding: 22, alignItems: "center" },
  coinRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  coinIcon: { width: 36, height: 36 },
  bigNumber: { fontSize: 44, fontFamily: "Poppins_700Bold", color: "#111329", letterSpacing: -1 },
  bodyHint: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#75768A", marginTop: 8, textAlign: "center" },

  milestoneBadge: {
    marginTop: 14, paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: "rgba(255,201,60,0.15)", borderRadius: 999,
    borderWidth: 1, borderColor: "rgba(255,201,60,0.5)",
  },
  milestoneTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#A56A00" },

  celebrationSub: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#75768A", marginTop: 6 },
  celebrationBonus: { color: COIN_GOLD, fontFamily: "Poppins_700Bold" },

  // P2: lucky-wheel multiplier reveal
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
  balanceLine: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#111329", marginTop: 12 },
  balanceVal: { fontFamily: "Poppins_700Bold", color: "#8400FF" },

  // Schedule strip
  stripWrap: { paddingHorizontal: 20, paddingBottom: 6 },
  stripLabel: {
    fontSize: 11, fontFamily: "Poppins_600SemiBold", color: "#75768A",
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
  },
  stripRow: { gap: 8, paddingRight: 4 },
  stripPill: {
    width: 48, paddingVertical: 8, borderRadius: 12,
    backgroundColor: "#F4F1FA", alignItems: "center",
    borderWidth: 1, borderColor: "transparent",
  },
  stripPillToday: { backgroundColor: "rgba(132,0,255,0.12)", borderColor: "#8400FF" },
  stripPillPast: { backgroundColor: "#EDEDEF", opacity: 0.6 },
  stripDay: { fontSize: 10, fontFamily: "Poppins_500Medium", color: "#75768A" },
  stripDayToday: { color: "#8400FF" },
  stripCoin: { fontSize: 14, fontFamily: "Poppins_700Bold", color: "#111329", marginTop: 2 },
  stripCoinToday: { color: "#8400FF" },
  stripStar: { position: "absolute", top: 4, right: 4, fontSize: 9, color: COIN_GOLD },

  // Repair / at-risk banners
  repairBanner: {
    marginHorizontal: 20, marginBottom: 6, padding: 14, borderRadius: 14,
    backgroundColor: "rgba(255,71,87,0.08)", borderWidth: 1, borderColor: "rgba(255,71,87,0.35)",
    alignItems: "center",
  },
  repairTitle: { fontSize: 14, fontFamily: "Poppins_700Bold", color: "#E23744" },
  repairSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#75768A", textAlign: "center", marginTop: 4 },
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
  skipBtnTxt: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#75768A" },
  primaryBtnWrap: { flex: 1 },
  primaryBtn: { paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  primaryBtnTxt: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#fff" },
});
