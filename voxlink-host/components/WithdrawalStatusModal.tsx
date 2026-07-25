// WithdrawalStatusModal — production-grade status popup for a host's in-flight
// (or recently-resolved) withdrawal request. Shown when the host taps the
// "Withdrawal in progress" button on the wallet screen, so they always know
// exactly where their payout stands instead of staring at a disabled button.
//
// Renders inside a transparent RN <Modal> (top-most on every screen, web +
// native) with a branded, animated card showing:
//   - amount (coins + real-money payout value)
//   - a status badge (pending / approved / paid / rejected)
//   - a vertical progress timeline: Requested → Approved → Paid
//   - the payout destination the money is being sent to
//   - an ETA / helpful note, or the rejection reason when declined
//
// Fully theme-aware and accessible. No new backend data required — everything
// comes from the withdrawal record the wallet already loads.

import React, { useEffect, useRef } from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform } from "react-native";
import { SvgIcon, type SvgIconName } from "@/components/SvgIcon";
import { useColors } from "@/hooks/useColors";

const useNativeDriverValue = Platform.OS !== "web";

export type WithdrawalStatus = "pending" | "approved" | "paid" | "rejected";

export interface WithdrawalRecord {
  id: string;
  coins: number;
  status: WithdrawalStatus | string;
  created_at?: number;
  updated_at?: number;
  // Optional admin-provided reason when a withdrawal is rejected. Different
  // backends name this differently, so we read the first that's present.
  rejection_reason?: string | null;
  reason?: string | null;
  admin_note?: string | null;
  note?: string | null;
}

interface Props {
  visible: boolean;
  withdrawal: WithdrawalRecord | null;
  /** e.g. "PhonePe" */
  payoutLabel?: string;
  /** e.g. "••••4845" */
  payoutSummary?: string;
  /** Pre-formatted real-money value, e.g. "₹84". */
  payoutValue?: string;
  onClose: () => void;
  /** Called from the rejected state so the host can start a fresh request. */
  onRequestNew?: () => void;
}

const STATUS_META: Record<
  WithdrawalStatus,
  { label: string; color: string; bg: string; icon: SvgIconName }
> = {
  pending:  { label: "Pending Review",       color: "#B26A00", bg: "#FFF3D6", icon: "clock" },
  approved: { label: "Approved · Paying out", color: "#0078CC", bg: "#D5EEFF", icon: "arrow-up-circle" },
  paid:     { label: "Paid",                  color: "#0BAF23", bg: "#E8F8EC", icon: "check-circle" },
  rejected: { label: "Rejected",              color: "#F44336", bg: "#FDE8E8", icon: "alert-circle" },
};

const STEPS: { key: string; label: string; desc: string }[] = [
  { key: "requested", label: "Requested", desc: "Your request was submitted" },
  { key: "approved",  label: "Approved",  desc: "Reviewed & approved by our team" },
  { key: "paid",      label: "Paid",      desc: "Sent to your payout account" },
];

// How many steps are fully complete for a given status (index into STEPS).
function completedUpTo(status: WithdrawalStatus): number {
  switch (status) {
    case "pending": return 0;   // Requested done; approval pending
    case "approved": return 1;  // Requested + Approved done; payout pending
    case "paid": return 2;      // All done
    default: return 0;
  }
}

function normalizeStatus(s: string): WithdrawalStatus {
  return (["pending", "approved", "paid", "rejected"].includes(s) ? s : "pending") as WithdrawalStatus;
}

