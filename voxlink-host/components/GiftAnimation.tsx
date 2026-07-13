import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View, Easing } from "react-native";

// Full-screen gift "reveal" overlay shown when the caller sends a gift during a
// call: the gift emoji pops in, hangs, then floats up and fades. Pointer-
// transparent so it never blocks call controls. Drive it with a NEW `gift`
// (bump `key`) per gift; `onDone` clears it.
export interface GiftAnim {
  icon: string;
  name?: string;
  senderName?: string;
  key: number;
}

export function GiftAnimation({ gift, onDone }: { gift: GiftAnim | null; onDone: () => void }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!gift) return;
    translateY.setValue(0);
    scale.setValue(0.3);
    opacity.setValue(0);
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]),
      Animated.delay(950),
      Animated.parallel([
        Animated.timing(translateY, { toValue: -180, duration: 750, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 750, useNativeDriver: true }),
      ]),
    ]);
    anim.start(({ finished }) => { if (finished) onDone(); });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gift?.key]);

  if (!gift) return null;
  const caption = gift.senderName
    ? `${gift.senderName} sent ${gift.name ?? "a gift"} ${gift.icon}`
    : gift.name ?? "";
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Animated.View style={[styles.box, { opacity, transform: [{ translateY }, { scale }] }]}>
        <Text style={styles.emoji}>{gift.icon}</Text>
        {!!caption && <Text style={styles.caption}>{caption}</Text>}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 50 },
  box: { alignItems: "center", justifyContent: "center", gap: 8 },
  emoji: { fontSize: 96, lineHeight: 108, textShadowColor: "rgba(0,0,0,0.25)", textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 10 },
  caption: {
    color: "#fff", fontSize: 14, fontFamily: "Poppins_600SemiBold", textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, overflow: "hidden",
  },
});
