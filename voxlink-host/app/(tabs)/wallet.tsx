import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView,
  FlatList, ImageBackground, TextInput, ActivityIndicator, RefreshControl
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { API } from "@/services/api";
import { useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { showSuccessToast, showErrorToast, showWarningToast } from "@/components/Toast";
import { formatPrice, USD_TO_FOREIGN } from "@/utils/currency";
import { useAppConfig } from "@/hooks/useAppConfig";

const WITHDRAW_OPTIONS = [100, 200, 500, 1000];

// Visual meta for each withdrawal status (schema CHECK: pending|approved|paid|rejected).
const WITHDRAW_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#B26A00", bg: "#FFF3D6" },
  approved: { label: "Approved", color: "#0078CC", bg: "#D5EEFF" },
  paid: { label: "Paid", color: "#0BAF23", bg: "#E8F8EC" },
  rejected: { label: "Rejected", color: "#F44336", bg: "#FDE8E8" },
};

// Payout method types mirror the Payout Method screen (app/payout-method.tsx).
// Withdrawals MUST use the channel + details the host configured there instead
// of a re-typed free-text field, so the two flows stay consistent.
type PayoutMethod = "bank" | "upi" | "paytm" | "phonepe";

const PAYOUT_LABELS: Record<PayoutMethod, string> = {
  bank: "Bank Account",
  upi: "UPI",
  paytm: "Paytm",
  phonepe: "PhonePe",
};

// Build the single `account_info` string the withdrawal endpoint stores, from
// the structured payout_details the host saved on the Payout Method screen.
function buildAccountInfo(method: PayoutMethod, details: Record<string, string>): string {
  switch (method) {
    case "bank":
      return [details.account_holder, details.account_number, details.ifsc, details.bank_name]
        .map((v) => (v ?? "").trim())
        .filter(Boolean)
        .join(" | ");
    case "upi":
      return (details.upi_id ?? "").trim();
    case "paytm":
    case "phonepe":
      return (details.phone_number ?? "").trim();
    default:
      return "";
  }
}

// Short masked summary for display (e.g. "HDFC Bank • ••••6789", "name@bank").
function summarizePayout(method: PayoutMethod, details: Record<string, string>): string {
  if (method === "bank") {
    const acc = (details.account_number ?? "").trim();
    const masked = acc.length > 4 ? `••••${acc.slice(-4)}` : acc;
    return [details.bank_name || "Bank", masked].filter(Boolean).join(" • ");
  }
  if (method === "upi") return (details.upi_id ?? "").trim() || "UPI";
  const ph = (details.phone_number ?? "").trim();
  return ph.length > 4 ? `••••${ph.slice(-4)}` : ph || PAYOUT_LABELS[method];
}

interface EarningTx {
  id: string;
  user: string;
  duration: string;
  coins: number;
  date: string;
  rawCreatedAt: number;
  type: "audio" | "video";
}

interface EarningsStats {
  thisWeek: number;
  sessions: number;
  withdrawn: number;
  totalEarnings: number;
}

function formatTxDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  return `${diffDays} days ago`;
}

function mapTxToEarning(tx: any): EarningTx {
  const durationMin = tx.duration_min ?? (tx.duration_seconds ? Math.ceil(tx.duration_seconds / 60) : null);
  return {
    id: tx.id,
    user: tx.caller_name || "Unknown Caller",
    duration: durationMin ? `${durationMin} min` : "—",
    coins: Math.abs(tx.amount ?? tx.coins ?? 0),
    date: tx.created_at ? formatTxDate(tx.created_at) : "",
    rawCreatedAt: typeof tx.created_at === "number" ? tx.created_at : 0,
    type: tx.call_type === "video" ? "video" : "audio",
  };
}

// Bug 4 fix: use rawCreatedAt (Unix seconds) instead of trying to parse formatted date string
function weeklyCoins(txs: EarningTx[]): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const weekAgoSec = nowSec - 7 * 86400;
  return txs
    .filter((t) => t.rawCreatedAt > 0 && t.rawCreatedAt >= weekAgoSec)
    .reduce((s, t) => s + t.coins, 0);
}

