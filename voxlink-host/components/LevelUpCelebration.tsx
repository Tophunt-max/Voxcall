// LevelUpCelebration — global listener + celebratory modal for host level-ups.
//
// Mounted once in the (tabs) layout. Subscribes to the real-time HOST_LEVEL_UP
// socket event (emitted by the backend level-up engine) and, on receipt:
//   • refreshes the auth profile (coin balance) + level/earnings queries so the
//     dashboard reflects the new level and reward immediately, and
//   • pops a congratulatory modal showing the new badge, level name and reward.
//
// No extra animation libraries — uses RN's Animated for a lightweight pop-in.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated, Easing } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useSocketEvent } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";
import { SocketEvents } from "@/constants/events";

interface LevelUpData {
  oldLevel: number;
  newLevel: number;
  levelName: string;
  badge: string;
  color: string;
  coinsAwarded: number;
}

export default function LevelUpCelebration() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { refreshProfile } = useAuth();
  const [event, setEvent] = useState<LevelUpData | null>(null);

  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useSocketEvent<LevelUpData>(
    SocketEvents.HOST_LEVEL_UP,
    (data) => {
      if (!data) return;
      setEvent(data);
      // Pull fresh balance + level/earnings so the dashboard is consistent.
      refreshProfile().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["host-level"] });
      queryClient.invalidateQueries({ queryKey: ["host-earnings"] });
      queryClient.invalidateQueries({ queryKey: ["host-me"] });
      queryClient.invalidateQueries({ queryKey: ["host-notif-unread"] });
    },
    [refreshProfile, queryClient],
  );

  useEffect(() => {
    if (event) {
      scale.setValue(0.6);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [event, scale, opacity]);

  const dismiss = useCallback(() => setEvent(null), []);

  if (!event) return null;
  const accent = event.color || colors.accent;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: colors.card, opacity, transform: [{ scale }], borderColor: accent },
          ]}
        >
          <Text style={[styles.confetti]}>🎉✨🎊</Text>
          <View style={[styles.badgeCircle, { backgroundColor: accent }]}>
            <Text style={styles.badge}>{event.badge}</Text>
          </View>
          <Text style={[styles.title, { color: accent }]}>LEVEL UP!</Text>
          <Text style={[styles.levelName, { color: colors.text }]}>
            You're now {event.levelName}
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Level {event.oldLevel} → Level {event.newLevel}
          </Text>

          {event.coinsAwarded > 0 ? (
            <View style={[styles.reward, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={styles.rewardEmoji}>🪙</Text>
              <Text style={[styles.rewardText, { color: colors.coinGoldText }]}>
                +{event.coinsAwarded.toLocaleString()} coins reward
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: accent }]}
            onPress={dismiss}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Awesome!</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 28 },
  card: { width: "100%", maxWidth: 360, borderRadius: 24, padding: 24, alignItems: "center", borderWidth: 1.5, gap: 8 },
  confetti: { fontSize: 30, letterSpacing: 4, marginBottom: 4 },
  badgeCircle: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  badge: { fontSize: 52 },
  title: { fontSize: 24, fontFamily: "Poppins_700Bold", letterSpacing: 1 },
  levelName: { fontSize: 18, fontFamily: "Poppins_600SemiBold", textAlign: "center" },
  sub: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  reward: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, marginTop: 8 },
  rewardEmoji: { fontSize: 18 },
  rewardText: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  btn: { marginTop: 16, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
