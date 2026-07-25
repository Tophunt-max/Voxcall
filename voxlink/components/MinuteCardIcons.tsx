import React from "react";
import Svg, { Defs, LinearGradient, Stop, Rect, Circle, Path, G } from "react-native-svg";

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Pass reward-card icons (original vector art).
// ─────────────────────────────────────────────────────────────────────────────
// Two visually-distinct little "cards", one per reward type:
//   • FreeMinutesCardIcon — purple card + phone/clock motif → HOST-call free
//     minutes ("Free Minutes card").
//   • RandomCardIcon      — orange card + shuffle motif → RANDOM-call free
//     minutes ("Random Call card").
// Both drawn from scratch with react-native-svg so they scale crisply and carry
// no third-party assets.

/** Free Minutes card — talk to hosts free. Purple card with a phone + clock. */
export function FreeMinutesCardIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id="mcFree" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#A78BFA" />
          <Stop offset="1" stopColor="#7C3AED" />
        </LinearGradient>
      </Defs>
      {/* Card body */}
      <Rect x="2" y="4" width="20" height="16" rx="4" fill="url(#mcFree)" />
      {/* top sheen */}
      <Rect x="2" y="4" width="20" height="6" rx="4" fill="#FFFFFF" opacity={0.16} />
      {/* Clock face = free MINUTES */}
      <Circle cx="12" cy="12.2" r="4.6" fill="#FFFFFF" opacity={0.96} />
      <Path
        d="M12 9.4 V12.2 L14 13.4"
        stroke="#7C3AED"
        strokeWidth={1.5}
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
      <Defs>
        <LinearGradient id="mcRand" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FBBF24" />
          <Stop offset="1" stopColor="#F97316" />
        </LinearGradient>
      </Defs>
      {/* Card body */}
      <Rect x="2" y="4" width="20" height="16" rx="4" fill="url(#mcRand)" />
      <Rect x="2" y="4" width="20" height="6" rx="4" fill="#FFFFFF" opacity={0.16} />
      {/* Shuffle glyph = RANDOM */}
      <G stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
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