function formatWhen(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays <= 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function WithdrawalStatusModal({
  visible,
  withdrawal,
  payoutLabel,
  payoutSummary,
  payoutValue,
  onClose,
  onRequestNew,
}: Props) {
  const colors = useColors();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      anim.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        tension: 120,
        friction: 12,
        useNativeDriver: useNativeDriverValue,
      }).start();
    }
  }, [visible, anim]);

  if (!withdrawal) return null;

  const status = normalizeStatus(String(withdrawal.status));
  const meta = STATUS_META[status];
  const rejected = status === "rejected";
  const doneIdx = completedUpTo(status);
  const inProgressIdx = status === "paid" ? -1 : doneIdx + 1; // step currently being worked on
  const rejectionReason =
    withdrawal.rejection_reason || withdrawal.reason || withdrawal.admin_note || withdrawal.note || "";

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              ],
            },
          ]}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={[styles.statusIconWrap, { backgroundColor: meta.bg }]}>
              <SvgIcon name={meta.icon} size={22} color={meta.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>Withdrawal Status</Text>
              <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </View>
          </View>

          {/* Amount */}
          <View style={[styles.amountBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.amountCoins, { color: colors.text }]}>
              {withdrawal.coins.toLocaleString()} <Text style={styles.amountUnit}>coins</Text>
            </Text>
            {payoutValue ? (
              <Text style={[styles.amountMoney, { color: colors.mutedForeground }]}>≈ {payoutValue}</Text>
            ) : null}
          </View>

          {/* Timeline OR rejected notice */}
          {rejected ? (
            <View style={[styles.rejectBox, { backgroundColor: "#FDECEC", borderColor: "#F5B5B5" }]}>
              <Text style={[styles.rejectTitle, { color: "#C62828" }]}>Request declined</Text>
              <Text style={[styles.rejectText, { color: "#8A3B3B" }]}>
                {rejectionReason
                  ? rejectionReason
                  : "This withdrawal was rejected. Your coins have been returned to your balance."}
              </Text>
            </View>
          ) : (
            <View style={styles.timeline}>
              {STEPS.map((step, i) => {
                const done = i <= doneIdx;
                const current = i === inProgressIdx;
                const isLast = i === STEPS.length - 1;
                const dotColor = done ? "#0BAF23" : current ? meta.color : colors.border;
                const lineColor = i < doneIdx ? "#0BAF23" : colors.border;
                const labelColor = done || current ? colors.text : colors.mutedForeground;
                return (
                  <View key={step.key} style={styles.stepRow}>
                    <View style={styles.stepIndicator}>
                      <View
                        style={[
                          styles.stepDot,
                          {
                            backgroundColor: done ? "#0BAF23" : current ? meta.color : "transparent",
                            borderColor: dotColor,
                          },
                        ]}
                      >
                        {done ? (
                          <SvgIcon name="check-circle" size={12} color="#fff" />
                        ) : current ? (
                          <View style={styles.pulseDot} />
                        ) : null}
                      </View>
                      {!isLast && <View style={[styles.stepLine, { backgroundColor: lineColor }]} />}
                    </View>
                    <View style={styles.stepBody}>
                      <View style={styles.stepHeaderRow}>
                        <Text style={[styles.stepLabel, { color: labelColor }]}>{step.label}</Text>
                        {current ? (
                          <Text style={[styles.stepTag, { color: meta.color }]}>In progress</Text>
                        ) : done && i === doneIdx ? (
                          <Text style={[styles.stepTime, { color: colors.mutedForeground }]}>
                            {i === 0 ? formatWhen(withdrawal.created_at) : formatWhen(withdrawal.updated_at)}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[styles.stepDesc, { color: colors.mutedForeground }]}>{step.desc}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Payout destination */}
          {payoutLabel ? (
            <View style={[styles.payoutRow, { borderColor: colors.border }]}>
              <View style={[styles.payoutIconWrap, { backgroundColor: colors.surface }]}>
                <SvgIcon name="credit-card" size={18} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.payoutLabel, { color: colors.mutedForeground }]}>Payout to</Text>
                <Text style={[styles.payoutValue, { color: colors.text }]} numberOfLines={1}>
                  {payoutLabel}
                  {payoutSummary ? `  ·  ${payoutSummary}` : ""}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Footer note */}
          {!rejected ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {status === "paid"
                ? "This payout has been completed. Thank you!"
                : "Payouts are usually completed within 2–3 business days. You'll be notified once it's paid."}
            </Text>
          ) : null}

          {/* Actions */}
          {rejected && onRequestNew ? (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              onPress={() => { onClose(); onRequestNew(); }}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>Request Again</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.secondaryBtn, { backgroundColor: colors.surface }]}
              onPress={onClose}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Got it</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    ...(Platform.OS === "web" ? { position: "fixed" as any } : null),
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    padding: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 14,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  statusIconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Poppins_700Bold", marginBottom: 4 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11.5, fontFamily: "Poppins_600SemiBold" },

  amountBox: { borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18, alignItems: "center", marginBottom: 18, gap: 2 },
  amountCoins: { fontSize: 26, fontFamily: "Poppins_700Bold" },
  amountUnit: { fontSize: 14, fontFamily: "Poppins_500Medium" },
  amountMoney: { fontSize: 13, fontFamily: "Poppins_500Medium" },

  timeline: { marginBottom: 6 },
  stepRow: { flexDirection: "row", gap: 12 },
  stepIndicator: { alignItems: "center", width: 24 },
  stepDot: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  stepLine: { width: 2, flex: 1, minHeight: 26, marginVertical: 2 },
  stepBody: { flex: 1, paddingBottom: 18 },
  stepHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  stepLabel: { fontSize: 14.5, fontFamily: "Poppins_600SemiBold" },
  stepTag: { fontSize: 11.5, fontFamily: "Poppins_600SemiBold" },
  stepTime: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  stepDesc: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 1 },

  rejectBox: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16, gap: 4 },
  rejectTitle: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  rejectText: { fontSize: 12.5, fontFamily: "Poppins_400Regular", lineHeight: 18 },

  payoutRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
  payoutIconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  payoutLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  payoutValue: { fontSize: 14, fontFamily: "Poppins_600SemiBold", marginTop: 1 },

  note: { fontSize: 12, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 18, marginBottom: 16 },

  primaryBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  secondaryBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  secondaryBtnText: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
