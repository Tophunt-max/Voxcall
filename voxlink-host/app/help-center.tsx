import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Linking
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { SvgIcon } from "@/components/SvgIcon";
import { API } from "@/services/api";
import { fetchAppConfig } from "@/hooks/useAppConfig";
import { useLanguage } from "@/context/LanguageContext";

const DEFAULT_SUPPORT_EMAIL = "host-support@voxlink.app";

// Fallback FAQs — shown only if the admin-managed list (GET /api/faqs) is
// empty or fails to load. Admin edits in the panel take precedence.
const FALLBACK_FAQS = [
  { q: "How do I start receiving calls?", a: "Make sure your profile is complete and you've set your status to Online from the Profile tab. Users will then be able to see your profile and initiate calls with you." },
  { q: "How are my earnings calculated?", a: "You earn coins for every minute of calls you complete. Your per-minute rate is set during profile setup and can be updated in Profile settings. Coins are converted to cash during withdrawal." },
  { q: "When can I withdraw my earnings?", a: "You can request a withdrawal from the Wallet tab. Minimum withdrawal amount and processing times depend on your selected payout method. Payouts are processed within 3-5 business days." },
  { q: "What happens if a call drops?", a: "If a call drops due to a network issue, you will still be paid for the duration of the call completed. The session is recorded from the moment it connects until it ends." },
  { q: "How does the rating system work?", a: "After each call, users can rate their experience with you. Your average rating is displayed on your profile and affects your visibility to new users. Maintaining a high rating helps grow your audience." },
  { q: "Can I set my own schedule?", a: "Yes! You control your availability. Simply toggle your online/offline status from the Profile tab. You can also configure availability schedules in Settings → Availability." },
  { q: "What is KYC verification?", a: "KYC (Know Your Customer) is a one-time identity verification required to enable payouts. It ensures the security of the platform and compliance with financial regulations." },
  { q: "How do I contact support?", a: "You can reach our host support team by tapping 'Contact Support' below or emailing support@voxlink.app. We typically respond within 24 hours." },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  return (
    <TouchableOpacity
      onPress={() => setOpen(v => !v)}
      style={[styles.faqItem, { backgroundColor: colors.card }]}
      activeOpacity={0.8}
    >
      <View style={styles.faqRow}>
        <Text style={[styles.faqQ, { color: colors.text }]}>{q}</Text>
        <SvgIcon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </View>
      {open && <Text style={[styles.faqA, { color: colors.mutedForeground }]}>{a}</Text>}
    </TouchableOpacity>
  );
}

export default function HelpCenterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = insets.top;
  const { t } = useLanguage();

  // Admin-managed FAQs + support email. Both fall back to bundled defaults so
  // the screen is never empty if the network/admin config is unavailable.
  const [faqs, setFaqs] = useState<{ q: string; a: string }[]>(FALLBACK_FAQS);
  const [supportEmail, setSupportEmail] = useState(DEFAULT_SUPPORT_EMAIL);

  useEffect(() => {
    API.getFaqs()
      .then((rows: any[]) => {
        if (Array.isArray(rows) && rows.length > 0) {
          const mapped = rows
            .map((r) => ({ q: r.question ?? r.q ?? "", a: r.answer ?? r.a ?? "" }))
            .filter((f) => f.q && f.a);
          if (mapped.length > 0) setFaqs(mapped);
        }
      })
      .catch(() => { /* keep fallback */ });
    fetchAppConfig()
      .then((cfg) => { if (cfg?.support_email) setSupportEmail(cfg.support_email); })
      .catch(() => { /* keep default */ });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t.helpCenterScreen.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.banner, { backgroundColor: colors.accentLight }]}>
          <Image source={require("@/assets/images/help_blur.png")} style={styles.bannerImg} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.text }]}>{t.helpCenterScreen.bannerTitle}</Text>
            <Text style={[styles.bannerSub, { color: colors.mutedForeground }]}>{t.helpCenterScreen.bannerSub}</Text>
          </View>
        </View>

        <TouchableOpacity style={[styles.contactCard, { backgroundColor: colors.card }]} activeOpacity={0.8} onPress={() => Linking.openURL(`mailto:${supportEmail}`)}>
          <Image source={require("@/assets/images/help_person.png")} style={styles.contactImg} resizeMode="contain" />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.contactTitle, { color: colors.text }]}>{t.helpCenterScreen.contactTitle}</Text>
            <Text style={[styles.contactSub, { color: colors.mutedForeground }]}>{supportEmail}</Text>
          </View>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>

        <Text style={[styles.faqTitle, { color: colors.text }]}>{t.helpCenterScreen.faqTitle}</Text>

        {faqs.map((faq, i) => <FAQItem key={i} q={faq.q} a={faq.a} />)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  banner: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  bannerImg: { width: 56, height: 56 },
  bannerTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  bannerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  contactCard: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  contactImg: { width: 44, height: 44 },
  contactTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  contactSub: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  chevron: { width: 14, height: 14 },
  faqTitle: { fontSize: 16, fontFamily: "Poppins_700Bold", marginTop: 8 },
  faqItem: { borderRadius: 14, padding: 16, gap: 8 },
  faqRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  faqQ: { flex: 1, fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  faqA: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 20 },
});
