import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  TouchableOpacity,
  Image,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const { width, height } = Dimensions.get("window");

const SLIDES = [
  {
    id: "1",
    image: require("@/assets/images/onBoarding1.png"),
    title: "Connect with Listeners",
    description:
      "Find caring, professional listeners ready to hear you out. Browse by specialty, language, and availability.",
  },
  {
    id: "2",
    image: require("@/assets/images/onBoarding2.png"),
    title: "Audio & Video Calls",
    description:
      "Talk your way. Choose crystal-clear audio or face-to-face video calls with our verified listeners.",
  },
  {
    id: "3",
    image: require("@/assets/images/onBoarding3.png"),
    title: "Your Privacy Matters",
    description:
      "All conversations are private and secure. Connect anonymously and speak freely without judgment.",
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

  const skip = () => router.replace("/auth/login");

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
            <View style={[styles.imageContainer, { marginTop: topPad + 20 }]}>
              <Image source={item.image} style={styles.slideImage} resizeMode="contain" />
            </View>
            <View style={styles.textContainer}>
              <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
              <Text style={[styles.desc, { color: colors.mutedForeground }]}>{item.description}</Text>
            </View>
          </View>
        )}
      />

      <View style={[styles.bottom, { paddingBottom: bottomPad + 24 }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === current ? colors.primary : colors.border,
                  width: i === current ? 24 : 8,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.buttonRow}>
          {current < SLIDES.length - 1 ? (
            <>
              <TouchableOpacity onPress={skip} style={[styles.skipBtn, { borderColor: colors.border }]}>
                <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={next} style={[styles.nextBtn, { backgroundColor: colors.primary }]} activeOpacity={0.85}>
                <Image source={require("@/assets/images/on_boarding_arrow.png")} style={styles.arrowIcon} resizeMode="contain" />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={next} style={[styles.getStartedBtn, { backgroundColor: colors.primary }]} activeOpacity={0.85}>
              <Text style={[styles.getStartedText, { color: "#fff" }]}>Get Started</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: { alignItems: "center" },
  imageContainer: {
    width: width,
    height: height * 0.48,
    alignItems: "center",
    justifyContent: "center",
  },
  slideImage: {
    width: width * 0.85,
    height: height * 0.44,
  },
  textContainer: {
    paddingHorizontal: 32,
    alignItems: "center",
    marginTop: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontFamily: "Poppins_700Bold",
    textAlign: "center",
    lineHeight: 32,
  },
  desc: {
    fontSize: 14,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  bottom: {
    paddingHorizontal: 24,
    gap: 24,
    alignItems: "center",
  },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { height: 8, borderRadius: 4 },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 16,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1.5,
  },
  skipText: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  nextBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowIcon: { width: 24, height: 24, tintColor: "#fff" },
  getStartedBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  getStartedText: { fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
