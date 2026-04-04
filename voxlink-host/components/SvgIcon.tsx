import React from "react";
import Svg, { Path, Circle, Polyline, Line, Rect } from "react-native-svg";

export type SvgIconName =
  | "camera"
  | "chevron-down"
  | "phone"
  | "briefcase"
  | "info"
  | "upload"
  | "credit-card"
  | "check-circle";

interface Props {
  name: SvgIconName;
  size?: number;
  color?: string;
}

export function SvgIcon({ name, size = 24, color = "#84889F" }: Props) {
  const s = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

  switch (name) {
    case "camera":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <Circle {...s} cx="12" cy="13" r="4" />
        </Svg>
      );

    case "chevron-down":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Polyline {...s} points="6 9 12 15 18 9" />
        </Svg>
      );

    case "phone":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </Svg>
      );

    case "briefcase":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect {...s} x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <Path {...s} d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </Svg>
      );

    case "info":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="12" cy="12" r="10" />
          <Line {...s} x1="12" y1="16" x2="12" y2="12" />
          <Line {...s} x1="12" y1="8" x2="12.01" y2="8" />
        </Svg>
      );

    case "upload":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <Polyline {...s} points="17 8 12 3 7 8" />
          <Line {...s} x1="12" y1="3" x2="12" y2="15" />
        </Svg>
      );

    case "credit-card":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect {...s} x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <Line {...s} x1="1" y1="10" x2="23" y2="10" />
        </Svg>
      );

    case "check-circle":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <Polyline {...s} points="22 4 12 14.01 9 11.01" />
        </Svg>
      );

    default:
      return null;
  }
}
