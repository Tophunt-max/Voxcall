// Payout Method screen — host picks their preferred payout channel
// (bank/UPI/Paytm/PhonePe) and saves the channel-specific details.
//
// Replaces the prior "Coming Soon" alert in Settings. Both the picker and
// each channel's detail fields are persisted through a single PATCH /api/
// host/me call so the wallet/withdraw flow can pre-populate later.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, KeyboardAvoidingView, Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import { WEB_INPUT_RESET } from "@workspace/shared-ui/utils";

type Method = "bank" | "upi" | "paytm" | "phonepe";

interface MethodConfig {
  id: Method;
  label: string;
  emoji: string;
  fields: { key: string; label: string; placeholder: string; keyboardType?: "default" | "phone-pad" | "number-pad" }[];
}

// Field definitions per channel. Keys MUST match what the backend persists in
// hosts.payout_details (free-form JSON object, validated by zod's record shape).
const METHODS: MethodConfig[] = [
  {
    id: "bank",
    label: "Bank Account",
    emoji: "🏦",
    fields: [
      { key: "account_holder", label: "Account Holder Name", placeholder: "Full name on the account" },
      { key: "account_number", label: "Account Number", placeholder: "1234567890", keyboardType: "number-pad" },
      { key: "ifsc", label: "IFSC Code", placeholder: "HDFC0001234" },
      { key: "bank_name", label: "Bank Name", placeholder: "HDFC Bank" },
    ],
  },
  {
    id: "upi",
    label: "UPI",
    emoji: "💸",
    fields: [
      { key: "upi_id", label: "UPI ID", placeholder: "yourname@okhdfcbank" },
    ],
  },
  {
    id: "paytm",
    label: "Paytm",
    emoji: "📱",
    fields: [
      { key: "phone_number", label: "Paytm Phone Number", placeholder: "9876543210", keyboardType: "phone-pad" },
    ],
  },
  {
    id: "phonepe",
    label: "PhonePe",
    emoji: "💜",
    fields: [
      { key: "phone_number", label: "PhonePe Phone Number", placeholder: "9876543210", keyboardType: "phone-pad" },
    ],
  },
];

// Per-channel validation. Returns null when the form is valid, or an error
// message to surface in a toast. Keep client validation lenient — the server
// is the authority — but block obviously empty/malformed submissions.
function validate(method: Method, details: Record<string, string>, tr2: any): string | null {
  if (method === "bank") {
    if (!details.account_holder?.trim()) return tr2.payoutMethodScreen.holderRequired;
    if (!details.account_number?.trim() || details.account_number.length < 6) return tr2.payoutMethodScreen.accountInvalid;
    // IFSC: 4 letters + 0 + 6 alphanumeric (Indian standard)
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(details.ifsc?.trim() ?? "")) return tr2.payoutMethodScreen.ifscInvalid;
    if (!details.bank_name?.trim()) return tr2.payoutMethodScreen.bankRequired;
  } else if (method === "upi") {
    if (!/^[\w.\-]+@[\w.\-]+$/.test(details.upi_id?.trim() ?? "")) return tr2.payoutMethodScreen.upiInvalid;
  } else if (method === "paytm" || method === "phonepe") {
    const digits = (details.phone_number ?? "").replace(/\D/g, "");
    if (digits.length < 10) return tr2.payoutMethodScreen.phoneInvalid;
  }
  return null;
}

export default function PayoutMethodScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Method>("bank");
  // One details record per method — switching methods preserves what the host
  // already typed for the previous channel in case they switch back.
  const [allDetails, setAllDetails] = useState<Record<Method, Record<string, string>>>({
    bank: {},
    upi: {},
    paytm: {},
    phonepe: {},
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me: any = await API.getHostMe();
        if (cancelled) return;
        const savedMethod = (me?.payout_method as Method) || "bank";
        const savedDetails = (me?.payout_details ?? {}) as Record<string, string>;
        setSelected(savedMethod);
        setAllDetails((prev) => ({ ...prev, [savedMethod]: savedDetails }));
      } catch (e) {
        console.warn("[PayoutMethod] getHostMe failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const currentMethod = useMemo(() => METHODS.find((m) => m.id === selected)!, [selected]);
  const currentDetails = allDetails[selected] ?? {};

  const setField = useCallback((key: string, val: string) => {
    setAllDetails((prev) => ({
      ...prev,
      [selected]: { ...(prev[selected] ?? {}), [key]: val },
    }));
  }, [selected]);

  const handleSave = useCallback(async () => {
    const err = validate(selected, currentDetails, t);
    if (err) {
      showErrorToast(err);
      return;
    }
    setSaving(true);
    try {
      await API.updateHostProfile({
        payout_method: selected,
        payout_details: currentDetails,
      });
      showSuccessToast(t.payoutMethodScreen.saved, t.payoutMethodScreen.savedTitle);
      router.back();
    } catch (e: any) {
      showErrorToast(e?.message || t.payoutMethodScreen.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [selected, currentDetails]);

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIconImg} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t.payoutMethodScreen.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          {t.payoutMethodScreen.help}
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.payoutMethodScreen.channel}</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {METHODS.map((m) => {
            const isSel = selected === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.methodRow, { borderBottomColor: colors.border }]}
                onPress={() => setSelected(m.id)}
                activeOpacity={0.75}
              >
                <Text style={styles.methodEmoji}>{m.emoji}</Text>
                <Text style={[styles.methodLabel, { color: colors.text }]}>{m.label}</Text>
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: isSel ? colors.primary : colors.border,
                      backgroundColor: isSel ? colors.primary : "transparent",
                    },
                  ]}
                >
                  {isSel && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Details</Text>
        <View style={[styles.card, { backgroundColor: colors.card, padding: 14 }]}>
          {currentMethod.fields.map((f) => (
            <View key={f.key} style={{ marginBottom: 12 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                placeholder={f.placeholder}
                placeholderTextColor={colors.mutedForeground}
                value={currentDetails[f.key] ?? ""}
                onChangeText={(t) => setField(f.key, t)}
                keyboardType={f.keyboardType ?? "default"}
                autoCapitalize={f.key === "ifsc" ? "characters" : "none"}
                autoCorrect={false}
              />
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: saving ? colors.mutedForeground : colors.primary }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save Payout Method</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIconImg: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  helpText: { fontSize: 13, fontFamily: "Poppins_400Regular", marginHorizontal: 16, marginTop: 16, lineHeight: 19 },
  sectionLabel: {
    fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase",
    letterSpacing: 0.5, marginHorizontal: 16, marginTop: 20, marginBottom: 6,
  },
  card: { marginHorizontal: 16, borderRadius: 12, overflow: "hidden" },
  methodRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 14, gap: 12, borderBottomWidth: 1,
  },
  methodEmoji: { fontSize: 22 },
  methodLabel: { flex: 1, fontSize: 15, fontFamily: "Poppins_500Medium" },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff" },
  fieldLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", marginBottom: 6 },
  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 14, fontFamily: "Poppins_400Regular",
    ...(WEB_INPUT_RESET as any),
  },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1,
  },
  saveBtn: {
    height: 50, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
