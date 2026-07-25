import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { GiftGlyph } from "@/components/GiftGlyph";

// Reusable VIP indicator. Prefers the admin-configured badge emoji + accent
// color (from /api/vip/status) when provided; otherwise falls back to a
// tier-appropriate vector icon so a VIP is still clearly marked in places that
// only know the tier (e.g. the chat list, where only is_vip + tier are available).

const TIER_DEFAULTS: Record<string, { icon: AppIconName; color: string }> = {
  platinum: { icon: "diamond", color: "#7C3AED" },
  gold: { icon: "crown", color: "#D97706" },
  silver: { icon: "star", color: "#6B7280" },
  weekly: { icon: "sparkles", color: "#2563EB" },
};

function resolve(tier?: string | null, badge?: string | null, color?: string | null) {
  const def = (tier && TIER_DEFAULTS[tier]) || { icon: "crown" as AppIconName, color: "#7C3AED" };
  return {
    // Admin can still override with a custom badge glyph; otherwise use a vector icon.
    custom: badge && badge.trim() ? badge.trim() : null,
    icon: def.icon,
    color: (color && /^#?[0-9a-fA-F]{3,8}$/.test(color) ? (color.startsWith("#") ? color : `#${color}`) : def.color),
  };
}

export function VipBadge({
  tier,
  badge,
  color,
  compact = false,
}: {
  tier?: string | null;
  badge?: string | null;
  color?: string | null;
  compact?: boolean;
}) {
  const { custom, icon, color: c } = resolve(tier, badge, color);
  return (
    <View style={[styles.chip, { backgroundColor: `${c}1A`, borderColor: `${c}55` }]}>
      {custom ? <GiftGlyph icon={custom} size={11} fallback={icon} fallbackColor={c} style={styles.glyph} /> : <AppIcon name={icon} size={11} color={c} />}
      {!compact && <Text style={[styles.label, { color: c }]}>VIP</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 9,
    borderWidth: 1,
  },
  glyph: { fontSize: 11 },
  label: { fontSize: 9, fontFamily: "Poppins_700Bold", letterSpacing: 0.5 },
});
