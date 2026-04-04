// OPTIMIZATION #8: Skeleton loading screens — users see a structural preview instead of
// a blank screen or spinner. This dramatically improves perceived performance because
// the layout feels ready before data arrives.
import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Dimensions } from "react-native";

const SCREEN_W = Dimensions.get("window").width;

function Pulse({ style }: { style?: object }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  return <Animated.View style={[{ opacity: anim, backgroundColor: "#E8E0F0" }, style]} />;
}

export function SkeletonHostCard() {
  return (
    <View style={styles.card}>
      <Pulse style={styles.avatar} />
      <View style={styles.body}>
        <Pulse style={styles.nameLine} />
        <Pulse style={styles.bioLine} />
        <View style={styles.row}>
          <Pulse style={styles.chip} />
          <Pulse style={styles.chip} />
        </View>
        <View style={styles.bottom}>
          <Pulse style={styles.rateTag} />
          <View style={styles.buttons}>
            <Pulse style={styles.btn} />
            <Pulse style={styles.btn} />
          </View>
        </View>
      </View>
    </View>
  );
}

export function SkeletonHostCardCompact() {
  return (
    <View style={styles.compact}>
      <Pulse style={styles.compactAvatar} />
      <View style={styles.compactBody}>
        <Pulse style={styles.compactName} />
        <Pulse style={styles.compactSub} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: "#FFF",
    borderRadius: 14,
    marginBottom: 12,
    padding: 12,
    gap: 10,
  },
  avatar: { width: 88, height: 108, borderRadius: 10, flexShrink: 0 },
  body: { flex: 1, gap: 8 },
  nameLine: { height: 16, borderRadius: 8, width: "60%" },
  bioLine: { height: 12, borderRadius: 6, width: "90%" },
  row: { flexDirection: "row", gap: 6 },
  chip: { height: 22, width: 60, borderRadius: 11 },
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rateTag: { height: 20, width: 70, borderRadius: 10 },
  buttons: { flexDirection: "row", gap: 6 },
  btn: { width: 40, height: 32, borderRadius: 8 },
  compact: {
    width: 80,
    alignItems: "center",
    gap: 6,
    marginRight: 10,
  },
  compactAvatar: { width: 64, height: 64, borderRadius: 32 },
  compactName: { height: 10, width: 56, borderRadius: 5 },
  compactSub: { height: 8, width: 40, borderRadius: 4 },
});
