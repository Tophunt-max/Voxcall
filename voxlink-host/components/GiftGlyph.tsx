// GiftGlyph — renders a gift/badge "icon" that may be one of:
//   • an image URL (https://…)  → rendered as an <Image> (admin-uploaded art)
//   • an emoji / short glyph     → rendered as text (legacy admin data)
//   • empty / missing            → a vector fallback icon (no hardcoded emoji)
//
// This lets the gift + badge catalog move to real images (or keep emoji) with
// zero backend migration — the stored `icon` column is text either way.

import React from "react";
import { Image, Text } from "react-native";
import type { StyleProp, TextStyle, ImageStyle, ViewStyle } from "react-native";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import {
  AnimatedGiftIcon,
  ANIMATED_GIFT_NAMES,
  type AnimatedGiftName,
} from "@/components/AnimatedGiftIcon";

export function isImageUrl(s?: string | null): boolean {
  return !!s && /^https?:\/\//i.test(s.trim());
}

/** Returns the animated-gift name if `icon` is a "svg:<name>" token, else null. */
export function parseSvgGift(s?: string | null): AnimatedGiftName | null {
  if (!s) return null;
  const m = s.trim().match(/^svg:(.+)$/i);
  if (!m) return null;
  const name = m[1].toLowerCase() as AnimatedGiftName;
  return ANIMATED_GIFT_NAMES.includes(name) ? name : null;
}

interface Props {
  icon?: string | null;
  size?: number;
  /** Vector icon shown when `icon` is empty/missing. */
  fallback?: AppIconName;
  fallbackColor?: string;
  style?: StyleProp<TextStyle>;
}

export function GiftGlyph({ icon, size = 24, fallback = "gift", fallbackColor = "#A00EE7", style }: Props) {
  const svgGift = parseSvgGift(icon);
  if (svgGift) {
    return <AnimatedGiftIcon name={svgGift} size={size} style={style as StyleProp<ViewStyle>} />;
  }
  if (isImageUrl(icon)) {
    return (
      <Image
        source={{ uri: icon!.trim() }}
        style={[{ width: size, height: size }, style as StyleProp<ImageStyle>]}
        resizeMode="contain"
      />
    );
  }
  if (icon && icon.trim()) {
    return <Text style={[{ fontSize: size }, style]}>{icon}</Text>;
  }
  return <AppIcon name={fallback} size={size} color={fallbackColor} style={style} />;
}

export default GiftGlyph;
