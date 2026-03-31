import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  TouchableOpacity,
  Image,
  Animated,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SW, height: SH } = Dimensions.get("window");

/* ─── Exact Flutter strings ─── */
const SLIDES = [
  {
    id: "1",
    image: require("@/assets/images/onBoarding1.png"),
    title: "FIND",
    subTitle:
      "You can connect with the people around\nthe world for doing chat, messages and\nmake connections with them.",
  },
  {
    id: "2",
    image: require("@/assets/images/onBoarding2.png"),
    title: "CHAT",
    subTitle:
      "Chat with the strangers to know each\nother better and have a nice\ncompatibility.",
  },
  {
    id: "3",
    image: require("@/assets/images/onBoarding3.png"),
    title: "VIDEO CALL",
    subTitle:
      "You can share your videos and photos\nwith your friend and connections.",
  },
];

const APP_COLOR = "#111329";   // selected dot color
const UNSELECTED = "#D3D3D3";  // unselected dot color
const SUBTITLE_COLOR = "#757396"; // exact Flutter onBoardingTxt

/* ─── Each slide item ─── */
function OnboardingItem({ title, subTitle, image }: { title: string; subTitle: string; image: any }) {
  return (
    <View style={[item.wrap, { width: SW }]}>
      {/* Spacer top */}
      <View style={{ flex: 1 }} />

      {/* 3D image — exact Flutter: height 360, padding left/right 34 */}
      <Image
        source={image}
        style={item.img}
        resizeMode="contain"
      />

      {/* Title — exact Flutter: W800 40px black letterSpace */}
      <Text style={item.title} textBreakStrategy="simple">{title}</Text>

      {/* Subtitle — exact Flutter: W500 15px #757396 */}
      <Text style={item.sub}>{subTitle}</Text>
    </View>
  );
}

const item = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingHorizontal: 34,
  },
  img: {
    width: SW - 68,   // left 34 + right 34 = 68
    height: 360,
    marginBottom: SH * 0.02,
  },
  title: {
    fontSize: 40,
    fontFamily: "Poppins_700Bold",
    color: "#000",
    textAlign: "center",
    letterSpacing: SW * 0.013,
    marginBottom: 6,
    lineHeight: 48,
  },
  sub: {
    fontSize: 15,
    fontFamily: "Poppins_500Medium",
    color: SUBTITLE_COLOR,
    textAlign: "center",
    lineHeight: 24,
    paddingBottom: 30,
  },
});

/* ─── Main Onboarding Screen ─── */
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(0);
  const listRef = useRef<FlatList>(null);
  const dotWidths = useRef(SLIDES.map((_, i) => new Animated.Value(i === 0 ? 22 : 14))).current;

  /* Animate dots when page changes */
  const animateDots = (page: number) => {
    dotWidths.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: i === page ? 22 : 14,
        duration: 300,
        useNativeDriver: false,
      }).start();
    });
  };

  const onPageChange = (page: number) => {
    setCurrent(page);
    animateDots(page);
  };

  const onArrowTap = async () => {
    if (current < SLIDES.length - 1) {
      const next = current + 1;
      listRef.current?.scrollToIndex({ index: next, animated: true });
      onPageChange(next);
    } else {
      // Save that onboarding was seen
      await AsyncStorage.setItem("seenOnboarding", "true");
      router.replace("/shared/auth/role-select");
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* PageView */}
      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(it) => it.id}
        onMomentumScrollEnd={(e) => {
          const page = Math.round(e.nativeEvent.contentOffset.x / SW);
          onPageChange(page);
        }}
        renderItem={({ item: slide }) => (
          <OnboardingItem
            title={slide.title}
            subTitle={slide.subTitle}
            image={slide.image}
          />
        )}
        style={{ flex: 1 }}
      />

      {/* Bottom: dots + arrow — exact Flutter Stack layout */}
      <View style={[s.bottom, { paddingBottom: insets.bottom + 8 }]}>
        {/* Dot indicators — left aligned with padding left 18, bottom 53 */}
        <View style={s.dotsRow}>
          {SLIDES.map((_, i) => (
            <Animated.View
              key={i}
              style={[
                s.dot,
                {
                  width: dotWidths[i],
                  backgroundColor: i === current ? APP_COLOR : UNSELECTED,
                },
              ]}
            />
          ))}
        </View>

        {/* Arrow button — exact Flutter: right: -5% of screen, 100x100 */}
        <TouchableOpacity
          onPress={onArrowTap}
          activeOpacity={0.85}
          style={s.arrowBtn}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Image
            source={require("@/assets/images/on_boarding_arrow.png")}
            style={s.arrowImg}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },

  /* ── Bottom bar ── */
  bottom: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingLeft: 18,
    /* exact Flutter: paddingOnly(top: Get.height * 0.1) */
    paddingTop: SH * 0.05,
    overflow: "hidden",
  },

  /* Dot indicators */
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingBottom: 53,
  },
  dot: {
    height: 4,
    borderRadius: 10,
  },

  /* Arrow */
  arrowBtn: {
    /* Flutter: right: Get.width * -0.05 → slightly off screen */
    marginRight: Platform.OS === "web" ? 0 : -SW * 0.05,
  },
  arrowImg: {
    width: 100,
    height: 100,
  },
});
