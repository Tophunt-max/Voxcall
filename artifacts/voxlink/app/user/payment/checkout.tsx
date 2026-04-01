import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { notifyPurchaseSuccess } from "@/services/NotificationService";
import LoadingOverlay from "@/components/LoadingOverlay";
import { showSuccessToast, showErrorToast } from "@/components/Toast";

type PayMethod = "card" | "paypal" | "gpay" | "applepay";

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

const PAYMENT_METHODS: Array<{ id: PayMethod; label: string; icon: any }> = [
  { id: "card",     label: "Credit / Debit Card", icon: require("@/assets/icons/ic_secure.png") },
  { id: "paypal",   label: "PayPal",               icon: require("@/assets/icons/ic_transaction.png") },
  { id: "gpay",     label: "Google Pay",            icon: require("@/assets/icons/ic_guaranteed.png") },
  { id: "applepay", label: "Apple Pay",             icon: require("@/assets/icons/ic_secure.png") },
];

export default function CheckoutScreen() {
  const colors = useColors();
  const { user, updateCoins } = useAuth();
  const [plans, setPlans] = useState<CoinPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<CoinPlan | null>(null);
  const [payMethod, setPayMethod] = useState<PayMethod>("card");
  const [loading, setLoading] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<null | { type: string; discount: number; bonus_coins: number; discount_pct: number; code: string }>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");

  useEffect(() => {
    API.getCoinPlans()
      .then((data: any[]) => {
        const active = data.filter((p) => p.is_active !== 0);
        setPlans(active);
        const popular = active.find((p) => p.is_popular) ?? active[1] ?? active[0];
        if (popular) setSelectedPlan(popular);
      })
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, []);

  const handleApplyPromo = useCallback(async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError("");
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
      const result = await API.purchaseCoins(selectedPlan.id, payMethod) as any;
      if (result?.new_balance != null) {
        updateCoins(result.new_balance);
        await notifyPurchaseSuccess(totalCoins);
        showSuccessToast(`${totalCoins.toLocaleString()} coins added!`, "Purchase Successful");
        router.replace("/user/payment/success");
      } else {
        showErrorToast("Payment failed. Please try again.", "Payment Failed");
      }
    } catch (err: any) {
      showErrorToast(err?.message || "Could not process payment. Please try again.", "Payment Failed");
    } finally {
      setLoading(false);
    }
  }, [selectedPlan, payMethod, user, totalCoins]);

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
                    ${plan.price.toFixed(2)}
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
              {promoApplied.type === "percent" ? `🎉 ${promoApplied.discount_pct}% off — Save $${promoApplied.discount.toFixed(2)}` : `🎁 +${promoApplied.bonus_coins} Bonus Coins added!`}
            </Text>
          </View>
        ) : null}

        {/* Payment Method */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Method</Text>
        <View style={[styles.methodsCard, { backgroundColor: colors.card }]}>
          {PAYMENT_METHODS.map((method, idx) => {
            const selected = method.id === payMethod;
            return (
              <TouchableOpacity
                key={method.id}
                style={[styles.methodRow, idx < PAYMENT_METHODS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight }]}
                onPress={() => setPayMethod(method.id)}
                activeOpacity={0.8}
              >
                <Image source={method.icon} style={styles.methodIcon} tintColor={colors.accent} />
                <Text style={[styles.methodLabel, { color: colors.text }]}>{method.label}</Text>
                <View style={[styles.radio, { borderColor: selected ? colors.accent : colors.border }]}>
                  {selected && <View style={[styles.radioDot, { backgroundColor: colors.accent }]} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

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
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Coins</Text>
                <Text style={[styles.summaryValue, { color: colors.coinGold, fontFamily: "Poppins_700Bold" }]}>{totalCoins.toLocaleString()}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              {(promoApplied?.bonus_coins ?? 0) > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Promo Bonus</Text>
                  <Text style={[styles.summaryValue, { color: colors.online }]}>+{promoApplied!.bonus_coins.toLocaleString()} Coins</Text>
                </View>
              )}
              {(promoApplied?.discount ?? 0) > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Promo Discount</Text>
                  <Text style={[styles.summaryValue, { color: colors.online }]}>-${promoApplied!.discount.toFixed(2)}</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>Total Price</Text>
                <Text style={[styles.totalValue, { color: colors.accent }]}>${finalPrice.toFixed(2)} {selectedPlan.currency}</Text>
              </View>
            </View>
          </>
        )}

        <View style={styles.secureRow}>
          <Image source={require("@/assets/icons/ic_secure.png")} style={styles.secureIcon} tintColor={colors.online} />
          <Text style={[styles.secureText, { color: colors.mutedForeground }]}>All payments are secured and encrypted</Text>
        </View>
      </ScrollView>

      {/* Buy Button */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.buyBtn, { backgroundColor: selectedPlan ? colors.accent : colors.border }]}
          onPress={handlePurchase}
          activeOpacity={0.88}
          disabled={!selectedPlan || loading}
        >
          <Text style={styles.buyBtnText}>
            {selectedPlan ? `Pay $${finalPrice.toFixed(2)} — Get ${totalCoins.toLocaleString()} Coins` : "Select a Package"}
          </Text>
        </TouchableOpacity>
      </View>

      <LoadingOverlay visible={loading} message="Processing payment..." />
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
  methodsCard: { borderRadius: 14, overflow: "hidden", marginBottom: 24, elevation: 2 },
  methodRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  methodIcon: { width: 22, height: 22, resizeMode: "contain" },
  methodLabel: { flex: 1, fontSize: 14, fontFamily: "Poppins_500Medium" },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  summaryCard: { borderRadius: 14, padding: 16, gap: 10, marginBottom: 12, elevation: 2 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  summaryValue: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  divider: { height: 1, marginVertical: 4 },
  totalLabel: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  totalValue: { fontSize: 17, fontFamily: "Poppins_700Bold" },
  promoRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5, marginBottom: 8, overflow: "hidden" },
  promoInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, fontSize: 14, fontFamily: "Poppins_500Medium", letterSpacing: 1 },
  promoBtn: { paddingHorizontal: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  promoBtnText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  promoError: { fontSize: 12, fontFamily: "Poppins_400Regular", marginBottom: 8 },
  promoBadge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, alignItems: "center" },
  promoBadgeText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  secureRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 8 },
  secureIcon: { width: 14, height: 14, resizeMode: "contain" },
  secureText: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 36, borderTopWidth: StyleSheet.hairlineWidth },
  buyBtn: { paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  buyBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_700Bold" },
});
