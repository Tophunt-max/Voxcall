import React from "react";
import { Image } from "react-native";
import { SvgIcon, SvgIconName } from "./SvgIcon";

const PNG_ICONS: Record<string, any> = {
  "arrow-left":    require("@/assets/icons/ic_back.png"),
  "bell":          require("@/assets/icons/ic_notify.png"),
  "calendar":      require("@/assets/icons/ic_calendar.png"),
  "check":         require("@/assets/icons/ic_check.png"),
  "copy":          require("@/assets/icons/ic_copy.png"),
  "dollar-sign":   require("@/assets/icons/ic_coin.png"),
  "file-text":     require("@/assets/icons/ic_withdraw.png"),
  "gift":          require("@/assets/icons/ic_bonus.png"),
  "log-out":       require("@/assets/images/icon_logout.png"),
  "mail":          require("@/assets/icons/ic_mail.png"),
  "message-circle":require("@/assets/icons/ic_chat.png"),
  "mic":           require("@/assets/icons/ic_mic.png"),
  "phone":         require("@/assets/icons/ic_call.png"),
  "search":        require("@/assets/icons/ic_search.png"),
  "shield":        require("@/assets/icons/ic_secure.png"),
  "star":          require("@/assets/icons/ic_star.png"),
  "trending-up":   require("@/assets/icons/ic_arrow_up.png"),
  "user":          require("@/assets/icons/ic_profile.png"),
  "user-plus":     require("@/assets/icons/ic_profile.png"),
  "video":         require("@/assets/icons/ic_video.png"),
  "volume-2":      require("@/assets/icons/ic_speaker_on.png"),
  "volume-x":      require("@/assets/icons/ic_speaker_off.png"),
  "x":             require("@/assets/icons/ic_close.png"),
};

const SVG_MAP: Record<string, SvgIconName> = {
  "alert-circle":      "alert-circle",
  "alert-triangle":    "alert-triangle",
  "arrow-down-circle": "arrow-down-circle",
  "arrow-up-circle":   "arrow-up-circle",
  "bell-off":          "bell-off",
  "briefcase":         "briefcase",
  "camera":            "camera",
  "camera-off":        "camera-off",
  "check-circle":      "check-circle",
  "chevron-down":      "chevron-down",
  "chevron-right":     "chevron-right",
  "chevron-up":        "chevron-up",
  "clock":             "clock",
  "credit-card":       "credit-card",
  "external-link":     "external-link",
  "globe":             "globe",
  "help-circle":       "help-circle",
  "inbox":             "inbox",
  "info":              "info",
  "instagram":         "instagram",
  "mic-off":           "mic-off",
  "phone-off":         "phone-off",
  "plus":              "plus",
  "radio":             "radio",
  "refresh-cw":        "refresh",
  "rotate-ccw":        "refresh",
  "share-2":           "share",
  "trash-2":           "trash",
  "twitter":           "twitter",
  "upload":            "upload",
  "wifi-off":          "wifi-off",
};

interface Props {
  name: string;
  size?: number;
  color?: string;
}

export function IconView({ name, size = 24, color = "#84889F" }: Props) {
  const png = PNG_ICONS[name];
  if (png) {
    return (
      <Image
        source={png}
        style={{ width: size, height: size, tintColor: color }}
        resizeMode="contain"
      />
    );
  }
  const svgName = SVG_MAP[name] as SvgIconName | undefined;
  if (svgName) {
    return <SvgIcon name={svgName} size={size} color={color} />;
  }
  return null;
}
