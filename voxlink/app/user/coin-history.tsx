import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { showErrorToast } from "@/components/Toast";

type TxType = "purchase" | "spend" | "bonus" | "refund" | "withdrawal" | "earn";

interface Transaction {
  id: string;
  type: TxType;
  title: string;
  subtitle: string;
  coins: number;
  date: string;
}

const TYPE_CONFIG: Record<string, { color: string; bg: string; icon: any }> = {
  purchase:   { color: "#0BAF23", bg: "#E8F8EC", icon: require("@/assets/icons/ic_incoming.png") },
  spend:      { color: "#F44336", bg: "#FDE8E8", icon: require("@/assets/icons/ic_arrow_up.png") },
  bonus:      { color: "#FFA100", bg: "#FFF3D6", icon: require("@/assets/icons/ic_bonus.png") },
  refund:     { color: "#0078CC", bg: "#D5EEFF", icon: require("@/assets/icons/ic_cam_flip.png") },
  earn:       { color: "#0BAF23", bg: "#E8F8EC", icon: require("@/assets/icons/ic_arrow_up.png") },
  withdrawal: { color: "#9333EA", bg: "#F3E8FF", icon: require("@/assets/icons/ic_withdraw.png") },
};

const TABS = ["All", "Purchase", "Spent", "Bonus"] as const;
type Tab = typeof TABS[number];

function filterByTab(txs: Transaction[], tab: Tab): Transaction[] {
  if (tab === "All")      return txs;
  if (tab === "Purchase") return txs.filter(t => t.type === "purchase" || t.type === "earn");
  if (tab === "Spent")    return txs.filter(t => t.type === "spend" || t.type === "withdrawal");
  return txs.filter(t => t.type === "bonus" || t.type === "refund");
}

function formatApiDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${time}`;
}

function mapApiTx(tx: any): Transaction {
  return {
    id: tx.id,
    type: tx.type as TxType,
    title: tx.description || tx.type,
    subtitle: tx.ref_id ? `Ref: ${tx.ref_id.slice(0, 8)}` : "",
    coins: tx.amount,
    date: tx.created_at ? formatApiDate(tx.created_at) : "",
  };
}

export default function CoinHistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, refreshBalance } = useAuth();
  const [tab, setTab] = useState<Tab>("All");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const topPad = insets.top;

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await API.getCoinHistory();
      setTransactions(data.map(mapApiTx));
      await refreshBalance();
    } catch {
      setTransactions([]);
      showErrorToast("Failed to load coin history.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const filtered = filterByTab(transactions, tab);
  const totalIn  = transactions.filter(t => t.coins > 0).reduce((s, t) => s + t.coins, 0);
  const totalOut = transactions.filter(t => t.coins < 0).reduce((s, t) => s + t.coins, 0);

  const renderItem = ({ item }: { item: Transaction }) => {
    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.spend;
    return (
      <View style={[styles.item, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[styles.iconCircle, { backgroundColor: cfg.bg }]}>
          <Image source={cfg.icon} style={{ width: 18, height: 18, tintColor: cfg.color }} resizeMode="contain" />
        </View>
        <View style={styles.info}>
          <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
          {!!item.subtitle && (
            <Text style={[styles.itemSub, { color: colors.mutedForeground }]}>{item.subtitle}</Text>
          )}
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

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#A00EE7" size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Image source={require("@/assets/icons/ic_download.png")} style={{ width: 64, height: 64, tintColor: colors.border }} resizeMode="contain" />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No transactions found</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#A00EE7" />}
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
