import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { COIN_PLANS, MOCK_CALL_HISTORY, formatDuration, formatRelativeTime } from "@/data/mockData";

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
    Alert.alert("Purchase Successful!", `${coins + bonus} coins added to your wallet.`);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Wallet</Text>
      </View>

      <View style={[styles.balanceCard, { backgroundColor: colors.primary }]}>
        <Text style={styles.balanceLabel}>Your Balance</Text>
        <View style={styles.balanceRow}>
          <Text style={styles.coinIcon}>🪙</Text>
          <Text style={styles.balanceAmount}>{(user?.coins ?? 0).toLocaleString()}</Text>
        </View>
        <Text style={styles.balanceSubtext}>Coins ready to use</Text>
      </View>

      <View style={[styles.tabRow, { borderColor: colors.border }]}>
        {(["buy", "history"] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, t === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
            <Text style={[styles.tabText, { color: t === tab ? colors.primary : colors.mutedForeground }]}>
              {t === "buy" ? "Buy Coins" : "Call History"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "buy" ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 90 }]} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Select a package</Text>
          {COIN_PLANS.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              onPress={() => handlePurchase(plan.id, plan.coins, plan.bonus ?? 0)}
              disabled={purchasing === plan.id}
              style={[
                styles.planCard,
                { backgroundColor: plan.isPopular ? colors.primary : colors.card, borderColor: plan.isPopular ? colors.primary : colors.border }
              ]}
              activeOpacity={0.8}
            >
              {plan.isPopular && (
                <View style={[styles.popularBadge, { backgroundColor: colors.coinGold }]}>
                  <Text style={styles.popularText}>MOST POPULAR</Text>
                </View>
              )}
              <View style={styles.planLeft}>
                <Text style={styles.planCoinIcon}>🪙</Text>
                <View>
                  <Text style={[styles.planCoins, { color: plan.isPopular ? "#fff" : colors.foreground }]}>
                    {plan.coins.toLocaleString()} coins
                  </Text>
                  {plan.bonus && (
                    <Text style={[styles.planBonus, { color: plan.isPopular ? "#fff" : colors.online }]}>
                      +{plan.bonus} bonus coins
                    </Text>
                  )}
                </View>
              </View>
              <View style={[styles.planPriceBadge, { backgroundColor: plan.isPopular ? "rgba(255,255,255,0.2)" : colors.primary + "18" }]}>
                <Text style={[styles.planPrice, { color: plan.isPopular ? "#fff" : colors.primary }]}>
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
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 90 }]}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="phone-missed" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No calls yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.callTypeIcon, { backgroundColor: item.type === "video" ? colors.primary + "18" : colors.secondary }]}>
                <Feather name={item.type === "video" ? "video" : "phone"} size={18} color={colors.primary} />
              </View>
              <View style={styles.historyInfo}>
                <Text style={[styles.historyName, { color: colors.foreground }]}>{item.hostName}</Text>
                <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                  {formatDuration(item.duration)} • {formatRelativeTime(item.timestamp)}
                </Text>
              </View>
              <View style={styles.historyRight}>
                <Text style={[styles.historyCost, { color: colors.coinGold }]}>-{item.coinsSpent} 🪙</Text>
                {item.rating && <Text style={[styles.historyRating, { color: colors.mutedForeground }]}>{"⭐".repeat(item.rating)}</Text>}
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
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  balanceCard: { marginHorizontal: 20, borderRadius: 20, padding: 24, marginBottom: 16, gap: 4 },
  balanceLabel: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "Inter_400Regular" },
  balanceRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  coinIcon: { fontSize: 28 },
  balanceAmount: { color: "#fff", fontSize: 40, fontFamily: "Inter_700Bold" },
  balanceSubtext: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_400Regular" },
  tabRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: 20 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  planCard: { borderRadius: 16, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", position: "relative", overflow: "hidden" },
  popularBadge: { position: "absolute", top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  popularText: { color: "#000", fontSize: 9, fontFamily: "Inter_700Bold" },
  planLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  planCoinIcon: { fontSize: 28 },
  planCoins: { fontSize: 18, fontFamily: "Inter_700Bold" },
  planBonus: { fontSize: 12, fontFamily: "Inter_500Medium" },
  planPriceBadge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  planPrice: { fontSize: 16, fontFamily: "Inter_700Bold" },
  historyCard: { borderRadius: 14, borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  callTypeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  historyInfo: { flex: 1, gap: 3 },
  historyName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  historyMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  historyRight: { alignItems: "flex-end", gap: 2 },
  historyCost: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  historyRating: { fontSize: 12 },
  empty: { alignItems: "center", gap: 8, paddingTop: 60 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
