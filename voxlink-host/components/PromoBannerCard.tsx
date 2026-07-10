import React from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { resolveMediaUrl } from "@/services/api";

// ─── Shared promotional banner card (host app) ────────────────────────────────
// Mirrors the user app's PromoBannerCard so host-facing campaigns get the same
// polished, production-grade look: two-tone gradient (bg_color -> gradient_to,
// with a derived fallback), an optional emoji icon, or a full-bleed image with
// a dark scrim for legibility.

export type PromoBanner = {
  id?: string;
  title?: string | null;
  subtitle?: string | null;
  cta_text?: string | null;
  cta_link?: string | null;
  link_type?: string | null;
  bg_color?: string | null;
  gradient_to?: string | null;
  icon?: string | null;
  image_url?: string | null;
};

function shade(hex: string, percent: number): string {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return hex;
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return hex;
  const target = percent < 0 ? 0 : 255;
  const p = Math.abs(percent) / 100;
  const ch = (shift: number) => {
    const v = (num >> shift) & 0xff;
    return Math.round((target - v) * p) + v;
  };
  const r = ch(16), g = ch(8), b = ch(0);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export default function PromoBannerCard({
  banner,
  width,
  onPress,
}: {
  banner: PromoBanner;
  width: number;
  onPress?: () => void;
}) {
  const c1 = (banner.bg_color || "#6A00B8").trim();
  const c2 = (banner.gradient_to || shade(c1, -22)).trim();
  const hasImage = !!banner.image_url;
  const tappable = !!onPress;

  return (
    <TouchableOpacity
      activeOpacity={tappable ? 0.9 : 1}
      onPress={onPress}
      disabled={!tappable}
      accessibilityRole={tappable ? "button" : undefined}
      accessibilityLabel={banner.title || undefined}
      style={[styles.card, { width }]}
    >
      <LinearGradient
        colors={[c1, c2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View pointerEvents="none" style={[styles.blob, styles.blobA]} />
      <View pointerEvents="none" style={[styles.blob, styles.blobB]} />

      {hasImage ? (
        <>
          <Image source={{ uri: resolveMediaUrl(banner.image_url as string) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View pointerEvents="none" style={styles.scrim} />
        </>
      ) : null}

      <View style={styles.row}>
        <View style={styles.textCol}>
          {banner.title ? <Text style={styles.title} numberOfLines={2}>{banner.title}</Text> : null}
          {banner.subtitle ? <Text style={styles.sub} numberOfLines={2}>{banner.subtitle}</Text> : null}
          {banner.cta_text ? (
            <View style={styles.ctaPill}>
              <Text style={styles.ctaText}>{banner.cta_text}</Text>
              <Text style={styles.ctaChevron}> ›</Text>
            </View>
          ) : null}
        </View>
        {!hasImage && banner.icon ? <Text style={styles.icon}>{banner.icon}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 116,
    borderRadius: 18,
    overflow: "hidden",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: "#5B21B6", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 4 },
      web: { boxShadow: "0 6px 16px rgba(91,33,182,0.18)" } as any,
    }),
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,6,24,0.42)" },
  blob: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.12)" },
  blobA: { width: 130, height: 130, right: -34, top: -46 },
  blobB: { width: 78, height: 78, right: 54, bottom: -34 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14, gap: 12 },
  textCol: { flex: 1, gap: 3 },
  title: { color: "#fff", fontSize: 17, fontFamily: "Poppins_700Bold" },
  sub: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 17 },
  ctaPill: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", marginTop: 9,
    backgroundColor: "rgba(255,255,255,0.24)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  ctaText: { color: "#fff", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  ctaChevron: { color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold" },
  icon: { fontSize: 46 },
});
