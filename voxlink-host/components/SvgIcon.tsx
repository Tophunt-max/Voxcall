import React from "react";
import Svg, { Path, Circle, Polyline, Line, Rect } from "react-native-svg";

export type SvgIconName =
  | "alert-circle" | "alert-triangle"
  | "arrow-down-circle" | "arrow-up-circle"
  | "bell-off"
  | "briefcase"
  | "camera" | "camera-off"
  | "check-circle"
  | "chevron-down" | "chevron-right" | "chevron-up"
  | "clock"
  | "credit-card"
  | "external-link"
  | "globe"
  | "help-circle"
  | "inbox"
  | "info"
  | "instagram"
  | "mic-off"
  | "phone"
  | "phone-off"
  | "plus"
  | "radio"
  | "refresh"
  | "share"
  | "trash"
  | "twitter"
  | "upload"
  | "wifi-off";

interface Props {
  name: SvgIconName;
  size?: number;
  color?: string;
}

export function SvgIcon({ name, size = 24, color = "#84889F" }: Props) {
  const s = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

  switch (name) {
    case "alert-circle":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="12" cy="12" r="10" />
          <Line {...s} x1="12" y1="8" x2="12" y2="12" />
          <Line {...s} x1="12" y1="16" x2="12.01" y2="16" />
        </Svg>
      );

    case "alert-triangle":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <Line {...s} x1="12" y1="9" x2="12" y2="13" />
          <Line {...s} x1="12" y1="17" x2="12.01" y2="17" />
        </Svg>
      );

    case "arrow-down-circle":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="12" cy="12" r="10" />
          <Polyline {...s} points="8 12 12 16 16 12" />
          <Line {...s} x1="12" y1="8" x2="12" y2="16" />
        </Svg>
      );

    case "arrow-up-circle":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="12" cy="12" r="10" />
          <Polyline {...s} points="16 12 12 8 8 12" />
          <Line {...s} x1="12" y1="16" x2="12" y2="8" />
        </Svg>
      );

    case "bell-off":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M13.73 21a2 2 0 0 1-3.46 0" />
          <Path {...s} d="M18.63 13A17.89 17.89 0 0 1 18 8" />
          <Path {...s} d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
          <Path {...s} d="M18 8a6 6 0 0 0-9.33-5" />
          <Line {...s} x1="1" y1="1" x2="23" y2="23" />
        </Svg>
      );

    case "briefcase":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect {...s} x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <Path {...s} d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </Svg>
      );

    case "camera":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <Circle {...s} cx="12" cy="13" r="4" />
        </Svg>
      );

    case "camera-off":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Line {...s} x1="1" y1="1" x2="23" y2="23" />
          <Path {...s} d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56" />
        </Svg>
      );

    case "check-circle":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <Polyline {...s} points="22 4 12 14.01 9 11.01" />
        </Svg>
      );

    case "chevron-down":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Polyline {...s} points="6 9 12 15 18 9" />
        </Svg>
      );

    case "chevron-right":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Polyline {...s} points="9 18 15 12 9 6" />
        </Svg>
      );

    case "chevron-up":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Polyline {...s} points="18 15 12 9 6 15" />
        </Svg>
      );

    case "clock":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="12" cy="12" r="10" />
          <Polyline {...s} points="12 6 12 12 16 14" />
        </Svg>
      );

    case "credit-card":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect {...s} x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <Line {...s} x1="1" y1="10" x2="23" y2="10" />
        </Svg>
      );

    case "external-link":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <Polyline {...s} points="15 3 21 3 21 9" />
          <Line {...s} x1="10" y1="14" x2="21" y2="3" />
        </Svg>
      );

    case "globe":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="12" cy="12" r="10" />
          <Line {...s} x1="2" y1="12" x2="22" y2="12" />
          <Path {...s} d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </Svg>
      );

    case "help-circle":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="12" cy="12" r="10" />
          <Path {...s} d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <Line {...s} x1="12" y1="17" x2="12.01" y2="17" />
        </Svg>
      );

    case "inbox":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Polyline {...s} points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <Path {...s} d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
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

    case "instagram":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect {...s} x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <Path {...s} d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <Line {...s} x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </Svg>
      );

    case "mic-off":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Line {...s} x1="1" y1="1" x2="23" y2="23" />
          <Path {...s} d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
          <Path {...s} d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
          <Line {...s} x1="12" y1="19" x2="12" y2="23" />
          <Line {...s} x1="8" y1="23" x2="16" y2="23" />
        </Svg>
      );

    case "phone":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </Svg>
      );

    case "phone-off":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 3.07 8.68 2 2 0 0 1 5 6.5h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9 14.09" />
          <Line {...s} x1="23" y1="1" x2="1" y2="23" />
        </Svg>
      );

    case "plus":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Line {...s} x1="12" y1="5" x2="12" y2="19" />
          <Line {...s} x1="5" y1="12" x2="19" y2="12" />
        </Svg>
      );

    case "radio":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="12" cy="12" r="2" />
          <Path {...s} d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
        </Svg>
      );

    case "refresh":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Polyline {...s} points="23 4 23 10 17 10" />
          <Polyline {...s} points="1 20 1 14 7 14" />
          <Path {...s} d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </Svg>
      );

    case "share":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle {...s} cx="18" cy="5" r="3" />
          <Circle {...s} cx="6" cy="12" r="3" />
          <Circle {...s} cx="18" cy="19" r="3" />
          <Line {...s} x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <Line {...s} x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </Svg>
      );

    case "trash":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Polyline {...s} points="3 6 5 6 21 6" />
          <Path {...s} d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </Svg>
      );

    case "twitter":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...s} d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z" />
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

    case "wifi-off":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Line {...s} x1="1" y1="1" x2="23" y2="23" />
          <Path {...s} d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <Path {...s} d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <Path {...s} d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <Path {...s} d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <Path {...s} d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <Line {...s} x1="12" y1="20" x2="12.01" y2="20" />
        </Svg>
      );

    default:
      return null;
  }
}
