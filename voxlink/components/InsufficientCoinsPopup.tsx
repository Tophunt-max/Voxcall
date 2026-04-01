import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { router } from "expo-router";
import { API } from "@/services/api";
import { showErrorToast } from "@/components/Toast";

const { width: SW } = Dimensions.get("window");
const ACCENT = "#A00EE7";
const COIN_GOLD = "#E49F14";

interface Props {
  visible: boolean;
  onClose: () => void;
  requiredCoins: number;
  currentCoins: number;
}

export function InsufficientCoinsPopup({ visible, onClose, requiredCoins, currentCoins }: Props) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      API.getCoinPlans()
        .then((p) => setPlans(p ?? []))
        .catch(() => {
          showErrorToast("Could not load coin plans");
          setPlans([]);
        })
        .finally(() => setLoading(false));
    }
  }, [visible]);

  const handleBuyPlan = (plan: any) => {
    onClose();
    router.push({ pathname: "/user/payment/checkout", params: { planId: plan.id } });
  };

  const handleGoToWallet = () => {
    onClose();
    router.push("/user/payment/checkout");
  };

  const shortage = Math.max(0, requiredCoins - currentCoins);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose}>
        <View style={st.popup} onStartShouldSetResponder={() => true}>
          <View style={st.handle} />

          <Image
            source={require("@/assets/icons/ic_coin.png")}
            style={st.headerIcon}
            resizeMode="contain"
          />
          <Text style={st.title}>Insufficient Coins</Text>
          <Text style={st.subtitle}>
            You need at least <Text style={st.bold}>{requiredCoins} coins</Text> to start this call.
            {"\n"}You have <Text style={st.bold}>{currentCoins} coins</Text> — need{" "}
            <Text style={st.bold}>{shortage} more</Text>.
          </Text>

          {loading ? (
            <ActivityIndicator size="small" color={ACCENT} style={{ marginVertical: 20 }} />
          ) : plans.length > 0 ? (
            <ScrollView
              style={st.plansList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={st.plansContent}
            >
              {plans.slice(0, 4).map((plan) => {
                const totalCoins = (plan.coins || 0) + (plan.bonus_coins || 0);
                const isRecommended = totalCoins >= shortage;
                return (
                  <TouchableOpacity
                    key={plan.id}
                    onPress={() => handleBuyPlan(plan)}
                    activeOpacity={0.85}
                    style={[
                      st.planCard,
                      isRecommended && st.planCardRecommended,
                    ]}
                  >
                    {isRecommended && !plans.slice(0, plans.indexOf(plan)).some(p => (p.coins || 0) + (p.bonus_coins || 0) >= shortage) && (
                      <View style={st.recBadge}>
                        <Text style={st.recBadgeTxt}>Best Pick</Text>
                      </View>
                    )}
                    <View style={st.planLeft}>
                      <Image
                        source={require("@/assets/icons/ic_coin.png")}
                        style={st.planCoinIco}
                        resizeMode="contain"
                      />
                      <View>
                        <Text style={st.planCoins}>{(plan.coins || 0).toLocaleString()} coins</Text>
                        {plan.bonus_coins > 0 && (
                          <Text style={st.planBonus}>+{plan.bonus_coins} bonus</Text>
                        )}
                      </View>
                    </View>
                    <View style={st.planRight}>
                      <Text style={st.planPrice}>
                        {plan.currency === "INR" ? "₹" : "$"}
                        {plan.price}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={st.noPlansTxt}>No coin plans available right now.</Text>
          )}

          <TouchableOpacity onPress={handleGoToWallet} style={st.walletBtn} activeOpacity={0.85}>
            <Text style={st.walletBtnTxt}>Go to Wallet</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={st.cancelBtn} activeOpacity={0.85}>
            <Text style={st.cancelBtnTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  popup: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 30,
    maxHeight: "75%",
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    marginTop: 10,
    marginBottom: 16,
  },
  headerIcon: {
    width: 48,
    height: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: "Poppins_700Bold",
    color: "#111329",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Poppins_400Regular",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  bold: {
    fontFamily: "Poppins_700Bold",
    color: "#111329",
  },
  plansList: {
    width: "100%",
    maxHeight: 240,
  },
  plansContent: {
    gap: 8,
    paddingBottom: 8,
  },
  planCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F9F5FF",
    borderWidth: 1,
    borderColor: "#E9D5FB",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  planCardRecommended: {
    borderColor: ACCENT,
    backgroundColor: "#F3E6FF",
    borderWidth: 1.5,
  },
  recBadge: {
    position: "absolute",
    top: -8,
    right: 12,
    backgroundColor: ACCENT,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  recBadgeTxt: {
    fontSize: 9,
    fontFamily: "Poppins_600SemiBold",
    color: "#fff",
  },
  planLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  planCoinIco: {
    width: 28,
    height: 28,
  },
  planCoins: {
    fontSize: 14,
    fontFamily: "Poppins_700Bold",
    color: "#111329",
  },
  planBonus: {
    fontSize: 11,
    fontFamily: "Poppins_500Medium",
    color: COIN_GOLD,
  },
  planRight: {
    alignItems: "flex-end",
  },
  planPrice: {
    fontSize: 16,
    fontFamily: "Poppins_700Bold",
    color: ACCENT,
  },
  noPlansTxt: {
    fontSize: 13,
    fontFamily: "Poppins_400Regular",
    color: "#9CA3AF",
    textAlign: "center",
    marginVertical: 20,
  },
  walletBtn: {
    width: "100%",
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  walletBtnTxt: {
    fontSize: 15,
    fontFamily: "Poppins_700Bold",
    color: "#fff",
  },
  cancelBtn: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 6,
  },
  cancelBtnTxt: {
    fontSize: 14,
    fontFamily: "Poppins_500Medium",
    color: "#6B7280",
  },
});
