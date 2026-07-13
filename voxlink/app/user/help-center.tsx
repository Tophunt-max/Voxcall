import React, { useState, useEffect, useCallback } from "react";
import { useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Linking, TextInput, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { API } from "@/services/api";
import { fetchAppConfig } from "@/hooks/useAppConfig";
import { showSuccessToast, showErrorToast } from "@/components/Toast";

const DEFAULT_SUPPORT_EMAIL = "support@voxlink.app";

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
        <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 18, height: 18, tintColor: colors.mutedForeground, transform: [{ rotate: open ? "90deg" : "-90deg" }] }} resizeMode="contain" />
      </View>
      {open && <Text style={[styles.faqA, { color: colors.mutedForeground }]}>{a}</Text>}
    </TouchableOpacity>
  );
}

export default function HelpCenterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const topPad = insets.top;

  // Fallback FAQs — shown only if the admin-managed list (GET /api/faqs) is
  // empty or fails to load. Admin edits in the panel take precedence.
  const FALLBACK_FAQS = [
    { q: t.helpScreen.q1, a: t.helpScreen.a1 },
    { q: t.helpScreen.q2, a: t.helpScreen.a2 },
    { q: t.helpScreen.q3, a: t.helpScreen.a3 },
    { q: t.helpScreen.q4, a: t.helpScreen.a4 },
    { q: t.helpScreen.q5, a: t.helpScreen.a5 },
    { q: t.helpScreen.q6, a: t.helpScreen.a6 },
    { q: t.helpScreen.q7, a: t.helpScreen.a7 },
  ];

  // Admin-managed FAQs + support email. Both fall back to bundled defaults so
  // the screen is never empty if the network/admin config is unavailable.
  const [faqs, setFaqs] = useState<{ q: string; a: string }[]>(FALLBACK_FAQS);
  const [supportEmail, setSupportEmail] = useState(DEFAULT_SUPPORT_EMAIL);

  // In-app support request (delivers the VIP priority_support perk server-side).
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [vipPriority, setVipPriority] = useState(false);

  useEffect(() => {
    API.getVipStatus()
      .then((s: any) => setVipPriority(!!(s?.is_vip && s?.priority_support)))
      .catch(() => setVipPriority(false));
  }, []);

  const submitRequest = useCallback(async () => {
    const subj = subject.trim();
    const msg = message.trim();
    if (!subj || !msg) {
      showErrorToast("Please add a subject and a message.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await API.createSupportTicket(subj, msg);
      showSuccessToast(
        res?.priority === "high"
          ? "Your VIP priority request was sent — we'll respond fast. ⚡"
          : "Your request was sent. We'll get back to you soon.",
        "Request submitted",
      );
      setSubject("");
      setMessage("");
    } catch (e: any) {
      showErrorToast(e?.message || "Couldn't submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [subject, message]);

  const loadHelp = useCallback(() => {
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

  useEffect(() => { loadHelp(); }, [loadHelp]);

  // Real-time: admin edited FAQs — refresh instantly while the screen is open.
  useSocketEvent(
    SocketEvents.DATA_CHANGED,
    (d: any) => { if (d?.resource === "faqs") loadHelp(); },
    [loadHelp]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t.helpScreen.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        {/* Banner */}
        <View style={[styles.banner, { backgroundColor: "#F3E6FF" }]}>
          <Image source={require("@/assets/images/help_blur.png")} style={styles.bannerImg} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.text }]}>{t.helpScreen.bannerTitle}</Text>
            <Text style={[styles.bannerSub, { color: colors.mutedForeground }]}>{t.helpScreen.bannerSub}</Text>
          </View>
        </View>

        {/* Contact Support */}
        <TouchableOpacity style={[styles.contactCard, { backgroundColor: colors.card }]} activeOpacity={0.8} onPress={() => Linking.openURL(`mailto:${supportEmail}`)}>
          <Image source={require("@/assets/images/help_person.png")} style={styles.contactImg} resizeMode="contain" />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.contactTitle, { color: colors.text }]}>{t.helpScreen.contactTitle}</Text>
            <Text style={[styles.contactSub, { color: colors.mutedForeground }]}>{supportEmail}</Text>
          </View>
          <Image source={require("@/assets/icons/ic_back.png")} style={[styles.chevron, { transform: [{ rotate: "180deg" }] }]} tintColor={colors.mutedForeground} resizeMode="contain" />
        </TouchableOpacity>

        {/* Submit a request (in-app support ticket) */}
        <View style={[styles.requestCard, { backgroundColor: colors.card }]}>
          <View style={styles.requestHead}>
            <Text style={[styles.requestTitle, { color: colors.text }]}>{t.helpScreen.submitRequest}</Text>
            {vipPriority && (
              <View style={styles.priorityPill}>
                <Text style={styles.priorityPillText}>⚡ VIP priority</Text>
              </View>
            )}
          </View>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="Subject"
            placeholderTextColor={colors.mutedForeground}
            maxLength={200}
            editable={!submitting}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Describe your issue…"
            placeholderTextColor={colors.mutedForeground}
            maxLength={4000}
            multiline
            editable={!submitting}
            style={[styles.input, styles.inputMultiline, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <TouchableOpacity onPress={submitRequest} disabled={submitting} activeOpacity={0.85} style={[styles.submitBtn, { opacity: submitting ? 0.6 : 1 }]}>
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitBtnText}>Send request</Text>}
          </TouchableOpacity>
        </View>

        {/* FAQ */}
        <Text style={[styles.faqTitle, { color: colors.text }]}>{t.helpScreen.faqTitle}</Text>

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
  requestCard: { borderRadius: 16, padding: 16, gap: 10 },
  requestHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  requestTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  priorityPill: { backgroundColor: "#7B2FF7", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  priorityPillText: { color: "#fff", fontSize: 11, fontFamily: "Poppins_600SemiBold" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Poppins_400Regular" },
  inputMultiline: { minHeight: 90, textAlignVertical: "top" },
  submitBtn: { backgroundColor: "#7B2FF7", borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  submitBtnText: { color: "#fff", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  faqTitle: { fontSize: 16, fontFamily: "Poppins_700Bold", marginTop: 8 },
  faqItem: { borderRadius: 14, padding: 16, gap: 8 },
  faqRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  faqQ: { flex: 1, fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  faqA: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 20 },
});
