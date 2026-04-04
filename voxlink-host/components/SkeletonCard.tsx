import React, { useEffect, useRef } from "react";
import { Animated, View, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

function Pulse({ style }: { style: any }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return <Animated.View style={[style, { opacity }]} />;
}

export function SkeletonStatsCard() {
  const colors = useColors();
  const base = colors.muted ?? "#E0E0E0";

  return (
    <View style={[styles.statsCard, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          <View style={styles.stat}>
            <Pulse style={[styles.valueSkeleton, { backgroundColor: base }]} />
            <Pulse style={[styles.labelSkeleton, { backgroundColor: base }]} />
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  statsCard: {
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginBottom: 16,
  },
  stat: { alignItems: "center", gap: 6 },
  divider: { width: 1, height: 40 },
  valueSkeleton: { width: 60, height: 22, borderRadius: 6 },
  labelSkeleton: { width: 50, height: 12, borderRadius: 4 },
});
