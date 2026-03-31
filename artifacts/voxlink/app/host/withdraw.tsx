import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, TextInput, Alert, Platform
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

const QUICK_AMOUNTS = [100, 200, 500, 1000];
const MIN_WITHDRAW = 100;

export default function HostWithdrawScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"bank" | "upi" | "paypal">("bank");
  const [loading, setLoading] = useState(false);

  const topPad = insets.top;
  const balance = user?.coins ?? 850;
  const parsedAmt = parseInt(amount) || 0;
  const isValid = parsedAmt >= MIN_WITHDRAW && parsedAmt <= balance;

  const handleWithdraw = async () => {
    if (!isValid) {
      Alert.alert("Invalid Amount", parsedAmt < MIN_WITHDRAW
        ? `Minimum withdrawal is ${MIN_WITHDRAW} coins.`
        : "You don't have enough coins.");
      return;
    }
    setLoading(true);
    await new Promise(r => setTimeout(r, 1500));
    setLoading(false);
    Alert.alert(
      "Withdrawal Requested",
      `Your request to withdraw ${parsedAmt} coins has been submitted. Processing in 3-5 business days.`,
      [{ text: "OK", onPress: () => router.back() }]
    );
  };

  const METHODS = [
    { key: "bank",   label: "Bank Transfer", icon: "credit-card", sub: "3-5 business days" },
    { key: "upi",    label: "UPI / GPay",     icon: "smartphone",  sub: "Instant" },
    { key: "paypal", label: "PayPal",          icon: "globe",       sub: "1-2 business days" },
  ] as const;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Withdraw Coins</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 50 }}>
        {/* Balance card */}
        <View style={[styles.balanceCard, { backgroundColor: "#A00EE7" }]}>
          <Text style={styles.balLabel}>Available Balance</Text>
          <View style={styles.balRow}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.balCoin} resizeMode="contain" />
            <Text style={styles.balAmt}>{balance.toLocaleString()}</Text>
          </View>
          <Text style={styles.balNote}>Min. withdrawal: {MIN_WITHDRAW} coins</Text>
        </View>

        {/* Amount input */}
        <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Enter Amount</Text>
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: parsedAmt > 0 && !isValid ? "#F44336" : colors.border }]}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.inputCoin} resizeMode="contain" />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="0"
              placeholderTextColor={colors.mutedForeground}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
              keyboardType="numeric"
              maxLength={6}
            />
            <TouchableOpacity onPress={() => setAmount(String(balance))}>
              <Text style={[styles.maxBtn, { color: colors.primary }]}>MAX</Text>
            </TouchableOpacity>
          </View>
          {parsedAmt > 0 && !isValid && (
            <Text style={styles.errorText}>
              {parsedAmt < MIN_WITHDRAW ? `Minimum ${MIN_WITHDRAW} coins` : "Exceeds your balance"}
            </Text>
          )}

          {/* Quick amounts */}
          <View style={styles.quickRow}>
            {QUICK_AMOUNTS.map((q) => (
              <TouchableOpacity
                key={q}
                style={[styles.quickChip, { backgroundColor: amount === String(q) ? colors.primary : colors.surface, borderColor: amount === String(q) ? colors.primary : colors.border }]}
                onPress={() => setAmount(String(q))}
              >
                <Text style={[styles.quickText, { color: amount === String(q) ? "#fff" : colors.text }]}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Method */}
        <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Withdrawal Method</Text>
          <View style={{ gap: 10 }}>
            {METHODS.map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[styles.methodCard, {
                  backgroundColor: colors.card,
                  borderColor: method === m.key ? colors.primary : colors.border,
                  borderWidth: method === m.key ? 2 : 1
                }]}
                onPress={() => setMethod(m.key)}
              >
                <View style={[styles.methodIcon, { backgroundColor: method === m.key ? colors.primary + "15" : colors.surface }]}>
                  <Feather name={m.icon} size={18} color={method === m.key ? colors.primary : colors.mutedForeground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.methodLabel, { color: colors.text }]}>{m.label}</Text>
                  <Text style={[styles.methodSub, { color: colors.mutedForeground }]}>{m.sub}</Text>
                </View>
                <View style={[styles.radio, { borderColor: method === m.key ? colors.primary : colors.border }]}>
                  {method === m.key && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Summary */}
        {parsedAmt >= MIN_WITHDRAW && (
          <View style={[styles.summaryBox, { backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 20 }]}>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: colors.mutedForeground }]}>Withdrawal Amount</Text>
              <Text style={[styles.summaryVal, { color: colors.text }]}>{parsedAmt} coins</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: colors.mutedForeground }]}>Processing Fee</Text>
              <Text style={[styles.summaryVal, { color: colors.text }]}>0 coins</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: colors.text, fontFamily: "Poppins_600SemiBold" }]}>You Receive</Text>
              <Text style={[styles.summaryVal, { color: "#0BAF23", fontFamily: "Poppins_700Bold" }]}>{parsedAmt} coins</Text>
            </View>
          </View>
        )}

        {/* Submit button */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: isValid ? colors.primary : colors.border, marginHorizontal: 16, marginTop: 24, opacity: loading ? 0.7 : 1 }]}
          onPress={handleWithdraw}
          disabled={!isValid || loading}
        >
          {loading
            ? <Text style={styles.submitText}>Processing...</Text>
            : <Text style={styles.submitText}>Withdraw {parsedAmt > 0 ? `${parsedAmt} Coins` : "Now"}</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  balanceCard: { marginHorizontal: 16, marginTop: 16, borderRadius: 16, padding: 20, alignItems: "center" },
  balLabel: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.8)", marginBottom: 8 },
  balRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  balCoin: { width: 28, height: 28 },
  balAmt: { fontSize: 32, fontFamily: "Poppins_700Bold", color: "#fff" },
  balNote: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.65)" },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, height: 54 },
  inputCoin: { width: 22, height: 22 },
  input: { flex: 1, fontSize: 22, fontFamily: "Poppins_600SemiBold" },
  maxBtn: { fontSize: 13, fontFamily: "Poppins_700Bold" },
  errorText: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#F44336", marginTop: 4 },
  quickRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  quickChip: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  quickText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  methodCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, gap: 12 },
  methodIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  methodLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  methodSub: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  summaryBox: { borderRadius: 12, padding: 14, gap: 8 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryKey: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  summaryVal: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  summaryDivider: { height: 1 },
  submitBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
