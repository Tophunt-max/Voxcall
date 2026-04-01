import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Dimensions,
} from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SW, height: SH } = Dimensions.get("window");

const SUBTITLE_COLOR = "#757396";
const DOTS_COUNT = 5;
const SPLASH_DURATION = 2800; // ms

/* ─── Staggered dots wave animation (exact Flutter LoadingAnimationWidget.staggeredDotsWave) ─── */
function StaggeredDotsWave() {
  const anims = useRef(Array.from({ length: DOTS_COUNT }, () => new Animated.Value(0))).current;

  useEffect(() => {
    const createWave = () => {
      const animations = anims.map((anim, i) =>
        Animated.sequence([
          Animated.delay(i * 120),
          Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: false }),
          Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: false }),
        ])
      );
      Animated.loop(
        Animated.parallel(animations)
      ).start();
    };
    createWave();
  }, []);

  return (
    <View style={dot.row}>
      {anims.map((anim, i) => {
        const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
        const size = anim.interpolate({ inputRange: [0, 1], outputRange: [9, 11] });
        return (
          <Animated.View
            key={i}
            style={[
              dot.dot,
              {
                width: size,
                height: size,
                borderRadius: 6,
                transform: [{ translateY }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const dot = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6 },
  dot: { backgroundColor: "#000" },
});

/* ─── Main Splash Screen ─── */
export default function Index() {
  const { isLoggedIn, isLoading, user } = useAuth();
  const [splashDone, setSplashDone] = useState(false);
  const [seenOnboarding, setSeenOnboarding] = useState<boolean | null>(null);
  const [hostAppPending, setHostAppPending] = useState<boolean | null>(null);

  const fadeIn = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    // Check onboarding + host app pending state
    AsyncStorage.getItem("seenOnboarding").then((val) => {
      setSeenOnboarding(val === "true");
    });
    AsyncStorage.getItem("hostAppPending").then((val) => {
      setHostAppPending(val === "true");
    });

    // Fade in animation
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: false }),
      Animated.spring(logoScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: false }),
    ]).start();

    // Navigate after SPLASH_DURATION
    const timer = setTimeout(() => {
      setSplashDone(true);
    }, SPLASH_DURATION);
    return () => clearTimeout(timer);
  }, []);

  /* ─── Route after splash ─── */
  if (splashDone && !isLoading && seenOnboarding !== null && hostAppPending !== null) {
    if (isLoggedIn && user) {
      if (user.role === "host") return <Redirect href="/host/screens/host" />;
      // User registered as host but still pending admin approval
      if (hostAppPending) return <Redirect href="/host/auth/host-status" />;
      return <Redirect href="/user/screens/user" />;
    }
    if (seenOnboarding) return <Redirect href="/shared/auth/role-select" />;
    return <Redirect href="/shared/auth/onboarding" />;
  }

  /* ─── Splash UI ─── */
  return (
    <View style={s.root}>
      {/* Full cover splash background */}
      <Image
        source={require("@/assets/images/splash_bg.png")}
        style={s.bgImg}
        resizeMode="cover"
      />

      <Animated.View style={[s.content, { opacity: fadeIn }]}>
        {/* Spacer top */}
        <View style={{ flex: 1 }} />

        {/* Centered logo */}
        <Animated.Image
          source={require("@/assets/images/splash_logo.png")}
          style={[s.logo, { transform: [{ scale: logoScale }] }]}
          resizeMode="contain"
        />

        {/* Spacer middle */}
        <View style={{ flex: 1 }} />

        {/* App name + subtitle */}
        <View style={s.textBlock}>
          <Text style={s.appName}>VoxLink</Text>
          <Text style={s.tagline}>Connect & establish meaningful connections</Text>
        </View>

        {/* Staggered dots wave loading */}
        <View style={s.dotsWrap}>
          <StaggeredDotsWave />
        </View>

        <View style={{ height: 20 }} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  bgImg: {
    ...StyleSheet.absoluteFillObject,
    width: SW,
    height: SH,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  logo: {
    width: 170,
    height: 170,
  },
  textBlock: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 24,
  },
  appName: {
    fontSize: 29,
    fontFamily: "Poppins_600SemiBold",
    color: "#000",
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Poppins_400Regular",
    color: SUBTITLE_COLOR,
    textAlign: "center",
    paddingBottom: 20,
  },
  dotsWrap: {
    paddingTop: 4,
  },
});
