// VoxLink Avatar Component
// Reusable user/host avatar with online status ring, size variants

import React from "react";
import { View, Image, StyleSheet, ViewStyle, ImageStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
type StatusType = "online" | "offline" | "busy" | "none";

interface AvatarProps {
  uri: string;
  size?: AvatarSize;
  status?: StatusType;
  showBorder?: boolean;
  borderColor?: string;
  style?: ViewStyle;
}

const SIZE_MAP: Record<AvatarSize, number> = {
  xs: 28,
  sm: 36,
  md: 48,
  lg: 60,
  xl: 80,
  xxl: 100,
};

const BADGE_SIZE_MAP: Record<AvatarSize, number> = {
  xs: 7,
  sm: 9,
  md: 11,
  lg: 13,
  xl: 16,
  xxl: 20,
};

export default function Avatar({
  uri,
  size = "md",
  status = "none",
  showBorder = false,
  borderColor,
  style,
}: AvatarProps) {
  const colors = useColors();
  const dim = SIZE_MAP[size];
  const badgeDim = BADGE_SIZE_MAP[size];
  const radius = dim / 2;

  const statusColors: Record<StatusType, string> = {
    online: colors.online,
    offline: colors.offline,
    busy: colors.busy,
    none: "transparent",
  };

  return (
    <View
      style={[
        styles.wrapper,
        {
          width: dim,
          height: dim,
          borderRadius: radius,
          borderWidth: showBorder ? 2 : 0,
          borderColor: borderColor ?? colors.accentBorder,
        },
        style,
      ]}
    >
      <Image
        source={{ uri }}
        style={[styles.img, { width: dim, height: dim, borderRadius: radius }] as ImageStyle}
        resizeMode="cover"
      />
      {status !== "none" && (
        <View
          style={[
            styles.badge,
            {
              width: badgeDim,
              height: badgeDim,
              borderRadius: badgeDim / 2,
              backgroundColor: statusColors[status],
              borderColor: colors.card,
              bottom: 1,
              right: 1,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
    overflow: "visible",
  },
  img: {
    backgroundColor: "#E0E0E0",
  },
  badge: {
    position: "absolute",
    borderWidth: 2,
  },
});