export default function HostWalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, refreshProfile } = useAuth();
  const { t: tr } = useLanguage();
  const [tab, setTab] = useState<"history" | "withdraw">("history");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  // Saved payout channel + details, loaded from the host record. The withdraw
  // action uses these instead of a free-text field so it matches whatever the
  // host configured on the Payout Method screen.
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod | null>(null);
  const [payoutDetails, setPayoutDetails] = useState<Record<string, string>>({});
  const [withdrawing, setWithdrawing] = useState(false);
  const [earnings, setEarnings] = useState<EarningTx[]>([]);
  const [stats, setStats] = useState<EarningsStats>({ thisWeek: 0, sessions: 0, withdrawn: 0, totalEarnings: 0 });
  // Full withdrawal-request list so the host can SEE the status of their
  // payouts (pending/approved/paid/rejected). Coins are frozen — not deducted —
  // until an admin approves, so without this the host gets zero feedback after
  // requesting and the balance looks unchanged.
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // #10: minimum withdrawal + coin value come from server app_settings (single
  // source of truth). useAppConfig subscribes to live changes, so when the
  // admin updates the coin value or min withdrawal the screen reflects it
  // immediately — no remount required.
  const { config } = useAppConfig();
  const parsedMinWithdraw = parseInt(config.min_withdrawal_coins ?? "", 10);
  const minWithdraw = Number.isFinite(parsedMinWithdraw) && parsedMinWithdraw > 0 ? parsedMinWithdraw : 100;
  // coin_to_usd_rate = value of 1 coin in USD (admin-set). Used to show hosts
  // the real-money value of their coins. 0 = not configured/hide.
  const parsedPayoutRate = parseFloat(config.coin_to_usd_rate ?? "");
  const payoutRate = Number.isFinite(parsedPayoutRate) && parsedPayoutRate > 0 ? parsedPayoutRate : 0;
  const topPad = insets.top;

  // Payout currency = the host's ACCOUNT currency (server-detected from their
  // country at signup), so international hosts see their own money (US → $,
  // EU → €, India → ₹). We validate it against the known FX table and fall
  // back to the platform default INR — deliberately NOT the device/browser
  // locale, which made web wrongly resolve to USD for Indian hosts.
  const hostCurrency = String((user as any)?.currency || "").toUpperCase();
  const payoutCurrency = hostCurrency && USD_TO_FOREIGN[hostCurrency] ? hostCurrency : "INR";
  const formatPayout = (coins: number) => formatPrice(coins * payoutRate, payoutCurrency);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await API.getEarnings() as any;
      const txList = (data.transactions || []).map(mapTxToEarning);
      const allWithdrawals = (data.withdrawals || []) as any[];
      // 'paid' is the only completed status in the schema CHECK
      // (pending|approved|rejected|paid) — the old code also matched a
      // non-existent 'completed', which never counted anything extra.
      const totalWithdrawn = allWithdrawals
        .filter((w) => w.status === "paid")
        .reduce((s: number, w: any) => s + (w.coins || 0), 0);
      setEarnings(txList);
      setWithdrawals(allWithdrawals);
      setStats({
        thisWeek: weeklyCoins(txList),
        sessions: txList.length,
        withdrawn: totalWithdrawn,
        totalEarnings: data.host?.total_earnings ?? txList.reduce((s: number, t: EarningTx) => s + t.coins, 0),
      });
      await refreshProfile();
    } catch {
      setEarnings([]);
      showErrorToast(tr.walletScreen.failedLoad);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshProfile, tr]);

  useEffect(() => { load(); }, []);

  // Load the saved payout method/details, and refresh it whenever the wallet
  // regains focus (e.g. after the host edits it on the Payout Method screen).
  const loadPayout = useCallback(async () => {
    try {
      const me: any = await API.getHostMe();
      const method = (me?.payout_method as PayoutMethod) || null;
      setPayoutMethod(method && PAYOUT_LABELS[method] ? method : null);
      setPayoutDetails((me?.payout_details ?? {}) as Record<string, string>);
    } catch (e) {
      console.warn("[Wallet] getHostMe failed:", e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPayout();
    }, [loadPayout])
  );

  // Call khatam hone par coin_update event aata hai — wallet reload karo
  useSocketEvent(SocketEvents.COIN_DEDUCTED, () => {
    load();
  }, [load]);

  const handleWithdraw = useCallback(async () => {
    const amt = parseInt(withdrawAmt, 10);
    // Only one withdrawal can be in flight at a time (server enforces this and
    // would reject the request); block early with a clear message + keep coins
    // visible as "pending" rather than letting the host think it failed.
    if (withdrawals.some((w) => w.status === "pending" || w.status === "approved")) {
      showWarningToast("You already have a withdrawal being processed. Please wait for it to complete.", "Already in Progress");
      return;
    }
    if (!amt || amt <= 0) {
      showWarningToast("Please enter a valid amount.", "Invalid Amount");
      return;
    }
    if (amt < minWithdraw) {
      showWarningToast(`Minimum withdrawal is ${minWithdraw} coins.`, "Too Low");
      return;
    }
    if (amt > (user?.coins ?? 0)) {
      showErrorToast("You don't have enough coins.", "Insufficient Balance");
      return;
    }
    // Require a configured payout method — withdrawals are sent to the channel
    // the host set up on the Payout Method screen, not a re-typed field.
    if (!payoutMethod) {
      showWarningToast("Please set up your payout method first.", "Setup Required");
      router.push("/payout-method");
      return;
    }
    const accountInfo = buildAccountInfo(payoutMethod, payoutDetails);
    if (!accountInfo) {
      showWarningToast("Your payout details look incomplete. Please update them.", "Incomplete Details");
      router.push("/payout-method");
      return;
    }
    setWithdrawing(true);
    try {
      await API.requestWithdrawal(amt, payoutMethod, accountInfo);
      setWithdrawAmt("");
      showSuccessToast(`${amt} coins withdrawal submitted!`, "Request Sent");
      await load(true);
    } catch (err: any) {
      showErrorToast(err?.message || "Withdrawal failed. Please try again.", "Failed");
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawAmt, user, load, minWithdraw, payoutMethod, payoutDetails, withdrawals]);

  // A pending/approved request blocks new withdrawals (server allows one at a time).
  const pendingWithdrawal = withdrawals.find((w) => w.status === "pending" || w.status === "approved");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>{tr.walletScreen.title}</Text>
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
                <Text style={styles.cardLabel}>{tr.walletScreen.availableBalance}</Text>
                <View style={styles.coinRow}>
                  <Image source={require("@/assets/images/coin_large.png")} style={styles.coinBig} resizeMode="contain" />
                  <Text style={styles.coinAmt}>{(user?.coins ?? 0).toLocaleString()}</Text>
                  <Text style={styles.coinUnit}>{tr.walletScreen.coins}</Text>
                </View>
                {payoutRate > 0 && (
                  <Text style={styles.payoutValue}>≈ {formatPayout(user?.coins ?? 0)} {tr.walletScreen.payoutValue}</Text>
                )}
              </View>
              <Image source={require("@/assets/images/wallet_graphic.png")} style={styles.walletImg} resizeMode="contain" />
            </View>
            <View style={styles.statsRow}>
              <View style={styles.miniStat}>
                <Text style={styles.miniVal}>{loading ? "…" : stats.thisWeek}</Text>
                <Text style={styles.miniLabel}>{tr.walletScreen.thisWeek}</Text>
              </View>
              <View style={styles.miniDiv} />
              <View style={styles.miniStat}>
                <Text style={styles.miniVal}>{loading ? "…" : stats.sessions}</Text>
                <Text style={styles.miniLabel}>{tr.walletScreen.sessions}</Text>
              </View>
              <View style={styles.miniDiv} />
              <View style={styles.miniStat}>
                <Text style={styles.miniVal}>{loading ? "…" : stats.withdrawn}</Text>
                <Text style={styles.miniLabel}>{tr.walletScreen.withdrawn}</Text>
              </View>
            </View>
          </View>
        </ImageBackground>
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {(["history", "withdraw"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tabItem, t === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2.5 }]}
          >
            <Text style={[styles.tabText, { color: t === tab ? colors.primary : colors.mutedForeground }]}>
              {t === "history" ? tr.walletScreen.earningsHistory : tr.walletScreen.withdraw}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "history" ? (
        loading ? (
          <View style={styles.loadingCenter}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : earnings.length === 0 ? (
          <View style={styles.loadingCenter}>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Poppins_400Regular" }}>{tr.walletScreen.noEarnings}</Text>
          </View>
        ) : (
          <FlatList
            data={earnings}
            keyExtractor={(e) => e.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
            renderItem={({ item }) => (
              <View style={[styles.historyCard, { backgroundColor: colors.card }]}>
                <View style={[styles.callIconWrap, { backgroundColor: item.type === "video" ? "#F1F0FF" : "#E8CFFF" }]}>
                  <Image
                    source={item.type === "video" ? require("@/assets/icons/ic_video.png") : require("@/assets/icons/ic_call.png")}
                    style={styles.callIcon}
                    tintColor={colors.accent}
                    resizeMode="contain"
                  />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.histName, { color: colors.text }]} numberOfLines={1}>{item.user}</Text>
                  <Text style={[styles.histMeta, { color: colors.mutedForeground }]}>{item.duration} • {item.date}</Text>
                </View>
                <View style={styles.earnedRow}>
                  <Image source={require("@/assets/icons/ic_coin.png")} style={styles.smallCoin} resizeMode="contain" />
                  <Text style={[styles.earnedAmt, { color: "#FFA100" }]}>+{item.coins}</Text>
                </View>
              </View>
            )}
          />
        )
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12, paddingBottom: 100 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{tr.walletScreen.quickSelect}</Text>
          <View style={styles.withdrawGrid}>
            {WITHDRAW_OPTIONS.map((amt) => (
              <TouchableOpacity
                key={amt}
                onPress={() => setWithdrawAmt(String(amt))}
                style={[styles.withdrawChip, {
                  backgroundColor: withdrawAmt === String(amt) ? colors.accent : colors.card,
                  borderColor: withdrawAmt === String(amt) ? colors.accent : colors.border,
                }]}
              >
                <Image source={require("@/assets/icons/ic_coin.png")} style={styles.chipCoin} tintColor={withdrawAmt === String(amt) ? "#fff" : "#FFA100"} resizeMode="contain" />
                <Text style={[styles.chipAmt, { color: withdrawAmt === String(amt) ? "#fff" : colors.text }]}>{amt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{tr.walletScreen.orEnter}</Text>
          <View accessible={false} style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.inputIcon} tintColor="#FFA100" resizeMode="contain" />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder={tr.walletScreen.enterCoinAmount}
              placeholderTextColor={colors.mutedForeground}
              value={withdrawAmt}
              onChangeText={setWithdrawAmt}
              keyboardType="numeric"
              selectionColor={colors.accent}
              underlineColorAndroid="transparent"
            />
          </View>
          {payoutRate > 0 && Number(withdrawAmt) > 0 && (
            <Text style={[styles.payoutHint, { color: colors.accent }]}>
              ≈ {formatPayout(Number(withdrawAmt))} will be paid to your account
            </Text>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{tr.walletScreen.payoutTo}</Text>
          {payoutMethod ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Edit payout method"
              style={[styles.payoutRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => router.push("/payout-method")}
              activeOpacity={0.8}
            >
              <View style={[styles.payoutIconWrap, { backgroundColor: colors.coinGoldBg }]}>
                <Image source={require("@/assets/icons/ic_withdraw.png")} style={styles.payoutIcon} tintColor={colors.primary} resizeMode="contain" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.payoutMethodLabel, { color: colors.text }]}>{PAYOUT_LABELS[payoutMethod]}</Text>
                <Text style={[styles.payoutMethodSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {summarizePayout(payoutMethod, payoutDetails)}
                </Text>
              </View>
              <Text style={[styles.payoutEdit, { color: colors.primary }]}>{tr.walletScreen.edit}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Set up payout method"
              style={[styles.payoutSetup, { borderColor: colors.primary, backgroundColor: colors.surface }]}
              onPress={() => router.push("/payout-method")}
              activeOpacity={0.8}
            >
              <Image source={require("@/assets/icons/ic_withdraw.png")} style={styles.payoutIcon} tintColor={colors.primary} resizeMode="contain" />
              <Text style={[styles.payoutSetupText, { color: colors.primary }]}>{tr.walletScreen.setupPayout}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.withdrawBtn, { backgroundColor: (withdrawing || !!pendingWithdrawal) ? colors.mutedForeground : colors.primary }]}
            onPress={handleWithdraw}
            activeOpacity={0.85}
            disabled={withdrawing || !!pendingWithdrawal}
          >
            {withdrawing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Image source={require("@/assets/icons/ic_withdraw.png")} style={styles.withdrawIcon} tintColor="#fff" resizeMode="contain" />
                <Text style={styles.withdrawBtnText}>{pendingWithdrawal ? "Withdrawal in progress" : tr.walletScreen.requestWithdrawal}</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={[styles.noteCard, { backgroundColor: colors.coinGoldBg }]}>
            <Text style={[styles.noteTitle, { color: "#FFA100" }]}>{tr.walletScreen.note}</Text>
            <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
              Minimum withdrawal is {minWithdraw} coins. Processing takes 2-3 business days.
              {payoutRate > 0 ? ` Current rate: 1,000 coins ≈ ${formatPayout(1000)}.` : ""}
            </Text>
          </View>

          {withdrawals.length > 0 && (
            <View style={{ gap: 8, marginTop: 4 }}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Your withdrawals</Text>
              {withdrawals.slice(0, 5).map((w: any) => {
                const meta = WITHDRAW_STATUS[w.status] ?? WITHDRAW_STATUS.pending;
                return (
                  <View key={w.id} style={[styles.wdRow, { backgroundColor: colors.card }]}>
                    <View style={styles.wdLeft}>
                      <Image source={require("@/assets/icons/ic_coin.png")} style={styles.wdCoin} resizeMode="contain" />
                      <View>
                        <Text style={[styles.wdAmt, { color: colors.text }]}>{w.coins} {tr.walletScreen.coins}</Text>
                        <Text style={[styles.wdDate, { color: colors.mutedForeground }]}>{w.created_at ? formatTxDate(w.created_at) : ""}</Text>
                      </View>
                    </View>
                    <View style={[styles.wdBadge, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.wdBadgeTxt, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <TouchableOpacity
            style={[styles.fullWithdrawBtn, { backgroundColor: colors.surface, borderColor: colors.primary }]}
            onPress={() => router.push("/payout-method")}
          >
            <Image source={require("@/assets/icons/ic_withdraw.png")} style={styles.withdrawIcon} tintColor={colors.primary} resizeMode="contain" />
            <Text style={[styles.fullWithdrawText, { color: colors.primary }]}>{tr.walletScreen.managePayout}</Text>
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
  payoutValue: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Poppins_500Medium", marginTop: 4 },
  walletImg: { width: 52, height: 52, opacity: 0.9 },
  statsRow: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 12, justifyContent: "space-around" },
  miniStat: { alignItems: "center", gap: 2 },
  miniVal: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  miniLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontFamily: "Poppins_400Regular" },
  miniDiv: { width: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  tabRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  historyCard: { borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  callIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  callIcon: { width: 22, height: 22 },
  histName: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  histMeta: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  earnedRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  smallCoin: { width: 14, height: 14 },
  earnedAmt: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  payoutHint: { fontSize: 12, fontFamily: "Poppins_600SemiBold", marginTop: -4 },
  withdrawGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  withdrawChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  chipCoin: { width: 16, height: 16 },
  chipAmt: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, height: 54 },
  payoutRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  payoutIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  payoutIcon: { width: 20, height: 20 },
  payoutMethodLabel: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  payoutMethodSub: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  payoutEdit: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  payoutSetup: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderRadius: 14, height: 54, borderStyle: "dashed" },
  payoutSetupText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  inputIcon: { width: 20, height: 20 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", backgroundColor: "transparent", borderWidth: 0 },
  withdrawBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  withdrawIcon: { width: 20, height: 20 },
  withdrawBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  noteCard: { borderRadius: 14, padding: 14, gap: 4 },
  noteTitle: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  noteText: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 18 },
  fullWithdrawBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, borderWidth: 1.5 },
  fullWithdrawText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  // Withdrawal request rows (status visibility)
  wdRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  wdLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  wdCoin: { width: 22, height: 22 },
  wdAmt: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  wdDate: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 1 },
  wdBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  wdBadgeTxt: { fontSize: 11, fontFamily: "Poppins_600SemiBold" },
});
