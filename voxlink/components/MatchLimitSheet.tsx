import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// Brand gradient — matches the random-match screen's accent.
const GRAD: [string, string] = ["#CF00FD", "#8400FF"];

interface Props {
  visible: boolean;
  /** Leading emoji/icon for the sheet (e.g. 📅 / ⏳ / 🚦). */
  emoji: string;
  /** Main human-readable reason the search was stopped. */
  message: string;
  /**
   * Seconds until the user may retry. When > 0 a live countdown is shown and
   * the "Try Again" button stays disabled until it reaches 0. Omitted (or 0)
   * for non-time-bound limits like the daily cap, where only a close button
   * is shown.
   */
  retryAfterSec?: number;
  /** i18n template containing "{time}", e.g. "Try again in {time}". */
  retryInTemplate: string;
  /** Label for the retry button (e.g. "Try Again"). */
  retryLabel: string;
  /** Label for the dismiss button (e.g. "OK"). */
  closeLabel: string;
  /** Fired when the user taps the (enabled) retry button. */
  onRetry?: () => void;
  onClose: () => void;
}

/** mm:ss for >= 60s, otherwise "Ns". */
function formatTime(totalSec: number): string {
  if (totalSec >= 60) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return `${totalSec}s`;
}

/**
 * Bottom-sheet shown when a random-match search is hard-stopped by a 429-family
 * limit (rate limit / daily cap / decline cooldown). For time-bound limits it
 * ticks a countdown and enables "Try Again" once the cooldown elapses, so the
 * user can resume without leaving the screen.
 */
export function MatchLimitSheet({
  visible,
  emoji,
  message,
  retryAfterSec,
  retryInTemplate,
  retryLabel,
  closeLabel,
  onRetry,
  onClose,
}: Props) {
  const hasCountdown = typeof retryAfterSec === "number" && retryAfterSec > 0;
  const [remaining, setRemaining] = useState(retryAfterSec ?? 0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible || !hasCountdown) return;
    setRemaining(retryAfterSec ?? 0);
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [visible, retryAfterSec, hasCountdown]);

  const canRetry = hasCountdown && remaining <= 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose}>
        <View style={st.sheet} onStartShouldSetResponder={() => true}>
          <View style={st.handle} />
          <Text style={st.emoji}>{emoji}</Text>
          <Text style={st.message}>{message}</Text>

          {hasCountdown && remaining > 0 && (
            <Text style={st.countdown}>
              {retryInTemplate.replace("{time}", formatTime(remaining))}
            </Text>
          )}

          {hasCountdown && (
            <TouchableOpacity
              onPress={() => { if (canRetry) { onClose(); onRetry?.(); } }}
              activeOpacity={canRetry ? 0.85 : 1}
              disabled={!canRetry}
              style={st.primaryBtnWrap}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canRetry }}
            >
              <LinearGradient
                colors={canRetry ? GRAD : ["#D9CCE6", "#D9CCE6"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={st.primaryBtn}
              >
                <Text style={st.primaryBtnTxt}>{retryLabel}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={onClose} style={st.closeBtn} activeOpacity={0.85}>
            <Text style={st.closeBtnTxt}>{closeLabel}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 30,
    alignItems: "center",
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", marginTop: 10, marginBottom: 18 },
  emoji: { fontSize: 44, marginBottom: 10 },
  message: {
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
    color: "#111329",
    textAlign: "center",
    lineHeight: 22,
  },
  countdown: {
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
    color: "#8400FF",
    textAlign: "center",
    marginTop: 10,
  },
  primaryBtnWrap: { width: "100%", marginTop: 18 },
  primaryBtn: { paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  primaryBtnTxt: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#fff" },
  closeBtn: { width: "100%", paddingVertical: 12, borderRadius: 12, alignItems: "center", marginTop: 6 },
  closeBtnTxt: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#6B7280" },
});
