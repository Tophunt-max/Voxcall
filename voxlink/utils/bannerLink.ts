import { Linking } from "react-native";
import { router } from "expo-router";

// Shape of the admin-managed banner CTA fields the apps care about.
export type BannerLink = {
  cta_link?: string | null;
  link_type?: string | null;
};

// Safely open an admin-configured banner CTA. `link_type` decides the handler:
//   external → device browser (Linking.openURL)   — validated https:// server-side
//   internal → in-app route  (router.push)         — validated to start with "/"
//   none / empty → do nothing
// We also sniff an http(s) prefix as a fallback so legacy rows created before
// link_type existed still open correctly, and we never hand an unexpected
// string to router.push (which would throw on an invalid route).
export function openBannerLink(banner: BannerLink): void {
  const link = (banner?.cta_link || "").trim();
  if (!link) return;

  const looksExternal = /^https?:\/\//i.test(link);
  const type = banner?.link_type || (looksExternal ? "external" : "internal");

  if (type === "none") return;

  if (type === "external" || looksExternal) {
    Linking.openURL(link).catch(() => {});
    return;
  }

  // Internal in-app route — must be an app path. Guard against bad input.
  if (link.startsWith("/")) {
    try {
      router.push(link as any);
    } catch {
      /* invalid route — ignore rather than crash the screen */
    }
  }
}
