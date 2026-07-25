// DepositStatusTimeline — production-grade progress timeline shown after a user
// submits a manual (UPI/QR) deposit, so they always know exactly what happens
// next instead of just seeing a one-line "under review" message.
//
// Stages: Payment Submitted → Under Review → Coins Credited
//   - Auto-approved deposit  → all three steps complete instantly.
//   - Manual review deposit  → Submitted done, Under Review in-progress,
//                              Credited upcoming.
//
// Fully localized (reuses existing checkout strings, with English fallbacks so
// it never renders blank) and theme-aware. Drop it into the deposit success
// state; no new backend data required.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";

const DONE_COLOR = "#0BAF23";
const ACTIVE_COLOR = "#A00EE7";

interface Props {
  /** True when the deposit was auto-approved and coins are already credited. */
  credited?: boolean;
}

export function DepositStatusTimeline({ credited = false }: Props) {
  const colors = useColors();
  const { t } = useLanguage();

  const c = t.checkout as Record<string, string>;
  const steps: { key: string; label: string; desc: string }[] = [
    {
      key: "submitted",
      label: (c.paymentSubmitted ?? "Payment Submitted").replace(/!$/, ""),
      desc: c.submittedForReview ?? "We received your payment proof",
    },
    {
      key: "review",
      label: c.pendingReview ?? "Under Review",
      desc: c.adminApprovalNote ?? "Our team is verifying your payment",
    },
    {
      key: "credited",
      label: (c.coinsAdded ?? "Coins Credited").replace(/!$/, ""),
      desc: c.coinsAddedWallet
        ? c.coinsAddedWallet.replace("{count}", "").replace(/\s+/g, " ").trim()
        : "Coins added to your balance",
    },
  ];

  // Which steps are complete. Auto-approved → everything done; otherwise only
  // "Submitted" is done and "Under Review" is the step currently in progress.
  const doneIdx = credited ? 2 : 0;
  const inProgressIdx = credited ? -1 : 1;

  return (
    <View style={styles.wrap}>
      {steps.map((step, i) => {
        const done = i <= doneIdx;
        const active = i === inProgressIdx;
        const isLast = i === steps.length - 1;
        const dotColor = done ? DONE_COLOR : active ? ACTIVE_COLOR : colors.border;
        const lineColor = i < doneIdx ? DONE_COLOR : colors.border;
        const labelColor = done || active ? colors.text : colors.mutedForeground;
        return (
          <View key={step.key} style={styles.row}>
            <View style={styles.indicator}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done ? DONE_COLOR : active ? ACTIVE_COLOR : "transparent",
                    borderColor: dotColor,
                  },
                ]}
              >
                {done ? (
                  <Feather name="check" size={12} color="#fff" />
                ) : active ? (
                  <View style={styles.activeDot} />
                ) : null}
              </View>
              {!isLast && <View style={[styles.line, { backgroundColor: lineColor }]} />}
            </View>
            <View style={styles.body}>
              <View style={styles.headerRow}>
                <Text style={[styles.label, { color: labelColor }]}>{step.label}</Text>
                {active ? <View style={[styles.pulseTag, { backgroundColor: ACTIVE_COLOR }]} /> : null}
              </View>
              <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>
                {step.desc}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", paddingVertical: 4 },
  row: { flexDirection: "row", gap: 12 },
  indicator: { alignItems: "center", width: 24 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  line: { width: 2, flex: 1, minHeight: 24, marginVertical: 2 },
  body: { flex: 1, paddingBottom: 18 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 14.5, fontFamily: "Poppins_600SemiBold" },
  pulseTag: { width: 7, height: 7, borderRadius: 4 },
  desc: { fontSize: 11.5, fontFamily: "Poppins_400Regular", marginTop: 2, lineHeight: 16 },
});
