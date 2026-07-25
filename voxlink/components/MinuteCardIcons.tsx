import React from "react";
import Svg, { Rect, G, Text as SvgText } from "react-native-svg";

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Pass reward-card icons (original stacked-card artwork).
// ─────────────────────────────────────────────────────────────────────────────
// Two visually-distinct "stacked card" glyphs, one per reward type:
//   • FreeMinutesCardIcon — purple stacked cards labelled "Call" → HOST-call
//     free minutes ("Free Minutes / Call card").
//   • RandomCardIcon      — orange stacked cards labelled "R" → RANDOM-call
//     free minutes ("Random / Rcard").
//
// Solid fills (no gradient <Defs>) so the same icon repeated across dozens of
// tier cells renders reliably on the Expo web build (duplicate gradient ids
// would otherwise collide in the DOM and vanish).

/** Free Minutes / "Call" card — purple stacked cards. Host-call free minutes. */
export function FreeMinutesCardIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* back card, tilted for the "stack" look */}
      <G rotation={-16} originX={12} originY={13}>
        <Rect x={5.5} y={7.5} width={13} height={9.5} rx={2} fill="#C4B5FD" />
      </G>
      {/* front card */}
      <Rect x={4.5} y={8.5} width={15} height={10} rx={2.4} fill="#7C3AED" />
      {/* top sheen */}
      <Rect x={4.5} y={8.5} width={15} height={3.4} rx={2.4} fill="#FFFFFF" opacity={0.16} />
      <SvgText x={12} y={15.7} fontSize={5.4} fontWeight="bold" fill="#FFFFFF" textAnchor="middle">Call</SvgText>
    </Svg>
  );
}

/** Random / "R" card — orange stacked cards. Random-call free minutes. */
export function RandomCardIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G rotation={-16} originX={12} originY={13}>
        <Rect x={5.5} y={7.5} width={13} height={9.5} rx={2} fill="#FDBA74" />
      </G>
      <Rect x={4.5} y={8.5} width={15} height={10} rx={2.4} fill="#F97316" />
      <Rect x={4.5} y={8.5} width={15} height={3.4} rx={2.4} fill="#FFFFFF" opacity={0.16} />
      <SvgText x={12} y={16.2} fontSize={7.4} fontWeight="bold" fill="#FFFFFF" textAnchor="middle">R</SvgText>
    </Svg>
  );
}
