import React from "react";
import Svg, { Rect, Circle, Path, G } from "react-native-svg";

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Pass reward-card icons (original vector art).
// ─────────────────────────────────────────────────────────────────────────────
// Two visually-distinct little "cards", one per reward type:
//   • FreeMinutesCardIcon — purple card + clock  → HOST-call free minutes.
//   • RandomCardIcon      — orange card + shuffle → RANDOM-call free minutes.
//
// IMPORTANT: these use SOLID fills (no <Defs>/<LinearGradient>). On the Expo
// WEB build the same gradient `id` repeated across dozens of tier cells collides
// in the DOM and the fill silently disappears — solid fills render reliably on
// every platform.

/** Free Minutes card — talk to hosts free. Purple card with a clock (minutes). */
export function FreeMinutesCardIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Card body */}
      <Rect x="2" y="4" width="20" height="16" rx="4" fill="#7C3AED" />
      {/* top sheen */}
      <Rect x="2" y="4" width="20" height="6" rx="4" fill="#FFFFFF" opacity={0.2} />
      {/* Clock face = free MINUTES */}
      <Circle cx="12" cy="12.2" r="4.7" fill="#FFFFFF" />
      <Path
        d="M12 9.3 V12.2 L14.1 13.5"
        stroke="#7C3AED"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Random Call card — free random calls. Orange card with a shuffle glyph. */
export function RandomCardIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Card body */}
      <Rect x="2" y="4" width="20" height="16" rx="4" fill="#F97316" />
      <Rect x="2" y="4" width="20" height="6" rx="4" fill="#FFFFFF" opacity={0.2} />
      {/* Shuffle glyph = RANDOM */}
      <G stroke="#FFFFFF" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <Path d="M6.5 9 H9 L15 15 H17.5" />
        <Path d="M6.5 15 H9 L10.7 13.3" />
        <Path d="M13.3 10.7 L15 9 H17.5" />
        {/* arrow heads */}
        <Path d="M16 7.5 L17.9 9 L16 10.5" />
        <Path d="M16 13.5 L17.9 15 L16 16.5" />
      </G>
    </Svg>
  );
}
