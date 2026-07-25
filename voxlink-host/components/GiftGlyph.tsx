// GiftGlyph — renders a gift/badge "icon" that may be one of:
//   • an image URL (https://…)  → rendered as an <Image> (admin-uploaded art)
//   • an emoji / short glyph     → rendered as text (legacy admin data)
//   • empty / missing            → a vector fallback icon (no hardcoded emoji)
//
// This lets the gift + badge catalog move to real images (or keep emoji) with
// zero backend migration — the stored `icon` column is text either way.

import React from "react";
import { Image, Text } from "react-native";
import type { StyleProp, TextStyle, ImageStyle } from "react-native";
import { AppIcon, type AppIconName } from "@/components/AppIcon";

export function isImageUrl(s?: string | null): boolean {
  return !!s && /^https?:\/\//i.test(s.trim());
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
