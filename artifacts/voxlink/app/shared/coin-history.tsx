import React, { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Platform
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

type TxType = "purchase" | "spend" | "bonus" | "refund";

interface Transaction {
  id: string;
  type: TxType;
  title: string;
  subtitle: string;
  coins: number;
  date: string;
}

const ALL_TRANSACTIONS: Transaction[] = [
  { id: "t1",  type: "spend",    title: "Audio Call — Priya Sharma",   subtitle: "14 min 32 sec",   coins: -58,  date: "Today, 10:36 AM" },
  { id: "t2",  type: "spend",    title: "Video Call — Aisha Khan",      subtitle: "8 min 15 sec",    coins: -33,  date: "Today, 08:53 AM" },
  { id: "t3",  type: "purchase", title: "Coin Pack — 200 Coins",        subtitle: "In-app purchase",  coins: 200,  date: "Yesterday, 7:02 PM" },
  { id: "t4",  type: "spend",    title: "Video Call — Mei Lin",         subtitle: "22 min 01 sec",   coins: -88,  date: "Yesterday, 6:37 PM" },
  { id: "t5",  type: "bonus",    title: "First Login Bonus",            subtitle: "Welcome reward",  coins: 100,  date: "Mar 28, 9:00 AM" },
  { id: "t6",  type: "spend",    title: "Audio Call — Fatima Al-Sayed", subtitle: "31 min 50 sec",   coins: -127, date: "Mar 27, 11:31 AM" },
  { id: "t7",  type: "purchase", title: "Coin Pack — 500 Coins",        subtitle: "In-app purchase",  coins: 500,  date: "Mar 26, 9:45 AM" },
  { id: "t8",  type: "spend",    title: "Video Call — Priya Sharma",    subtitle: "7 min 44 sec",    coins: -31,  date: "Mar 26, 2:07 PM" },
  { id: "t9",  type: "refund",   title: "Refund — Call Dropped",        subtitle: "Auto-refund",     coins: 12,   date: "Mar 25, 4:11 PM" },
  { id: "t10", type: "purchase", title: "Coin Pack — 100 Coins",        subtitle: "In-app purchase",  coins: 100,  date: "Mar 24, 11:00 AM" },
];

const TYPE_CONFIG: Record<TxType, { color: string; bg: string; icon: string }> = {
  purchase: { color: "#0BAF23", bg: "#E8F8EC",  icon: "arrow-down-circle" },
  spend:    { color: "#F44336", bg: "#FDE8E8",  icon: "arrow-up-circle" },
  bonus:    { color: "#FFA100", bg: "#FFF3D6",  icon: "gift" },
  refund:   { color: "#0078CC", bg: "#D5EEFF",  icon: "rotate-ccw" },
};

const TABS = ["All", "Purchase", "Spent", "Bonus"] as const;
type Tab = typeof TABS[number];

function filterByTab(txs: Transaction[], tab: Tab): Transaction[] {
  if (tab === "All")      return txs;
  if (tab === "Purchase") return txs.filter(t => t.type === "purchase");
  if (tab === "Spent")    return txs.filter(t => t.type === "spend");
  return txs.filter(t => t.type === "bonus" || t.type === "refund");
}

export default function CoinHistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("All");

  const topPad = insets.top;
  const filtered = filterByTab(ALL_TRANSACTIONS, tab);

  const totalIn  = ALL_TRANSACTIONS.filter(t => t.coins > 0).reduce((s, t) => s + t.coins, 0);
  const totalOut = ALL_TRANSACTIONS.filter(t => t.coins < 0).reduce((s, t) => s + t.coins, 0);

  const renderItem = ({ item }: { item: Transaction }) => {
    const cfg = TYPE_CONFIG[item.type];
    return (
      <View style={[styles.item, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[styles.iconCircle, { backgroundColor: cfg.bg }]}>
          <Feather name={cfg.icon as any} size={18} color={cfg.color} />
        </View>
        <View style={styles.info}>
          <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
          <Text style={[styles.itemSub, { color: colors.mutedForeground }]}>{item.subtitle}</Text>
          <Text style={[styles.itemDate, { color: colors.mutedForeground }]}>{item.date}</Text>
        </View>
        <View style={styles.coinsCol}>
          <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
          <Text style={[styles.coinsAmt, { color: item.coins > 0 ? "#0BAF23" : colors.coinGoldText }]}>
            {item.coins > 0 ? "+" : ""}{item.coins}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Coin History</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Balance summary */}
      <View style={[styles.summaryCard, { backgroundColor: "#A00EE7" }]}>
        <View style={styles.summaryLeft}>
          <Text style={styles.summaryLabel}>Current Balance</Text>
          <View style={styles.summaryBalance}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.summaryIcon} resizeMode="contain" />
            <Text style={styles.summaryAmount}>{(user?.coins ?? 0).toLocaleString()}</Text>
          </View>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryRight}>
          <View style={styles.miniStat}>
            <Text style={styles.miniLabel}>Earned</Text>
            <Text style={styles.miniVal}>+{totalIn}</Text>
          </View>
          <View style={styles.miniStat}>
            <Text style={styles.miniLabel}>Spent</Text>
            <Text style={styles.miniVal}>{totalOut}</Text>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} style={[styles.tabItem, tab === t && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, { color: tab === t ? colors.primary : colors.mutedForeground }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="inbox" size={64} color={colors.border} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No transactions found</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  summaryCard: { marginHorizontal: 16, marginVertical: 12, borderRadius: 16, padding: 18, flexDirection: "row", alignItems: "center" },
  summaryLeft: { flex: 1 },
  summaryLabel: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.75)", marginBottom: 4 },
  summaryBalance: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryIcon: { width: 22, height: 22 },
  summaryAmount: { fontSize: 26, fontFamily: "Poppins_700Bold", color: "#fff" },
  summaryDivider: { width: 1, height: 40, backgroundColor: "rgba(255,255,255,0.3)", marginHorizontal: 16 },
  summaryRight: { gap: 8 },
  miniStat: {},
  miniLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.7)" },
  miniVal: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  tabRow: { flexDirection: "row", borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  item: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 12, alignItems: "center" },
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  info: { flex: 1 },
  itemTitle: { fontSize: 13, fontFamily: "Poppins_600SemiBold", marginBottom: 2 },
  itemSub: { fontSize: 11, fontFamily: "Poppins_400Regular", marginBottom: 1 },
  itemDate: { fontSize: 10, fontFamily: "Poppins_400Regular" },
  coinsCol: { alignItems: "center", gap: 3 },
  coinIcon: { width: 18, height: 18 },
  coinsAmt: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
