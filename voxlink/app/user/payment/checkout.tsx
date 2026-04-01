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

// ─── Gateway auto-selection logic (hidden from user) ─────────────────────────
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

  // On mobile, use native payment flow (Google Pay / Apple Pay) — no redirect
  if (platform === "android" || platform === "ios") {
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

  // On web: try gateways in order (primary first, then fallbacks)
  for (let i = 0; i < gateways.length; i++) {
    const gw = gateways[i];
    try {
      if (gw.redirect_url && gw.redirect_url.startsWith("http")) {
        // Build redirect URL with purchase params
        const params = new URLSearchParams({
          plan_id: plan.id,
          coins: String(totalCoins),
          amount: finalPrice.toFixed(2),
          currency: userCurrency,
          gateway: gw.type,
          source: "voxlink",
        });
        const url = `${gw.redirect_url}?${params.toString()}`;
        setLoading(false);
        await Linking.openURL(url);
        return; // redirect happened — stop
      } else {
        const result = await API.purchaseCoins(plan.id, gw.type, undefined, undefined, (gw as any).id, promo) as any;
        if (result?.new_balance != null) {
          updateCoins(result.new_balance);
          await notifyPurchaseSuccess(totalCoins);
          showSuccessToast(`${totalCoins.toLocaleString()} coins added!`, "Purchase Successful");
          router.replace("/user/payment/success");
          return;
        }
        throw new Error("Gateway did not process payment");
      }
    } catch (err) {
      // This gateway failed — try next one
      if (i === gateways.length - 1) throw err; // no more gateways
      // else continue to next gateway silently
    }
  }

  throw new Error("All payment gateways failed. Please try again later.");
}

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
    setLoading(true);
    try {
      await tryProcessPayment(gateways, selectedPlan, totalCoins, finalPrice, updateCoins, setLoading, promoCode);
    } catch (err: any) {
      showErrorToast(err?.message || "Payment failed. Please try again.", "Payment Failed");
    } finally {
      setLoading(false);
    }
  }, [selectedPlan, gateways, user, totalCoins, finalPrice, updateCoins]);

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
            {selectedPlan
              ? `Continue — ${formatPrice(finalPrice, userCurrency)} for ${totalCoins.toLocaleString()} Coins`
              : "Select a Package"}
          </Text>
        </TouchableOpacity>
      </View>

      <LoadingOverlay visible={loading} message="Redirecting to payment..." />
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
