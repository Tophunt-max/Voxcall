// AnimatedGiftIcon — self-contained, copyright-free animated gift icons drawn
// with react-native-svg. No image assets, no emoji, works on Android / iOS / web.
//
// Each gift is a hand-authored SVG (viewBox 0 0 48 48) wrapped in an Animated
// loop. Animations use the native driver (transform/opacity only) so they stay
// smooth on device. Reference a gift by its name, e.g. <AnimatedGiftIcon name="heart" />
//
// These are wired into GiftGlyph: an `icon` value of "svg:<name>" (e.g.
// "svg:heart") renders the matching animated gift here.

import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Path, Circle, Rect, G, Defs, LinearGradient, RadialGradient, Stop, Ellipse } from "react-native-svg";

export type AnimatedGiftName =
  | "heart"
  | "star"
  | "diamond"
  | "crown"
  | "gift-box"
  | "rose"
  | "fire"
  | "rocket"
  | "coin"
  | "trophy"
  | "sparkle"
  | "lollipop";

export const ANIMATED_GIFT_NAMES: AnimatedGiftName[] = [
  "heart",
  "star",
  "diamond",
  "crown",
  "gift-box",
  "rose",
  "fire",
  "rocket",
  "coin",
  "trophy",
  "sparkle",
  "lollipop",
];

// Human-friendly labels (used by pickers / admin presets).
export const ANIMATED_GIFT_LABELS: Record<AnimatedGiftName, string> = {
  heart: "Heart",
  star: "Star",
  diamond: "Diamond",
  crown: "Crown",
  "gift-box": "Gift Box",
  rose: "Rose",
  fire: "Fire",
  rocket: "Rocket",
  coin: "Coin",
  trophy: "Trophy",
  sparkle: "Sparkle",
  lollipop: "Lollipop",
};

type AnimKind = "beat" | "twinkle" | "spin" | "bounce" | "flicker" | "launch" | "swing";

// Which motion suits each gift.
const GIFT_ANIM: Record<AnimatedGiftName, AnimKind> = {
  heart: "beat",
  star: "twinkle",
  diamond: "twinkle",
  crown: "swing",
  "gift-box": "bounce",
  rose: "swing",
  fire: "flicker",
  rocket: "launch",
  coin: "spin",
  trophy: "beat",
  sparkle: "twinkle",
  lollipop: "spin",
};

interface Props {
  name: AnimatedGiftName;
  size?: number;
  /** Set false to render a static (non-animated) version. */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AnimatedGiftIcon({ name, size = 40, animate = true, style }: Props) {
  const kind = GIFT_ANIM[name] ?? "beat";
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) return;
    const duration =
      kind === "flicker" ? 700 : kind === "twinkle" ? 1400 : kind === "launch" ? 1600 : 1200;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: duration / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: duration / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, kind, t]);

  const animStyle = useMemo<Animated.WithAnimatedObject<ViewStyle>>(() => {
    switch (kind) {
      case "beat":
        return { transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] };
      case "twinkle":
        return {
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
          transform: [
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) },
            { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "18deg"] }) },
          ],
        };
      case "spin":
        return { transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] };
      case "bounce":
        return {
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.12] }) }],
        };
      case "flicker":
        return {
          transform: [
            { scaleY: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) },
            { scaleX: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }) },
          ],
        };
      case "launch":
        return {
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.14] }) },
            { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["-6deg", "6deg"] }) },
          ],
        };
      case "swing":
        return {
          transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["-9deg", "9deg"] }) }],
        };
      default:
        return {};
    }
  }, [kind, t, size]);

  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Animated.View style={animStyle}>
        <Svg width={size} height={size} viewBox="0 0 48 48">
          {renderGift(name)}
        </Svg>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG artwork
// ─────────────────────────────────────────────────────────────────────────────

