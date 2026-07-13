import React from "react";
import { View, Text, StyleSheet } from "react-native";

// Reusable VIP indicator. Prefers the admin-configured badge emoji + accent
// color (from /api/vip/status) when provided; otherwise falls back to a
// tier-appropriate default so a VIP is still clearly marked in places that only
// know the tier (e.g. the chat list, where only is_vip + tier are available).

const TIER_DEFAULTS: Record<string, { glyph: string; color: string }> = {
  platinum: { glyph: "💎", color: "#7C3AED" },
  gold: { glyph: "👑", color: "#D97706" },
  silver: { glyph: "⭐", color: "#6B7280" },
  weekly: { glyph: "✨", color: "#2563EB" },
};

function resolve(tier?: string | null, badge?: string | null, color?: string | null) {
  const def = (tier && TIER_DEFAULTS[tier]) || { glyph: "👑", color: "#7C3AED" };
  return {
    glyph: (badge && badge.trim()) || def.glyph,
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
  const { glyph, color: c } = resolve(tier, badge, color);
  return (
    <View style={[styles.chip, { backgroundColor: `${c}1A`, borderColor: `${c}55` }]}>
      <Text style={styles.glyph}>{glyph}</Text>
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
