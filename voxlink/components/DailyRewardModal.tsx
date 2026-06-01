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

import React, { useEffect, useRef } from "react";
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
}

export default function DailyRewardModal({
  visible,
  status,
  lastClaim,
  claiming,
  onClaim,
  onClose,
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
            <CelebrationBody result={lastClaim} />
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

function CelebrationBody({ result }: { result: DailyStreakClaimResult }) {
  return (
    <View style={styles.body}>
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
    </View>
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

  // CTA
  ctaRow: { flexDirection: "row", gap: 10, padding: 20, paddingTop: 14 },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 18 },
  skipBtnTxt: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#75768A" },
  primaryBtnWrap: { flex: 1 },
  primaryBtn: { paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  primaryBtnTxt: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#fff" },
});
