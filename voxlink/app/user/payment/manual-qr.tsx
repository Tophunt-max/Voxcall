// ─── Manual QR Payment Page ──────────────────────────────────────────────────
// Full-screen payment page for Manual UPI/QR payments.
// Shows the active QR code, UPI ID (tap to copy), UTR input, and submits
// the deposit for admin approval.
//
// Navigation: router.push({ pathname: "/user/payment/manual-qr", params: { plan_id, plan_name, coins, price, currency } })

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image,
  TextInput, ActivityIndicator, Platform, Animated, Easing,
  KeyboardAvoidingView, Clipboard,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { API } from "@/services/api";
import { showSuccessToast, showErrorToast } from "@/components/Toast";
import { formatLocalAmount } from "@/utils/currency";
import * as Haptics from "expo-haptics";

interface ManualQR {
  id: string;
  name: string;
  upi_id: string;
  qr_image_url: string;
  instructions?: string;
  rotate_interval_min: number;
}

type PageState = "loading" | "payment" | "submitting" | "success" | "error";

export default function ManualQRPaymentPage() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { updateCoins } = useAuth();
  const { t } = useLanguage();
  const params = useLocalSearchParams<{
    plan_id: string;
    plan_name: string;
    coins: string;
    price: string;
    currency: string;
    promo_code?: string;
  }>();

  const [state, setState] = useState<PageState>("loading");
  const [qrCodes, setQrCodes] = useState<ManualQR[]>([]);
  const [currentQR, setCurrentQR] = useState<ManualQR | null>(null);
  const [rotateMin, setRotateMin] = useState(30);
  const [utr, setUtr] = useState("");
  const [copied, setCopied] = useState(false);
  const [autoApproved, setAutoApproved] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const planName = params.plan_name || t.checkout.coinPack;
  const totalCoins = parseInt(params.coins || "0");
  const price = parseFloat(params.price || "0");
  const currency = params.currency || "INR";

  // Load QR codes
  useEffect(() => {
    loadQR();
  }, []);

  const loadQR = async () => {
    setState("loading");
    try {
      const data = await API.getManualQR();
      setQrCodes(data.qr_codes || []);
      setCurrentQR(data.current || null);
      setRotateMin(data.rotate_interval_min || 30);
      setState(data.current ? "payment" : "error");
    } catch (e) {
      console.warn("[manual-qr] load failed:", e);
      setState("error");
    }
  };

  // Auto-refresh QR rotation
  useEffect(() => {
    if (state !== "payment" || rotateMin <= 0) return;
    timerRef.current = setInterval(() => {
      API.getManualQR()
        .then((d: any) => {
          setQrCodes(d.qr_codes || []);
          setCurrentQR(d.current || null);
        })
        .catch(() => {});
    }, rotateMin * 60 * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state, rotateMin]);

  // Pulse animation for QR
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.02, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Copy UPI ID
  const handleCopyUPI = useCallback(() => {
    if (!currentQR?.upi_id) return;
    try {
      if (Platform.OS === "web") {
        navigator.clipboard?.writeText(currentQR.upi_id);
      } else {
        Clipboard.setString(currentQR.upi_id);
      }
      setCopied(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [currentQR]);

  // Submit UTR
  const handleSubmit = useCallback(async () => {
    const trimmedUtr = utr.trim();
    if (!trimmedUtr) {
      showErrorToast(t.checkout.utrRequiredMsg2, t.common.required);
      return;
    }
    if (trimmedUtr.length < 6) {
      showErrorToast(t.checkout.utrTooShort, t.checkout.invalidUtr);
      return;
    }
    if (!params.plan_id) {
      showErrorToast(t.checkout.planMissing, t.calls.errorTitle);
      return;
    }

    setState("submitting");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await API.submitManualDeposit({
        plan_id: params.plan_id,
        utr_id: trimmedUtr,
        qr_code_id: currentQR?.id,
        promo_code: params.promo_code || undefined,
      });

      if ((result as any)?.status === "success" && (result as any)?.coins_added) {
        setAutoApproved(true);
        try {
          const bal = await API.getBalance();
          if (bal?.coins != null) updateCoins(bal.coins);
        } catch {}
      }
      setState("success");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setState("payment");
      showErrorToast(e?.message || t.checkout.submissionFailedShort, t.calls.errorTitle);
    }
  }, [utr, params, currentQR, updateCoins]);

  const handleDone = () => {
    if (autoApproved) {
      router.replace("/user/payment/success");
    } else {
      router.back();
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  if (state === "loading") {
    return (
      <View style={[s.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Header colors={colors} />
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={[s.loadingText, { color: colors.mutedForeground }]}>{t.checkout.loadingPayment}</Text>
        </View>
      </View>
    );
  }

  if (state === "error") {
    return (
      <View style={[s.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Header colors={colors} />
        <View style={s.center}>
          <Text style={{ fontSize: 48 }}>😔</Text>
          <Text style={[s.errorTitle, { color: colors.text }]}>{t.checkout.notAvailable}</Text>
          <Text style={[s.errorSub, { color: colors.mutedForeground }]}>
            {t.checkout.manualUnavailable}
          </Text>
          <TouchableOpacity style={[s.retryBtn, { borderColor: colors.accent }]} onPress={loadQR}>
            <Text style={[s.retryBtnText, { color: colors.accent }]}>{t.checkout.retry}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (state === "success") {
    return (
      <View style={[s.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Header colors={colors} />
        <View style={s.center}>
          <View style={[s.successCircle, { backgroundColor: autoApproved ? "#E8F5E9" : "#EDE7F6" }]}>
            <Text style={{ fontSize: 52 }}>{autoApproved ? "🎉" : "⏳"}</Text>
          </View>
          {autoApproved && (
            <View style={s.autoBadge}>
              <Text style={s.autoBadgeText}>{t.checkout.instantApproval}</Text>
            </View>
          )}
          <Text style={[s.successTitle, { color: colors.text }]}>
            {autoApproved ? t.checkout.coinsAdded : t.checkout.paymentSubmitted}
          </Text>
          <Text style={[s.successSub, { color: colors.mutedForeground }]}>
            {autoApproved
              ? t.checkout.coinsAddedWallet.replace("{count}", totalCoins.toLocaleString())
              : t.checkout.beingReviewed}
          </Text>
          <View style={[s.receiptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.receiptRow}>
              <Text style={[s.receiptLabel, { color: colors.mutedForeground }]}>{t.checkout.package}</Text>
              <Text style={[s.receiptValue, { color: colors.text }]}>{planName}</Text>
            </View>
            <View style={s.receiptRow}>
              <Text style={[s.receiptLabel, { color: colors.mutedForeground }]}>{t.wallet.coins}</Text>
              <Text style={[s.receiptValue, { color: colors.accent }]}>{totalCoins.toLocaleString()}</Text>
            </View>
            <View style={s.receiptRow}>
              <Text style={[s.receiptLabel, { color: colors.mutedForeground }]}>{t.checkout.amount}</Text>
              <Text style={[s.receiptValue, { color: colors.text }]}>{formatLocalAmount(price, currency)}</Text>
            </View>
            <View style={s.receiptRow}>
              <Text style={[s.receiptLabel, { color: colors.mutedForeground }]}>{t.checkout.utrRef}</Text>
              <Text style={[s.receiptValue, { color: colors.text }]}>{utr}</Text>
            </View>
            <View style={s.receiptRow}>
              <Text style={[s.receiptLabel, { color: colors.mutedForeground }]}>{t.checkout.status}</Text>
              <View style={[s.statusBadge, { backgroundColor: autoApproved ? "#E8F5E9" : "#FFF3E0" }]}>
                <Text style={[s.statusText, { color: autoApproved ? "#2E7D32" : "#E65100" }]}>
                  {autoApproved ? t.checkout.approved : t.checkout.pendingReview}
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={[s.doneBtn, { backgroundColor: colors.accent }]} onPress={handleDone}>
            <Text style={s.doneBtnText}>{t.common.done}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── PAYMENT STATE ──────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: colors.background, paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Header colors={colors} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Plan Summary Bar */}
        <View style={[s.planBar, { backgroundColor: colors.accentLight }]}>
          <Image source={require("@/assets/icons/ic_coin.png")} style={s.planIcon} />
          <View style={{ flex: 1 }}>
            <Text style={[s.planName, { color: colors.text }]}>{planName}</Text>
            <Text style={[s.planCoins, { color: colors.accent }]}>
              {totalCoins.toLocaleString()} Coins
            </Text>
          </View>
          <Text style={[s.planPrice, { color: colors.text }]}>
            {formatLocalAmount(price, currency)}
          </Text>
        </View>

        {/* ─── STEP 1: Scan QR ─── */}
        <View style={s.stepSection}>
          <View style={s.stepHeader}>
            <View style={s.stepBadge}>
              <Text style={s.stepNum}>1</Text>
            </View>
            <Text style={[s.stepTitle, { color: colors.text }]}>{t.checkout.scanQrPay}</Text>
          </View>

          {/* QR Card */}
          <Animated.View style={[s.qrCard, { backgroundColor: colors.card, borderColor: colors.border, transform: [{ scale: pulseAnim }] }]}>
            {currentQR?.qr_image_url ? (
              <Image
                source={{ uri: currentQR.qr_image_url }}
                style={s.qrImage}
                resizeMode="contain"
              />
            ) : (
              <View style={[s.qrPlaceholder, { backgroundColor: colors.surface }]}>
                <Text style={{ fontSize: 40 }}>📱</Text>
                <Text style={[s.placeholderText, { color: colors.mutedForeground }]}>{t.checkout.qrNotAvailable}</Text>
              </View>
            )}
          </Animated.View>

          {/* UPI ID - tap to copy */}
          <TouchableOpacity
            style={[s.upiCard, { backgroundColor: colors.card, borderColor: copied ? "#4CAF50" : colors.border }]}
            onPress={handleCopyUPI}
            activeOpacity={0.7}
          >
            <View style={s.upiLeft}>
              <Text style={[s.upiLabel, { color: colors.mutedForeground }]}>{t.checkout.upiId}</Text>
              <Text style={[s.upiId, { color: colors.accent }]}>{currentQR?.upi_id}</Text>
            </View>
            <View style={[s.copyBtn, { backgroundColor: copied ? "#E8F5E9" : colors.accentLight }]}>
              <Text style={[s.copyText, { color: copied ? "#2E7D32" : colors.accent }]}>
                {copied ? t.common.copied : t.checkout.copy}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Account name */}
          <Text style={[s.accountName, { color: colors.mutedForeground }]}>
            {t.checkout.account} {currentQR?.name}
          </Text>

          {/* Amount reminder */}
          <View style={[s.amountReminder, { backgroundColor: "#FFF8E1", borderColor: "#FFE082" }]}>
            <Text style={[s.reminderText, { color: "#F57F17" }]}>
              {t.checkout.payExactly.replace("{amount}", formatLocalAmount(price, currency))}
            </Text>
          </View>

          {currentQR?.instructions ? (
            <Text style={[s.instructions, { color: colors.mutedForeground }]}>
              {currentQR.instructions}
            </Text>
          ) : null}
        </View>

        {/* ─── STEP 2: Enter UTR ─── */}
        <View style={s.stepSection}>
          <View style={s.stepHeader}>
            <View style={s.stepBadge}>
              <Text style={s.stepNum}>2</Text>
            </View>
            <Text style={[s.stepTitle, { color: colors.text }]}>{t.checkout.enterUtrStep}</Text>
          </View>

          <Text style={[s.utrHint, { color: colors.mutedForeground }]}>
            {t.checkout.utrHintHistory}
          </Text>

          <View style={[s.inputContainer, { backgroundColor: colors.card, borderColor: utr.trim().length >= 6 ? "#4CAF50" : colors.border }]}>
            <TextInput
              style={[s.input, { color: colors.text }]}
              placeholder={t.checkout.utrExample}
              placeholderTextColor={colors.mutedForeground}
              value={utr}
              onChangeText={setUtr}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
              returnKeyType="done"
              selectionColor={colors.accent}
              onSubmitEditing={handleSubmit}
            />
            {utr.trim().length >= 6 && (
              <View style={s.checkMark}>
                <Text style={{ color: "#4CAF50", fontSize: 16 }}>✓</Text>
              </View>
            )}
          </View>

          {/* Where to find UTR hint */}
          <View style={[s.hintCard, { backgroundColor: colors.surface }]}>
            <Text style={[s.hintTitle, { color: colors.text }]}>{t.checkout.whereUtr}</Text>
            <Text style={[s.hintText, { color: colors.mutedForeground }]}>
              {t.checkout.whereUtrText}
            </Text>
          </View>
        </View>

        {/* ─── Info Note ─── */}
        <View style={[s.noteCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[s.noteIcon]}>ℹ️</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.noteText, { color: colors.mutedForeground }]}>
              {t.checkout.verifyNote}
            </Text>
          </View>
        </View>

        {/* ─── Submit Button ─── */}
        <TouchableOpacity
          style={[
            s.submitBtn,
            { backgroundColor: utr.trim().length >= 6 ? colors.accent : colors.border },
          ]}
          onPress={handleSubmit}
          disabled={state === "submitting" || utr.trim().length < 6}
          activeOpacity={0.8}
        >
          {state === "submitting" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.submitText}>
              {utr.trim().length >= 6 ? t.checkout.submitPayment : t.checkout.enterUtrContinue}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Header Component ────────────────────────────────────────────────────────
function Header({ colors }: { colors: any }) {
  const { t } = useLanguage();
  return (
    <View style={[s.header, { borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={() => router.back()} style={s.backBtn} accessibilityRole="button" accessibilityLabel={t.notificationsScreen.goBack}>
        <Text style={[s.backIcon, { color: colors.text }]}>←</Text>
      </TouchableOpacity>
      <Text style={[s.headerTitle, { color: colors.text }]}>{t.checkout.upiQrPayment}</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  scroll: { padding: 20, gap: 20 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 22 },
  headerTitle: { fontSize: 16, fontFamily: "Poppins_600SemiBold" },

  loadingText: { fontSize: 14, fontFamily: "Poppins_400Regular", marginTop: 12 },
  errorTitle: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  errorSub: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 22 },
  retryBtn: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 10, marginTop: 8 },
  retryBtnText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },

  // Plan bar
  planBar: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16 },
  planIcon: { width: 36, height: 36, resizeMode: "contain" },
  planName: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  planCoins: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  planPrice: { fontSize: 17, fontFamily: "Poppins_700Bold" },

  // Steps
  stepSection: { gap: 12 },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  stepNum: { color: "#fff", fontSize: 15, fontFamily: "Poppins_700Bold" },
  stepTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold", flex: 1 },

  // QR
  qrCard: { alignItems: "center", padding: 20, borderRadius: 20, borderWidth: 1 },
  qrImage: { width: 220, height: 220, borderRadius: 16 },
  qrPlaceholder: { width: 220, height: 220, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  placeholderText: { fontSize: 12, marginTop: 8, fontFamily: "Poppins_400Regular" },

  // UPI
  upiCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1.5, gap: 12 },
  upiLeft: { flex: 1, gap: 2 },
  upiLabel: { fontSize: 11, fontFamily: "Poppins_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
  upiId: { fontSize: 16, fontFamily: "Poppins_700Bold", letterSpacing: 0.3 },
  copyBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  copyText: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  accountName: { fontSize: 12, fontFamily: "Poppins_400Regular", marginLeft: 4 },

  amountReminder: { borderWidth: 1, borderRadius: 12, padding: 12, alignItems: "center" },
  reminderText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  instructions: { fontSize: 12, fontFamily: "Poppins_400Regular", textAlign: "center" },

  // UTR Input
  utrHint: { fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18 },
  inputContainer: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, height: 56 },
  input: { flex: 1, fontSize: 16, fontFamily: "Poppins_600SemiBold", letterSpacing: 1.5 },
  checkMark: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#E8F5E9", alignItems: "center", justifyContent: "center" },

  hintCard: { borderRadius: 12, padding: 12, gap: 4 },
  hintTitle: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  hintText: { fontSize: 11, fontFamily: "Poppins_400Regular", lineHeight: 17 },

  // Note
  noteCard: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "flex-start" },
  noteIcon: { fontSize: 16 },
  noteText: { fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18 },

  // Submit
  submitBtn: { height: 58, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 4 },
  submitText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },

  // Success
  successCircle: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" },
  autoBadge: { backgroundColor: "#4CAF50", paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20 },
  autoBadgeText: { color: "#fff", fontSize: 12, fontFamily: "Poppins_700Bold" },
  successTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", textAlign: "center" },
  successSub: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 22 },

  receiptCard: { width: "100%", borderRadius: 16, padding: 16, gap: 12, borderWidth: 1 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  receiptLabel: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  receiptValue: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Poppins_700Bold" },

  doneBtn: { width: "100%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 },
  doneBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
});
