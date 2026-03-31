import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, FlatList, Platform, ImageBackground, Alert, TextInput
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

const WITHDRAW_OPTIONS = [100, 200, 500, 1000];

const EARNING_HISTORY = [
  { id: "e1", user: "Sarah M.", duration: "15 min", coins: 120, date: "Today, 2:30 PM", type: "audio" },
  { id: "e2", user: "John D.", duration: "22 min", coins: 176, date: "Today, 11:00 AM", type: "video" },
  { id: "e3", user: "Priya K.", duration: "10 min", coins: 80, date: "Yesterday", type: "audio" },
  { id: "e4", user: "Marcus L.", duration: "30 min", coins: 240, date: "2 days ago", type: "audio" },
];

export default function HostWalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [tab, setTab] = useState<"history" | "withdraw">("history");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const topPad = insets.top;

  const totalEarned = EARNING_HISTORY.reduce((s, e) => s + e.coins, 0);

  const handleWithdraw = () => {
    const amt = parseInt(withdrawAmt);
    if (!amt || amt <= 0) return Alert.alert("Invalid", "Please enter a valid amount");
    if (amt > (user?.coins ?? 0)) return Alert.alert("Insufficient Coins", "You don't have enough coins");
    Alert.alert("Withdrawal Requested", `${amt} coins withdrawal has been submitted for processing.`);
    setWithdrawAmt("");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Host Wallet</Text>
      </View>

      {/* Balance card */}
      <View style={[styles.cardOuter, { marginHorizontal: 16, marginBottom: 16 }]}>
        <ImageBackground
          source={require("@/assets/images/wallet_card_bg.png")}
          style={styles.cardBg}
          imageStyle={{ borderRadius: 20 }}
          resizeMode="cover"
        >
          <View style={styles.cardContent}>
            <View style={styles.cardTop}>
              <View style={{ gap: 4 }}>
                <Text style={styles.cardLabel}>Total Earnings</Text>
                <View style={styles.coinRow}>
                  <Image source={require("@/assets/images/coin_large.png")} style={styles.coinBig} resizeMode="contain" />
                  <Text style={styles.coinAmt}>{(user?.coins ?? 0).toLocaleString()}</Text>
                  <Text style={styles.coinUnit}>Coins</Text>
                </View>
              </View>
              <Image source={require("@/assets/images/wallet_graphic.png")} style={styles.walletImg} resizeMode="contain" />
            </View>
            <View style={styles.statsRow}>
              <View style={styles.miniStat}>
                <Text style={styles.miniVal}>{totalEarned}</Text>
                <Text style={styles.miniLabel}>This Week</Text>
              </View>
              <View style={[styles.miniDiv]} />
              <View style={styles.miniStat}>
                <Text style={styles.miniVal}>{EARNING_HISTORY.length}</Text>
                <Text style={styles.miniLabel}>Sessions</Text>
              </View>
              <View style={[styles.miniDiv]} />
              <View style={styles.miniStat}>
                <Text style={styles.miniVal}>0</Text>
                <Text style={styles.miniLabel}>Withdrawn</Text>
              </View>
            </View>
          </View>
        </ImageBackground>
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {(["history", "withdraw"] as const).map(t => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tabItem, t === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2.5 }]}>
            <Text style={[styles.tabText, { color: t === tab ? colors.primary : colors.mutedForeground }]}>
              {t === "history" ? "Earnings History" : "Withdraw"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "history" ? (
        <FlatList
          data={EARNING_HISTORY}
          keyExtractor={e => e.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}
          renderItem={({ item }) => (
            <View style={[styles.historyCard, { backgroundColor: colors.card }]}>
              <View style={[styles.callIconWrap, { backgroundColor: item.type === "video" ? "#F1F0FF" : "#E8CFFF" }]}>
                <Image source={item.type === "video" ? require("@/assets/icons/ic_video.png") : require("@/assets/icons/ic_call.png")} style={styles.callIcon} tintColor={colors.accent} resizeMode="contain" />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.histName, { color: colors.text }]}>{item.user}</Text>
                <Text style={[styles.histMeta, { color: colors.mutedForeground }]}>{item.duration} • {item.date}</Text>
              </View>
              <View style={styles.earnedRow}>
                <Image source={require("@/assets/icons/ic_coin.png")} style={styles.smallCoin} resizeMode="contain" />
                <Text style={[styles.earnedAmt, { color: "#FFA100" }]}>+{item.coins}</Text>
              </View>
            </View>
          )}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Quick Select Amount</Text>
          <View style={styles.withdrawGrid}>
            {WITHDRAW_OPTIONS.map(amt => (
              <TouchableOpacity key={amt} onPress={() => setWithdrawAmt(String(amt))} style={[styles.withdrawChip, {
                backgroundColor: withdrawAmt === String(amt) ? colors.accent : colors.card,
                borderColor: withdrawAmt === String(amt) ? colors.accent : colors.border,
              }]}>
                <Image source={require("@/assets/icons/ic_coin.png")} style={styles.chipCoin} tintColor={withdrawAmt === String(amt) ? "#fff" : "#FFA100"} resizeMode="contain" />
                <Text style={[styles.chipAmt, { color: withdrawAmt === String(amt) ? "#fff" : colors.text }]}>{amt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Or Enter Amount</Text>
          <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.inputIcon} tintColor="#FFA100" resizeMode="contain" />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Enter coin amount"
              placeholderTextColor={colors.mutedForeground}
              value={withdrawAmt}
              onChangeText={setWithdrawAmt}
              keyboardType="numeric"
            />
          </View>

          <TouchableOpacity style={[styles.withdrawBtn, { backgroundColor: colors.primary }]} onPress={handleWithdraw} activeOpacity={0.85}>
            <Image source={require("@/assets/icons/ic_withdraw.png")} style={styles.withdrawIcon} tintColor="#fff" resizeMode="contain" />
            <Text style={styles.withdrawBtnText}>Request Withdrawal</Text>
          </TouchableOpacity>

          <View style={[styles.noteCard, { backgroundColor: "#FFF8E1" }]}>
            <Text style={[styles.noteTitle, { color: "#FFA100" }]}>Note</Text>
            <Text style={[styles.noteText, { color: colors.mutedForeground }]}>Minimum withdrawal is 100 coins. Processing takes 2-3 business days.</Text>
          </View>

          <TouchableOpacity style={[styles.fullWithdrawBtn, { backgroundColor: colors.surface, borderColor: colors.primary }]} onPress={() => router.push("/host/host/withdraw")}>
            <Image source={require("@/assets/icons/ic_withdraw.png")} style={styles.withdrawIcon} tintColor={colors.primary} resizeMode="contain" />
            <Text style={[styles.fullWithdrawText, { color: colors.primary }]}>Full Withdrawal Options</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 14 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  cardOuter: { borderRadius: 20, overflow: "hidden" },
  cardBg: { borderRadius: 20 },
  cardContent: { padding: 20, gap: 16 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardLabel: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "Poppins_400Regular" },
  coinRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  coinBig: { width: 28, height: 28 },
  coinAmt: { color: "#fff", fontSize: 32, fontFamily: "Poppins_700Bold" },
  coinUnit: { color: "rgba(255,255,255,0.7)", fontSize: 13, alignSelf: "flex-end", marginBottom: 3 },
  walletImg: { width: 52, height: 52, opacity: 0.9 },
  statsRow: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 12, justifyContent: "space-around" },
  miniStat: { alignItems: "center", gap: 2 },
  miniVal: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  miniLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontFamily: "Poppins_400Regular" },
  miniDiv: { width: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  tabRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  historyCard: { borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  callIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  callIcon: { width: 22, height: 22 },
  histName: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  histMeta: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  earnedRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  smallCoin: { width: 14, height: 14 },
  earnedAmt: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  withdrawGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  withdrawChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  chipCoin: { width: 16, height: 16 },
  chipAmt: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, height: 54 },
  inputIcon: { width: 20, height: 20 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular" },
  withdrawBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  withdrawIcon: { width: 20, height: 20 },
  withdrawBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  noteCard: { borderRadius: 14, padding: 14, gap: 4 },
  noteTitle: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  noteText: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 18 },
  fullWithdrawBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, borderWidth: 1.5 },
  fullWithdrawText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
});