function renderGift(name: AnimatedGiftName): React.ReactNode {
  switch (name) {
    case "heart":
      return (
        <>
          <Defs>
            <LinearGradient id="gHeart" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FF7EB3" />
              <Stop offset="1" stopColor="#FF2D6F" />
            </LinearGradient>
          </Defs>
          <Path
            d="M24 42S6 30.5 6 17.8C6 11.3 11 7 16.4 7c3.6 0 6.2 1.9 7.6 4.4C25.4 8.9 28 7 31.6 7 37 7 42 11.3 42 17.8 42 30.5 24 42 24 42z"
            fill="url(#gHeart)"
          />
          <Path d="M14 15c1.2-2.7 3.6-4 6-4" stroke="#FFD1E3" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.8} />
        </>
      );

    case "star":
      return (
        <>
          <Defs>
            <LinearGradient id="gStar" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFE47A" />
              <Stop offset="1" stopColor="#FFB300" />
            </LinearGradient>
          </Defs>
          <Path
            d="M24 4l6.1 12.4 13.7 2-9.9 9.7 2.3 13.6L24 35.3 11.8 41.7l2.3-13.6L4.2 18.4l13.7-2z"
            fill="url(#gStar)"
            stroke="#FF9800"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        </>
      );

    case "diamond":
      return (
        <>
          <Defs>
            <LinearGradient id="gDia" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#8EF6FF" />
              <Stop offset="1" stopColor="#2EA6FF" />
            </LinearGradient>
          </Defs>
          <Path d="M13 6h22l8 11-19 25L5 17z" fill="url(#gDia)" />
          <Path d="M13 6l6 11-9 0zM35 6l-6 11 9 0zM19 17h10l-5 25zM19 17l-9 0 14 25zM29 17l9 0-14 25z" fill="#FFFFFF" opacity={0.22} />
          <Path d="M13 6h22l8 11H5z" fill="#FFFFFF" opacity={0.14} />
        </>
      );

    case "crown":
      return (
        <>
          <Defs>
            <LinearGradient id="gCrown" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFE47A" />
              <Stop offset="1" stopColor="#FFB300" />
            </LinearGradient>
          </Defs>
          <Path
            d="M6 16l7 7 11-14 11 14 7-7v22a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"
            fill="url(#gCrown)"
            stroke="#F08C00"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          <Circle cx="6" cy="16" r="3" fill="#FF5DA2" />
          <Circle cx="42" cy="16" r="3" fill="#FF5DA2" />
          <Circle cx="24" cy="9" r="3" fill="#FF5DA2" />
          <Circle cx="24" cy="34" r="3" fill="#FFFFFF" opacity={0.7} />
        </>
      );

    case "gift-box":
      return (
        <>
          <Defs>
            <LinearGradient id="gBox" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#B06BFF" />
              <Stop offset="1" stopColor="#7A1FE0" />
            </LinearGradient>
          </Defs>
          <Rect x="8" y="20" width="32" height="22" rx="3" fill="url(#gBox)" />
          <Rect x="6" y="14" width="36" height="9" rx="3" fill="#8A2BE2" />
          <Rect x="21" y="14" width="6" height="28" fill="#FFD54A" />
          <Path d="M24 14c-4-6-12-6-11-1 0 3 6 3 11 1zM24 14c4-6 12-6 11-1 0 3-6 3-11 1z" fill="#FFD54A" />
          <Circle cx="24" cy="14" r="2.6" fill="#FFB300" />
        </>
      );

    case "rose":
      return (
        <>
          <Defs>
            <RadialGradient id="gRose" cx="0.5" cy="0.4" r="0.6">
              <Stop offset="0" stopColor="#FF6A8B" />
              <Stop offset="1" stopColor="#D6155B" />
            </RadialGradient>
          </Defs>
          <Path d="M24 44c-1 0-1.4-6-1.4-12S23 22 24 22s1.4 4 1.4 10S25 44 24 44z" fill="#2E9E5B" />
          <Path d="M24 34c-6 0-9-3-11-6 4 0 7 1 11 3zM24 32c6 0 9-3 11-6-4 0-7 1-11 3z" fill="#37B368" />
          <Circle cx="24" cy="16" r="12" fill="url(#gRose)" />
          <Path
            d="M24 8c-4 1-6 4-6 8s3 7 6 7 6-3 6-7-2-7-6-8z"
            fill="#FF97AE"
            opacity={0.7}
          />
          <Circle cx="24" cy="16" r="3.4" fill="#B10E4C" />
        </>
      );

    case "fire":
      return (
        <>
          <Defs>
            <LinearGradient id="gFire" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFD24A" />
              <Stop offset="0.5" stopColor="#FF7A00" />
              <Stop offset="1" stopColor="#FF2D2D" />
            </LinearGradient>
          </Defs>
          <Path
            d="M24 4c2 6-2 8-2 12 0 2 1.6 3.5 3.4 3.5 1.7 0 2.6-1.5 2.6-3.5 4 3 8 8 8 15A12 12 0 1 1 12 31c0-6 4-10 7-14 1.7 2 1.7 4 .3 6-1.3 2 .4 4.5 2.4 4.5 2.2 0 3.6-2.2 3.6-5C36-2 24 0 24 4z"
            fill="url(#gFire)"
          />
          <Path
            d="M24 24c1.6 1.6 2.4 3.4 2.4 5.4 0 2.4-1.8 4.2-4 4.2s-4-1.8-4-4.2c0-2.6 2-4 3.6-5.4z"
            fill="#FFE27A"
          />
        </>
      );

    case "rocket":
      return (
        <>
          <Defs>
            <LinearGradient id="gRkt" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#F2F5FF" />
              <Stop offset="1" stopColor="#C3CBE0" />
            </LinearGradient>
          </Defs>
          <Path d="M24 3c7 4 11 12 11 22l-4 6H17l-4-6C13 15 17 7 24 3z" fill="url(#gRkt)" />
          <Path d="M17 31l-6 4 2-9zM31 31l6 4-2-9z" fill="#FF5252" />
          <Circle cx="24" cy="19" r="5" fill="#2EA6FF" />
          <Circle cx="24" cy="19" r="2.4" fill="#0B4E8C" />
          <Path d="M20 37h8l-2 6c-.7 1.6-3.3 1.6-4 0z" fill="#FF9800" />
          <Path d="M22 40h4l-1 3c-.4.9-1.6.9-2 0z" fill="#FFD24A" />
        </>
      );

    case "coin":
      return (
        <>
          <Defs>
            <RadialGradient id="gCoin" cx="0.4" cy="0.35" r="0.7">
              <Stop offset="0" stopColor="#FFE68A" />
              <Stop offset="1" stopColor="#F5A623" />
            </RadialGradient>
          </Defs>
          <Circle cx="24" cy="24" r="19" fill="#C97E12" />
          <Circle cx="24" cy="24" r="16" fill="url(#gCoin)" />
          <Circle cx="24" cy="24" r="12" fill="none" stroke="#C97E12" strokeWidth={1.6} opacity={0.7} />
          <Path d="M24 14v20M18.5 18h8a3.5 3.5 0 0 1 0 7h-6a3.5 3.5 0 0 0 0 7h8" stroke="#8A5A0B" strokeWidth={2.6} strokeLinecap="round" fill="none" />
        </>
      );

    case "trophy":
      return (
        <>
          <Defs>
            <LinearGradient id="gTrophy" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFE47A" />
              <Stop offset="1" stopColor="#F5A623" />
            </LinearGradient>
          </Defs>
          <Path d="M14 6h20v10a10 10 0 0 1-20 0z" fill="url(#gTrophy)" />
          <Path d="M14 8H8v4a7 7 0 0 0 7 7M34 8h6v4a7 7 0 0 1-7 7" stroke="#F5A623" strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <Rect x="21" y="26" width="6" height="8" fill="#E68A00" />
          <Rect x="15" y="34" width="18" height="5" rx="1.5" fill="#C97E12" />
          <Rect x="12" y="39" width="24" height="4" rx="1.5" fill="#8A5A0B" />
        </>
      );

    case "sparkle":
      return (
        <>
          <Defs>
            <RadialGradient id="gSpk" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="1" stopColor="#8EE7FF" />
            </RadialGradient>
          </Defs>
          <Path d="M24 4c1.5 9 5 12.5 14 14-9 1.5-12.5 5-14 14-1.5-9-5-12.5-14-14 9-1.5 12.5-5 14-14z" fill="url(#gSpk)" />
          <Path d="M38 6c.7 3.3 1.7 4.3 5 5-3.3.7-4.3 1.7-5 5-.7-3.3-1.7-4.3-5-5 3.3-.7 4.3-1.7 5-5z" fill="#FFE47A" />
          <Circle cx="10" cy="38" r="3" fill="#FF7EB3" />
        </>
      );

    case "lollipop":
      return (
        <>
          <Defs>
            <RadialGradient id="gLolli" cx="0.4" cy="0.4" r="0.7">
              <Stop offset="0" stopColor="#FF9AD1" />
              <Stop offset="1" stopColor="#E5399B" />
            </RadialGradient>
          </Defs>
          <Rect x="22.5" y="24" width="3" height="20" rx="1.5" fill="#E0E6F0" />
          <Circle cx="24" cy="17" r="13" fill="url(#gLolli)" />
          <Path
            d="M24 17m0 0a5 5 0 0 1 5-5 5 5 0 0 1 5 5 9 9 0 0 1-9 9 9 9 0 0 1-9-9 6 6 0 0 1 6-6"
            stroke="#FFFFFF"
            strokeWidth={2.2}
            fill="none"
            opacity={0.75}
            strokeLinecap="round"
          />
          <Ellipse cx="19" cy="12" rx="3" ry="2" fill="#FFFFFF" opacity={0.5} />
        </>
      );

    default:
      return null;
  }
}

export default AnimatedGiftIcon;
