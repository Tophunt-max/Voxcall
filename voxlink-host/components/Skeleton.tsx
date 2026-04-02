// VoxLink Skeleton Component
// Animated loading placeholders (shimmer effect)

import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export default function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = 8,
  style,
}: SkeletonProps) {
  const colors = useColors();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: colors.muted,
          opacity,
        },
        style,
      ]}
    />
  );
}

// Preset skeleton layouts
export function HostCardSkeleton() {
  return (
    <View style={skeletonStyles.hostCard}>
      <Skeleton width={52} height={52} borderRadius={26} />
      <View style={skeletonStyles.hostInfo}>
        <Skeleton width="60%" height={14} borderRadius={7} />
        <Skeleton width="40%" height={11} borderRadius={6} style={{ marginTop: 6 }} />
        <Skeleton width="80%" height={11} borderRadius={6} style={{ marginTop: 6 }} />
      </View>
      <Skeleton width={64} height={32} borderRadius={16} />
    </View>
  );
}

export function MessageSkeleton() {
  return (
    <View style={skeletonStyles.messageRow}>
      <Skeleton width={44} height={44} borderRadius={22} />
      <View style={skeletonStyles.msgInfo}>
        <View style={skeletonStyles.msgHeader}>
          <Skeleton width="45%" height={13} borderRadius={6} />
          <Skeleton width={36} height={11} borderRadius={5} />
        </View>
        <Skeleton width="75%" height={11} borderRadius={5} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View style={skeletonStyles.profile}>
      <Skeleton width={90} height={90} borderRadius={45} style={{ alignSelf: "center" }} />
      <Skeleton width="50%" height={18} borderRadius={9} style={{ alignSelf: "center", marginTop: 16 }} />
      <Skeleton width="35%" height={13} borderRadius={6} style={{ alignSelf: "center", marginTop: 8 }} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  hostCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  hostInfo: {
    flex: 1,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  msgInfo: {
    flex: 1,
  },
  msgHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  profile: {
    padding: 24,
  },
});
