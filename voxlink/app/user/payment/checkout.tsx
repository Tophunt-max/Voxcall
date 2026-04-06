import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  TextInput,
  Dimensions,
  Platform,
  Linking,
  Alert,
  Modal,
} from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { notifyPurchaseSuccess } from "@/services/NotificationService";
import LoadingOverlay from "@/components/LoadingOverlay";
import { showSuccessToast, showErrorToast } from "@/components/Toast";
import { formatPrice, detectCurrency, getCurrencyCode } from "@/utils/currency";

const SCREEN_W = Dimensions.get("window").width;
const WALLET_BANNER_W = SCREEN_W - 40;
const AUTO_SLIDE_MS = 3500;

interface CoinPlan {
  id: string;
  name: string;
  coins: number;
  bonus_coins?: number;
  price: number;
  currency: string;
  is_popular?: number | boolean;
  is_active?: number | boolean;
}

interface Gateway {
  id: string;
  name: string;
  type: string;
  icon_emoji: string;
  instruction?: string;
  redirect_url?: string;
}

interface ManualQR {
  id: string;
  name: string;
  upi_id: string;
  qr_image_url: string;
  instructions?: string;
  rotate_interval_min: number;
}

// ─── WalletBannerSlider ───────────────────────────────────────────────────────
function WalletBannerSlider({ banners }: { banners: any[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const flatRef = useRef<FlatList<any>>(null);
  const currentIdx = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((idx: number) => {
    if (!flatRef.current || banners.length === 0) return;
    const safe = Math.max(0, Math.min(idx, banners.length - 1));
    flatRef.current.scrollToIndex({ index: safe, animated: true });
    currentIdx.current = safe;
    setActiveIdx(safe);
  }, [banners.length]);

  useEffect(() => {
    if (banners.length <= 1) return;
    timerRef.current = setInterval(() => {
      const next = (currentIdx.current + 1) % banners.length;
      goTo(next);
    }, AUTO_SLIDE_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [banners.length, goTo]);

  const onMomentumScrollEnd = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / WALLET_BANNER_W);
    currentIdx.current = idx;
    setActiveIdx(idx);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const next = (currentIdx.current + 1) % banners.length;
      goTo(next);
    }, AUTO_SLIDE_MS);
  }, [banners.length, goTo]);

  if (banners.length === 0) return null;
  return (
    <View style={wStyles.wrap}>
      <FlatList
        ref={flatRef}
        data={banners}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        keyExtractor={(b) => b.id}
        snapToInterval={WALLET_BANNER_W} decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: WALLET_BANNER_W, offset: WALLET_BANNER_W * index, index })}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={{ width: WALLET_BANNER_W }}
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.9}
            onPress={() => { if (item.cta_link) router.push(item.cta_link as any); }}
            style={[wStyles.slide, { backgroundColor: item.bg_color || "#A00EE7" }]}
          >
            <View style={wStyles.textCol}>
              <Text style={wStyles.title}>{item.title}</Text>
              {item.subtitle ? <Text style={wStyles.sub}>{item.subtitle}</Text> : null}
              {item.cta_text ? <View style={wStyles.ctaBtn}><Text style={wStyles.ctaText}>{item.cta_text}</Text></View> : null}
            </View>
          </TouchableOpacity>
        )}
      />
      {banners.length > 1 && (
        <View style={wStyles.dots}>
          {banners.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} activeOpacity={0.7}>
              <View style={[wStyles.dot, activeIdx === i && wStyles.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const wStyles = StyleSheet.create({
  wrap: { alignItems: "center", marginBottom: 24 },
  slide: { width: WALLET_BANNER_W, borderRadius: 16, padding: 18, minHeight: 100, justifyContent: "center" },
  textCol: { gap: 4 },
  title: { fontSize: 17, fontFamily: "Poppins_700Bold", color: "#fff" },
  sub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.85)" },
  ctaBtn: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  ctaText: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  dots: { flexDirection: "row", gap: 6, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D0C0E0" },
  dotActive: { width: 20, backgroundColor: "#A00EE7", borderRadius: 3 },
});

// ─── Gateway auto-selection logic ─────────────────────────────────────────────
async function tryProcessPayment(
  gateways: Gateway[],
  plan: CoinPlan,
  totalCoins: number,
  finalPrice: number,
  updateCoins: (n: number) => void,
  setLoading: (v: boolean) => void,
  promoCode?: string
): Promise<void> {
  const platform = Platform.OS;
  const promo = promoCode?.trim() || undefined;

  if (platform === "android" || platform === "ios") {
    // On mobile: use native Google Play / Apple Pay via existing purchaseCoins route
    const result = await API.purchaseCoins(plan.id, platform === "android" ? "googlepay" : "applepay", undefined, undefined, undefined, promo) as any;
    if (result?.new_balance != null) {
      updateCoins(result.new_balance);
      await notifyPurchaseSuccess(totalCoins);
      showSuccessToast(`${totalCoins.toLocaleString()} coins added!`, "Purchase Successful");
      router.replace("/user/payment/success");
    } else {
      throw new Error("Payment failed");
    }
    return;
  }

  // Web: use initiatePayment to create a server-side pending purchase, then redirect.
  // The gateway should send a webhook to auto-approve. The purchase_id is embedded in the redirect URL.
  for (let i = 0; i < gateways.length; i++) {
    const gw = gateways[i];
    try {
      // Create a server-side pending purchase (enables webhook auto-matching)
      const initiated = await API.initiatePayment({ plan_id: plan.id, gateway_id: gw.id, promo_code: promo }) as any;
      if (initiated?.redirect_url) {
        setLoading(false);
        await Linking.openURL(initiated.redirect_url);
        return;
      }
      // If gateway has no redirect URL, try direct API processing
      const result = await API.purchaseCoins(plan.id, gw.type, undefined, undefined, gw.id, promo) as any;
      if (result?.new_balance != null) {
        updateCoins(result.new_balance);
        await notifyPurchaseSuccess(totalCoins);
        showSuccessToast(`${totalCoins.toLocaleString()} coins added!`, "Purchase Successful");
        router.replace("/user/payment/success");
        return;
      }
      throw new Error("Gateway did not process payment");
    } catch (err) {
      if (i === gateways.length - 1) throw err;
    }
  }
  throw new Error("All payment gateways failed. Please try again later.");
}

// ─── Manual Payment QR Modal ──────────────────────────────────────────────────
interface ManualPayModalProps {
  visible: boolean;
  plan: CoinPlan | null;
  totalCoins: number;
  promoCode?: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ManualPayModal({ visible, plan, totalCoins, promoCode, onClose, onSuccess }: ManualPayModalProps) {
  const colors = useColors();
  const [qrData, setQrData] = useState<{ qr_codes: ManualQR[]; current: ManualQR | null; rotate_interval_min: number } | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [utr, setUtr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) return;
    setUtr("");
    setSubmitted(false);
    setQrLoading(true);
    API.getManualQR()
      .then((d: any) => setQrData(d))
      .catch(() => setQrData(null))
      .finally(() => setQrLoading(false));
  }, [visible]);

  // Auto-refresh QR based on rotate_interval_min
  useEffect(() => {
    if (!visible || !qrData?.rotate_interval_min) return;
    const intervalMs = (qrData.rotate_interval_min * 60 * 1000);
    timerRef.current = setInterval(() => {
      API.getManualQR().then((d: any) => setQrData(d)).catch(() => {});
    }, intervalMs);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [visible, qrData?.rotate_interval_min]);

  const [autoApproved, setAutoApproved] = useState(false);
  const { refreshBalance } = useAuth();


  const handleSubmit = useCallback(async () => {
    if (!utr.trim()) { Alert.alert("Required", "Please enter the UTR / transaction reference number."); return; }
    if (!plan) return;
    setSubmitting(true);
    try {
      const result = await API.submitManualDeposit({
        plan_id: plan.id,
        utr_id: utr.trim(),
        qr_code_id: qrData?.current?.id,
        promo_code: promoCode || undefined,
      }) as any;
      if (result?.status === 'success' && result?.coins_added) {
        setAutoApproved(true);
        await refreshBalance();
      }
      setSubmitted(true);
    } catch (err: any) {
      Alert.alert("Submission Failed", err?.message || "Could not submit payment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [utr, plan, qrData, promoCode, refreshBalance]);

  const currentQR = qrData?.current;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[mStyles.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[mStyles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={mStyles.closeBtn}>
            <Text style={[mStyles.closeText, { color: colors.mutedForeground }]}>✕</Text>
          </TouchableOpacity>
          <Text style={[mStyles.title, { color: colors.text }]}>Manual UPI Payment</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={mStyles.scroll}>
          {submitted ? (
            // ── Success State ──────────────────────────────────────────────
            <View style={mStyles.successWrap}>
              <View style={[mStyles.successIcon, { backgroundColor: autoApproved ? "#E8F5E9" : "#EDE7F6" }]}>
                <Text style={{ fontSize: 44 }}>{autoApproved ? "🎉" : "✅"}</Text>
              </View>
              {autoApproved && (
                <View style={[mStyles.autoBadge, { backgroundColor: "#4CAF50" }]}>
                  <Text style={mStyles.autoBadgeText}>⚡ Auto-Approved!</Text>
                </View>
              )}
              <Text style={[mStyles.successTitle, { color: colors.text }]}>
                {autoApproved ? "Coins Added!" : "Payment Submitted!"}
              </Text>
              <Text style={[mStyles.successSub, { color: colors.mutedForeground }]}>
                {autoApproved
                  ? `${totalCoins.toLocaleString()} coins have been instantly added to your account!`
                  : "Your payment is under review. Coins will be added once the admin approves it (usually within a few hours)."}
              </Text>
              <View style={[mStyles.infoCard, { backgroundColor: colors.card }]}>
                <Text style={[mStyles.infoLabel, { color: colors.mutedForeground }]}>Package</Text>
                <Text style={[mStyles.infoValue, { color: colors.text }]}>{plan?.name} — {totalCoins.toLocaleString()} Coins</Text>
                <Text style={[mStyles.infoLabel, { color: colors.mutedForeground, marginTop: 8 }]}>UTR / Ref</Text>
                <Text style={[mStyles.infoValue, { color: colors.text, fontFamily: "Poppins_500Medium" }]}>{utr}</Text>
              </View>
              <TouchableOpacity
                style={[mStyles.doneBtn, { backgroundColor: colors.accent }]}
                onPress={() => { onSuccess(); onClose(); }}
              >
                <Text style={mStyles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : qrLoading ? (
            <View style={mStyles.loadingWrap}>
              <ActivityIndicator color="#A00EE7" size="large" />
              <Text style={[mStyles.loadingText, { color: colors.mutedForeground }]}>Loading payment details...</Text>
            </View>
          ) : !currentQR ? (
            <View style={mStyles.loadingWrap}>
              <Text style={{ fontSize: 40 }}>⚠️</Text>
              <Text style={[mStyles.successTitle, { color: colors.text }]}>Unavailable</Text>
              <Text style={[mStyles.successSub, { color: colors.mutedForeground }]}>Manual payment is not available right now. Please try another payment method.</Text>
            </View>
          ) : (
            <>
              {/* Plan Summary */}
              <View style={[mStyles.planCard, { backgroundColor: colors.accentLight }]}>
                <Image source={require("@/assets/icons/ic_coin.png")} style={mStyles.planCoin} />
                <View style={{ flex: 1 }}>
                  <Text style={[mStyles.planName, { color: colors.text }]}>{plan?.name}</Text>
                  <Text style={[mStyles.planCoins, { color: colors.accent }]}>{totalCoins.toLocaleString()} Coins</Text>
                </View>
                <Text style={[mStyles.planPrice, { color: colors.text }]}>
                  {plan ? formatPrice(plan.price, getCurrencyCode()) : ""}
                </Text>
              </View>

              {/* Step 1 */}
              <View style={mStyles.stepRow}>
                <View style={[mStyles.stepBadge, { backgroundColor: "#A00EE7" }]}>
                  <Text style={mStyles.stepNum}>1</Text>
                </View>
                <Text style={[mStyles.stepTitle, { color: colors.text }]}>Scan QR or pay to UPI ID</Text>
              </View>

              {/* QR Code */}
              <View style={[mStyles.qrCard, { backgroundColor: colors.card }]}>
                <View style={mStyles.qrImageWrap}>
                  {currentQR.qr_image_url ? (
                    <Image
                      source={{ uri: currentQR.qr_image_url }}
                      style={mStyles.qrImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={[mStyles.qrPlaceholder, { backgroundColor: colors.surface }]}>
                      <Text style={{ fontSize: 36 }}>📱</Text>
                    </View>
                  )}
                  {/* Rotate badge */}
                  {qrData && qrData.qr_codes.length > 1 && (
                    <View style={[mStyles.rotateBadge, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
                      <Text style={mStyles.rotateText}>🔄 Auto-rotating</Text>
                    </View>
                  )}
                </View>
                <Text style={[mStyles.qrLabel, { color: colors.mutedForeground }]}>Pay to UPI ID</Text>
                <View style={[mStyles.upiBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[mStyles.upiId, { color: "#A00EE7" }]}>{currentQR.upi_id}</Text>
                </View>
                <Text style={[mStyles.qrName, { color: colors.mutedForeground }]}>Account: {currentQR.name}</Text>
                {currentQR.instructions ? (
                  <Text style={[mStyles.qrInstructions, { color: colors.mutedForeground }]}>{currentQR.instructions}</Text>
                ) : null}
              </View>

              {/* Step 2 */}
              <View style={mStyles.stepRow}>
                <View style={[mStyles.stepBadge, { backgroundColor: "#A00EE7" }]}>
                  <Text style={mStyles.stepNum}>2</Text>
                </View>
                <Text style={[mStyles.stepTitle, { color: colors.text }]}>Enter UTR / Transaction ID</Text>
              </View>

              <Text style={[mStyles.utrHint, { color: colors.mutedForeground }]}>
                After payment, find the 12-digit UTR or transaction reference in your UPI app.
              </Text>

              <View style={[mStyles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TextInput
                  style={[mStyles.input, { color: colors.text }]}
                  placeholder="Enter UTR / Reference No."
                  placeholderTextColor={colors.mutedForeground}
                  value={utr}
                  onChangeText={setUtr}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  selectionColor="#A00EE7"
                  underlineColorAndroid="transparent"
                />
              </View>

              {/* Note */}
              <View style={[mStyles.noteCard, { backgroundColor: "#FFF8E1", borderColor: "#FFE082" }]}>
                <Text style={[mStyles.noteTitle, { color: "#F57F17" }]}>⏱ Admin Approval Required</Text>
                <Text style={[mStyles.noteText, { color: "#795548" }]}>
                  Manual payments are verified by our team. Coins will be credited within a few hours of approval. Ensure the exact amount is paid.
                </Text>
              </View>

              {/* Submit */}
              <TouchableOpacity
                style={[mStyles.submitBtn, { backgroundColor: utr.trim() ? "#A00EE7" : colors.border }]}
                onPress={handleSubmit}
                disabled={submitting || !utr.trim()}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={mStyles.submitBtnText}>Submit Payment Proof</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const mStyles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 18 },
  title: { fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  scroll: { padding: 20, paddingBottom: 60, gap: 16 },

  planCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  planCoin: { width: 32, height: 32, resizeMode: "contain" },
  planName: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  planCoins: { fontSize: 17, fontFamily: "Poppins_700Bold" },
  planPrice: { fontSize: 16, fontFamily: "Poppins_700Bold" },

  stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNum: { color: "#fff", fontSize: 14, fontFamily: "Poppins_700Bold" },
  stepTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold", flex: 1 },

  qrCard: { borderRadius: 16, padding: 16, alignItems: "center", gap: 10 },
  qrImageWrap: { position: "relative", width: 200, height: 200 },
  qrImage: { width: 200, height: 200, borderRadius: 12 },
  qrPlaceholder: { width: 200, height: 200, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rotateBadge: { position: "absolute", bottom: 8, right: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  rotateText: { color: "#fff", fontSize: 10, fontFamily: "Poppins_500Medium" },
  qrLabel: { fontSize: 11, fontFamily: "Poppins_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
  upiBox: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, width: "100%" },
  upiId: { fontSize: 16, fontFamily: "Poppins_700Bold", textAlign: "center", letterSpacing: 0.5 },
  qrName: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  qrInstructions: { fontSize: 11, fontFamily: "Poppins_400Regular", textAlign: "center" },

  utrHint: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  inputWrap: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, height: 56, justifyContent: "center" },
  input: { fontSize: 15, fontFamily: "Poppins_500Medium", letterSpacing: 1 },

  noteCard: { borderRadius: 14, padding: 14, gap: 4, borderWidth: 1 },
  noteTitle: { fontSize: 13, fontFamily: "Poppins_700Bold" },
  noteText: { fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18 },

  submitBtn: { height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },

  loadingWrap: { alignItems: "center", paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 13, fontFamily: "Poppins_400Regular" },

  successWrap: { alignItems: "center", paddingVertical: 32, gap: 16 },
  successIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  successSub: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 20 },
  infoCard: { borderRadius: 14, padding: 16, gap: 4, width: "100%" },
  infoLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  infoValue: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  doneBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", width: "100%" },
  doneBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_700Bold" },
  autoBadge: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  autoBadgeText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold" },
});

// ─── Main CheckoutScreen ──────────────────────────────────────────────────────
export default function CheckoutScreen() {
  const colors = useColors();
  const { user, updateCoins } = useAuth();
  const userCurrency = getCurrencyCode();
  const [plans, setPlans] = useState<CoinPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<CoinPlan | null>(null);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<null | { type: string; discount: number; bonus_coins: number; discount_pct: number; code: string }>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [walletBanners, setWalletBanners] = useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"auto" | "manual">("auto");
  const [showManualModal, setShowManualModal] = useState(false);
  const [hasManualQR, setHasManualQR] = useState(false);

  useEffect(() => {
    const errors: string[] = [];
    Promise.allSettled([
      API.getCoinPlans()
        .then((data: any[]) => {
          const active = data.filter((p) => p.is_active !== 0);
          setPlans(active);
          const popular = active.find((p) => p.is_popular) ?? active[1] ?? active[0];
          if (popular) setSelectedPlan(popular);
        })
        .catch(() => { setPlans([]); errors.push("coin plans"); }),
      API.getBanners("wallet").then(setWalletBanners).catch(() => { errors.push("banners"); }),
      API.getPaymentGateways().then(setGateways).catch(() => { setGateways([]); errors.push("payment options"); }),
      API.getManualQR()
        .then((d: any) => { if (d?.current) setHasManualQR(true); })
        .catch(() => {}),
    ]).then(() => {
      if (errors.length > 0) showErrorToast(`Failed to load ${errors.join(", ")}.`);
      setPlansLoading(false);
    });
  }, []);

  const handleApplyPromo = useCallback(async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true); setPromoError("");
    try {
      const result = await API.applyPromoCode(promoCode.trim(), selectedPlan?.id) as any;
      setPromoApplied(result);
    } catch (err: any) {
      setPromoError(err?.message || "Invalid promo code");
      setPromoApplied(null);
    } finally {
      setPromoLoading(false);
    }
  }, [promoCode, selectedPlan?.id]);

  const totalCoins = selectedPlan
    ? selectedPlan.coins + (selectedPlan.bonus_coins ?? 0) + (promoApplied?.bonus_coins ?? 0)
    : 0;
  const finalPrice = selectedPlan
    ? Math.max(0, selectedPlan.price - (promoApplied?.discount ?? 0))
    : 0;

  const handlePurchase = useCallback(async () => {
    if (!user || !selectedPlan) return;
    if (paymentMethod === "manual") {
      setShowManualModal(true);
      return;
    }
    setLoading(true);
    try {
      await tryProcessPayment(gateways, selectedPlan, totalCoins, finalPrice, updateCoins, setLoading, promoCode);
    } catch (err: any) {
      showErrorToast(err?.message || "Payment failed. Please try again.", "Payment Failed");
    } finally {
      setLoading(false);
    }
  }, [selectedPlan, gateways, user, totalCoins, finalPrice, updateCoins, paymentMethod]);

  const isWeb = Platform.OS === "web";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Buy Coins</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Current Balance */}
        <View style={[styles.balanceCard, { backgroundColor: colors.accentLight }]}>
          <Image source={require("@/assets/icons/ic_coin.png")} style={styles.balanceCoin} />
          <View>
            <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>Current Balance</Text>
            <Text style={[styles.balanceValue, { color: colors.text }]}>
              {(user?.coins ?? 0).toLocaleString()} Coins
            </Text>
          </View>
        </View>

        {/* Wallet Banners */}
        <WalletBannerSlider banners={walletBanners} />

        {/* Choose Package */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose a Package</Text>
        {plansLoading ? (
          <View style={styles.plansLoading}>
            <ActivityIndicator color="#A00EE7" />
          </View>
        ) : (
          <View style={styles.plansGrid}>
            {plans.map((plan) => {
              const selected = selectedPlan?.id === plan.id;
              const bonus = plan.bonus_coins ?? 0;
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.planCard, { backgroundColor: selected ? colors.accent : colors.card, borderColor: selected ? colors.accent : colors.border }]}
                  onPress={() => setSelectedPlan(plan)}
                  activeOpacity={0.82}
                >
                  {plan.is_popular ? (
                    <View style={[styles.popularTag, { backgroundColor: colors.coinGoldBg }]}>
                      <Text style={[styles.popularTagText, { color: colors.coinGoldText }]}>Popular</Text>
                    </View>
                  ) : null}
                  {bonus > 0 ? (
                    <View style={[styles.bonusTag, { backgroundColor: colors.online }]}>
                      <Text style={styles.bonusTagText}>+{bonus}</Text>
                    </View>
                  ) : null}
                  <Image source={require("@/assets/icons/ic_coin.png")} style={styles.planCoin} />
                  <Text style={[styles.planCoins, { color: selected ? "#fff" : colors.text }]}>
                    {plan.coins.toLocaleString()}
                  </Text>
                  <Text style={[styles.planLabel, { color: selected ? "rgba(255,255,255,0.8)" : colors.mutedForeground }]}>Coins</Text>
                  <Text style={[styles.planPrice, { color: selected ? "#fff" : colors.accent }]}>
                    {formatPrice(plan.price, userCurrency)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Payment Method Selector (Web + when manual QR available) */}
        {isWeb && hasManualQR && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Method</Text>
            <View style={[styles.methodRow, { gap: 10 }]}>
              <TouchableOpacity
                onPress={() => setPaymentMethod("auto")}
                style={[styles.methodCard, { backgroundColor: paymentMethod === "auto" ? colors.accent : colors.card, borderColor: paymentMethod === "auto" ? colors.accent : colors.border }]}
                activeOpacity={0.82}
              >
                <Text style={styles.methodEmoji}>💳</Text>
                <Text style={[styles.methodLabel, { color: paymentMethod === "auto" ? "#fff" : colors.text }]}>Online</Text>
                <Text style={[styles.methodSub, { color: paymentMethod === "auto" ? "rgba(255,255,255,0.75)" : colors.mutedForeground }]}>Auto gateway</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setPaymentMethod("manual")}
                style={[styles.methodCard, { backgroundColor: paymentMethod === "manual" ? colors.accent : colors.card, borderColor: paymentMethod === "manual" ? colors.accent : colors.border }]}
                activeOpacity={0.82}
              >
                <Text style={styles.methodEmoji}>📲</Text>
                <Text style={[styles.methodLabel, { color: paymentMethod === "manual" ? "#fff" : colors.text }]}>Manual UPI</Text>
                <Text style={[styles.methodSub, { color: paymentMethod === "manual" ? "rgba(255,255,255,0.75)" : colors.mutedForeground }]}>QR / UPI ID</Text>
              </TouchableOpacity>
            </View>
            {paymentMethod === "manual" && (
              <View style={[styles.manualNote, { backgroundColor: "#FFF3E0", borderColor: "#FFB74D" }]}>
                <Text style={[styles.manualNoteText, { color: "#E65100" }]}>
                  ⏱ Manual payment requires admin approval (a few hours). Coins will be added after verification.
                </Text>
              </View>
            )}
          </>
        )}

        {/* Promo Code */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Promo Code</Text>
        <View style={[styles.promoRow, { backgroundColor: colors.card, borderColor: promoApplied ? colors.online : colors.border }]}>
          <TextInput
            style={[styles.promoInput, { color: colors.text }]}
            placeholder="Enter promo code"
            placeholderTextColor={colors.mutedForeground}
            value={promoCode}
            onChangeText={(t) => { setPromoCode(t); setPromoApplied(null); setPromoError(""); }}
            autoCapitalize="characters"
            editable={!promoApplied}
          />
          {promoApplied ? (
            <TouchableOpacity onPress={() => { setPromoApplied(null); setPromoCode(""); }} style={[styles.promoBtn, { backgroundColor: colors.destructive }]}>
              <Text style={styles.promoBtnText}>Remove</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleApplyPromo} disabled={promoLoading || !promoCode.trim()} style={[styles.promoBtn, { backgroundColor: promoCode.trim() ? colors.accent : colors.border }]}>
              {promoLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.promoBtnText}>Apply</Text>}
            </TouchableOpacity>
          )}
        </View>
        {promoError ? <Text style={[styles.promoError, { color: colors.destructive }]}>{promoError}</Text> : null}
        {promoApplied ? (
          <View style={[styles.promoBadge, { backgroundColor: colors.online + "18" }]}>
            <Text style={[styles.promoBadgeText, { color: colors.online }]}>
              {promoApplied.type === "percent"
                ? `🎉 ${promoApplied.discount_pct}% off — Save ${formatPrice(promoApplied.discount, userCurrency)}`
                : `🎁 +${promoApplied.bonus_coins} Bonus Coins added!`}
            </Text>
          </View>
        ) : null}

        {/* Order Summary */}
        {selectedPlan && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Order Summary</Text>
            <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Package</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{selectedPlan.coins.toLocaleString()} Coins</Text>
              </View>
              {(selectedPlan.bonus_coins ?? 0) > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Bonus Coins</Text>
                  <Text style={[styles.summaryValue, { color: colors.online }]}>+{selectedPlan.bonus_coins!.toLocaleString()}</Text>
                </View>
              )}
              {(promoApplied?.bonus_coins ?? 0) > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Promo Bonus</Text>
                  <Text style={[styles.summaryValue, { color: colors.online }]}>+{promoApplied!.bonus_coins.toLocaleString()} Coins</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>You Get</Text>
                <Text style={[styles.summaryValue, { color: colors.coinGold, fontFamily: "Poppins_700Bold" }]}>{totalCoins.toLocaleString()} Coins</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              {(promoApplied?.discount ?? 0) > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Promo Discount</Text>
                  <Text style={[styles.summaryValue, { color: colors.online }]}>-{formatPrice(promoApplied!.discount, userCurrency)}</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>Total</Text>
                <Text style={[styles.totalValue, { color: colors.accent }]}>{formatPrice(finalPrice, userCurrency)}</Text>
              </View>
            </View>
          </>
        )}

        <View style={styles.secureRow}>
          <Image source={require("@/assets/icons/ic_secure.png")} style={styles.secureIcon} tintColor={colors.online} />
          <Text style={[styles.secureText, { color: colors.mutedForeground }]}>Payments are 100% secured & encrypted</Text>
        </View>
      </ScrollView>

      {/* Continue / Pay Button */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.buyBtn, { backgroundColor: selectedPlan ? colors.accent : colors.border }]}
          onPress={handlePurchase}
          activeOpacity={0.88}
          disabled={!selectedPlan || loading}
        >
          <Text style={styles.buyBtnText}>
            {!selectedPlan
              ? "Select a Package"
              : paymentMethod === "manual"
              ? `Pay via UPI — ${formatPrice(finalPrice, userCurrency)} for ${totalCoins.toLocaleString()} Coins`
              : `Continue — ${formatPrice(finalPrice, userCurrency)} for ${totalCoins.toLocaleString()} Coins`}
          </Text>
        </TouchableOpacity>
      </View>

      <LoadingOverlay visible={loading} message="Redirecting to payment..." />

      <ManualPayModal
        visible={showManualModal}
        plan={selectedPlan}
        totalCoins={totalCoins}
        promoCode={promoApplied ? promoCode : undefined}
        onClose={() => setShowManualModal(false)}
        onSuccess={() => showSuccessToast("Payment submitted for review!", "Submitted")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 52, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 40, alignItems: "flex-start" },
  backIcon: { width: 20, height: 20, resizeMode: "contain" },
  headerTitle: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  scroll: { padding: 20, paddingBottom: 120 },
  balanceCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 14, marginBottom: 24 },
  balanceCoin: { width: 40, height: 40, resizeMode: "contain" },
  balanceLabel: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  balanceValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  sectionTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold", marginBottom: 12, marginTop: 4 },
  plansLoading: { height: 120, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  plansGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  planCard: { width: "30%", minWidth: 90, padding: 12, borderRadius: 14, borderWidth: 2, alignItems: "center", gap: 4, position: "relative" },
  popularTag: { position: "absolute", top: -8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  popularTagText: { fontSize: 9, fontFamily: "Poppins_600SemiBold" },
  bonusTag: { position: "absolute", top: 6, right: 6, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8 },
  bonusTagText: { fontSize: 8, color: "#fff", fontFamily: "Poppins_600SemiBold" },
  planCoin: { width: 28, height: 28, resizeMode: "contain" },
  planCoins: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  planLabel: { fontSize: 10, fontFamily: "Poppins_400Regular" },
  planPrice: { fontSize: 13, fontFamily: "Poppins_600SemiBold", marginTop: 2 },
  methodRow: { flexDirection: "row", marginBottom: 8 },
  methodCard: { flex: 1, borderRadius: 14, borderWidth: 2, padding: 14, alignItems: "center", gap: 4 },
  methodEmoji: { fontSize: 24 },
  methodLabel: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  methodSub: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  manualNote: { borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1 },
  manualNoteText: { fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18 },
  promoRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5, marginBottom: 8, overflow: "hidden" },
  promoInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, fontSize: 14, fontFamily: "Poppins_500Medium", letterSpacing: 1 },
  promoBtn: { paddingHorizontal: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  promoBtnText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  promoError: { fontSize: 12, fontFamily: "Poppins_400Regular", marginBottom: 8 },
  promoBadge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, alignItems: "center" },
  promoBadgeText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  summaryCard: { borderRadius: 14, padding: 16, gap: 10, marginBottom: 12, elevation: 2 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  summaryValue: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  divider: { height: 1, marginVertical: 4 },
  totalLabel: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  totalValue: { fontSize: 17, fontFamily: "Poppins_700Bold" },
  secureRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 8 },
  secureIcon: { width: 14, height: 14, resizeMode: "contain" },
  secureText: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 36, borderTopWidth: StyleSheet.hairlineWidth },
  buyBtn: { paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  buyBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_700Bold" },
});
