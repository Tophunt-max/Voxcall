import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Platform,
  Alert,
  Image,
  ImageBackground,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import {
  COIN_PLANS,
  MOCK_CALL_HISTORY,
  formatDuration,
  formatRelativeTime,
} from "@/data/mockData";

export default function WalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateCoins } = useAuth();
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [tab, setTab] = useState<"buy" | "history">("buy");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handlePurchase = async (planId: string, coins: number, bonus = 0) => {
    setPurchasing(planId);
    await new Promise((r) => setTimeout(r, 1200));
    updateCoins((user?.coins ?? 0) + coins + bonus);
    setPurchasing(null);
    Alert.alert(
      "Purchase Successful!",
      `${coins + bonus} coins added to your wallet.`
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>My Wallet</Text>
        <TouchableOpacity
          onPress={() => router.push("/notifications")}
          style={[styles.bellBtn, { backgroundColor: colors.muted }]}
        >
          <Feather name="bell" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Balance card with wallet_bg */}
      <View style={[styles.balanceCardOuter, { marginHorizontal: 16, marginBottom: 16 }]}>
        <ImageBackground
          source={require("@/assets/images/wallet_card_bg.png")}
          style={styles.balanceCardBg}
          imageStyle={{ borderRadius: 20 }}
          resizeMode="cover"
        >
          <View style={styles.balanceCardContent}>
            <View style={styles.balanceTop}>
              <View>
                <Text style={styles.balanceLabel}>Total Balance</Text>
                <View style={styles.balanceRow}>
                  <Image
                    source={require("@/assets/images/coin_large.png")}
                    style={styles.coinBig}
                    resizeMode="contain"
                  />
                  <Text style={styles.balanceAmount}>
                    {(user?.coins ?? 0).toLocaleString()}
                  </Text>
                  <Text style={styles.balanceCoinLabel}>Coins</Text>
                </View>
              </View>
              <Image
                source={require("@/assets/images/wallet_graphic.png")}
                style={styles.walletIcon}
                resizeMode="contain"
              />
            </View>
            <TouchableOpacity
              style={styles.addCoinBtn}
              onPress={() => setTab("buy")}
            >
              <Feather name="plus" size={14} color="#fff" />
              <Text style={styles.addCoinText}>Add Coins</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {(["buy", "history"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={[
              styles.tabItem,
              t === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2.5 },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: t === tab ? colors.primary : colors.mutedForeground },
              ]}
            >
              {t === "buy" ? "Buy Coins" : "Call History"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "buy" ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 90 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            Select a coin package
          </Text>
          {COIN_PLANS.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              onPress={() => handlePurchase(plan.id, plan.coins, plan.bonus ?? 0)}
              disabled={purchasing === plan.id}
              style={[
                styles.planCard,
                {
                  backgroundColor: plan.isPopular ? colors.primary : colors.card,
                  ...(!plan.isPopular
                    ? Platform.select({
                        ios: {
                          shadowColor: "#000",
                          shadowOpacity: 0.07,
                          shadowRadius: 10,
                          shadowOffset: { width: 0, height: 2 },
                        },
                        android: { elevation: 2 },
                        web: { boxShadow: "0 2px 10px rgba(0,0,0,0.07)" } as any,
                      })
                    : {}),
                },
              ]}
              activeOpacity={0.8}
            >
              {plan.isPopular && (
                <View style={[styles.popularBadge, { backgroundColor: colors.coinGold }]}>
                  <Text style={styles.popularText}>MOST POPULAR</Text>
                </View>
              )}
              <View style={styles.planLeft}>
                <Image
                  source={require("@/assets/images/coin_large.png")}
                  style={styles.planCoinIcon}
                  resizeMode="contain"
                />
                <View style={{ gap: 2 }}>
                  <Text
                    style={[
                      styles.planCoins,
                      { color: plan.isPopular ? "#fff" : colors.text },
                    ]}
                  >
                    {plan.coins.toLocaleString()} Coins
                  </Text>
                  {plan.bonus ? (
                    <Text
                      style={[
                        styles.planBonus,
                        { color: plan.isPopular ? "rgba(255,255,255,0.9)" : colors.online },
                      ]}
                    >
                      +{plan.bonus} bonus
                    </Text>
                  ) : null}
                </View>
              </View>
              <View
                style={[
                  styles.planPriceBadge,
                  {
                    backgroundColor: plan.isPopular
                      ? "rgba(255,255,255,0.2)"
                      : "#F0E4F8",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.planPrice,
                    { color: plan.isPopular ? "#fff" : colors.accent },
                  ]}
                >
                  ${plan.price}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <FlatList
          data={MOCK_CALL_HISTORY}
          keyExtractor={(c) => c.id}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: bottomPad + 90 },
          ]}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Image
                source={require("@/assets/images/empty_history.png")}
                style={styles.emptyImage}
                resizeMode="contain"
              />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No call history yet
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.historyCard,
                {
                  backgroundColor: colors.card,
                  ...Platform.select({
                    ios: {
                      shadowColor: "#000",
                      shadowOpacity: 0.07,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 1 },
                    },
                    android: { elevation: 2 },
                    web: { boxShadow: "0 1px 10px rgba(0,0,0,0.07)" } as any,
                  }),
                },
              ]}
            >
              <View
                style={[
                  styles.callTypeIconWrapper,
                  {
                    backgroundColor:
                      item.type === "video"
                        ? "#F1F0FF"
                        : "#E8CFFF",
                  },
                ]}
              >
                <Image
                  source={
                    item.type === "video"
                      ? require("@/assets/icons/ic_video.png")
                      : require("@/assets/icons/ic_call.png")
                  }
                  style={[styles.historyCallIcon, { tintColor: colors.accent }]}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.historyInfo}>
                <Text style={[styles.historyName, { color: colors.text }]}>
                  {item.hostName}
                </Text>
                <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                  {formatDuration(item.duration)} • {formatRelativeTime(item.timestamp)}
                </Text>
              </View>
              <View style={styles.historyRight}>
                <View style={styles.historyCostRow}>
                  <Image
                    source={require("@/assets/icons/ic_coin.png")}
                    style={styles.historyCoinIcon}
                    resizeMode="contain"
                  />
                  <Text style={[styles.historyCost, { color: colors.coinGoldText }]}>
                    -{item.coinsSpent}
                  </Text>
                </View>
                {item.rating ? (
                  <Text style={styles.historyRating}>{"★".repeat(item.rating)}</Text>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  bellBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  balanceCardOuter: { borderRadius: 20, overflow: "hidden" },
  balanceCardBg: { borderRadius: 20 },
  balanceCardContent: { padding: 20, gap: 16 },
  balanceTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  balanceLabel: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "Poppins_400Regular" },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  coinBig: { width: 32, height: 32 },
  balanceAmount: { color: "#fff", fontSize: 36, fontFamily: "Poppins_700Bold" },
  balanceCoinLabel: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontFamily: "Poppins_400Regular", alignSelf: "flex-end", marginBottom: 4 },
  walletIcon: { width: 60, height: 60, opacity: 0.9 },
  addCoinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addCoinText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_600SemiBold" },

  tabRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },

  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Poppins_500Medium",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  planCard: {
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    overflow: "hidden",
  },
  popularBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  popularText: { color: "#000", fontSize: 9, fontFamily: "Poppins_700Bold" },
  planLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  planCoinIcon: { width: 36, height: 36 },
  planCoins: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  planBonus: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  planPriceBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  planPrice: { fontSize: 15, fontFamily: "Poppins_700Bold" },

  historyCard: {
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  callTypeIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  historyCallIcon: { width: 22, height: 22 },
  historyInfo: { flex: 1, gap: 3 },
  historyName: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  historyMeta: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  historyRight: { alignItems: "flex-end", gap: 3 },
  historyCostRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyCoinIcon: { width: 14, height: 14 },
  historyCost: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  historyRating: { fontSize: 11, color: "#FFA100" },

  empty: { alignItems: "center", gap: 12, paddingTop: 60 },
  emptyImage: { width: 180, height: 140 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
