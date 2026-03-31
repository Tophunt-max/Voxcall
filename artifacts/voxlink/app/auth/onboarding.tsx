import React, { useState, useRef } from "react";
import { View, Text, StyleSheet, Dimensions, FlatList, TouchableOpacity, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    id: "1",
    icon: "headphones",
    title: "Connect with Listeners",
    description: "Find caring, professional hosts ready to listen. Browse by specialty, language, and availability.",
  },
  {
    id: "2",
    icon: "video",
    title: "Audio & Video Calls",
    description: "Talk your way. Choose crystal-clear audio or face-to-face video calls at any time.",
  },
  {
    id: "3",
    icon: "message-circle",
    title: "Chat Anytime",
    description: "Send messages and continue conversations beyond the call. Build meaningful connections.",
  },
  {
    id: "4",
    icon: "award",
    title: "Become a Host",
    description: "Share your expertise and earn coins. Help others while growing your personal brand.",
  },
];

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(0);
  const listRef = useRef<FlatList>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const next = () => {
    if (current < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: current + 1 });
      setCurrent(current + 1);
    } else {
      router.replace("/auth/login");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={(e) => {
          setCurrent(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + "18" }]}>
              <Feather name={item.icon as any} size={56} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>{item.title}</Text>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>{item.description}</Text>
          </View>
        )}
      />

      <View style={[styles.bottom, { paddingBottom: bottomPad + 20 }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: i === current ? colors.primary : colors.border, width: i === current ? 24 : 8 }]} />
          ))}
        </View>
        <TouchableOpacity onPress={next} style={[styles.btn, { backgroundColor: colors.primary }]} activeOpacity={0.85}>
          <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
            {current === SLIDES.length - 1 ? "Get Started" : "Next"}
          </Text>
          <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
        </TouchableOpacity>
        {current < SLIDES.length - 1 && (
          <TouchableOpacity onPress={() => router.replace("/auth/login")} style={styles.skip}>
            <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 20 },
  iconCircle: { width: 120, height: 120, borderRadius: 60, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center", lineHeight: 36 },
  desc: { fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },
  bottom: { paddingHorizontal: 24, gap: 16, alignItems: "center" },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { height: 8, borderRadius: 4 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14, width: "100%" },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  skip: { paddingVertical: 8 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
