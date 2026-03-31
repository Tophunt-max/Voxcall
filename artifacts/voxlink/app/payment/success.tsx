// VoxLink Payment Success Screen

import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, TouchableOpacity, Image } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function PaymentSuccessScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 60,
        friction: 7,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.center}>
        <Animated.View
          style={[
            styles.checkCircle,
            { backgroundColor: colors.accentLight, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <View style={[styles.checkInner, { backgroundColor: colors.accent }]}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: fadeAnim, alignItems: "center" }}>
          <Text style={[styles.title, { color: colors.text }]}>Payment Successful!</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Coins have been added to your wallet
          </Text>

          <View style={[styles.balanceCard, { backgroundColor: colors.coinGoldBg }]}>
            <Image
              source={require("@/assets/icons/ic_coin.png")}
              style={styles.coinIcon}
            />
            <Text style={[styles.balanceText, { color: colors.coinGoldText }]}>
              {(user?.coins ?? 0).toLocaleString()} Coins
            </Text>
          </View>

          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            You can now use your coins to make calls with hosts
          </Text>
        </Animated.View>
      </View>

      <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
          onPress={() => router.replace("/screens/user/")}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryBtnText}>Find a Host to Talk With</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={() => router.replace("/screens/user/wallet")}
          activeOpacity={0.8}
        >
          <Text style={[styles.secondaryBtnText, { color: colors.text }]}>View Wallet</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 20,
  },
  checkCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  checkInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  checkMark: {
    fontSize: 36,
    color: "#fff",
    fontFamily: "Poppins_700Bold",
  },
  title: {
    fontSize: 24,
    fontFamily: "Poppins_700Bold",
    textAlign: "center",
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    marginBottom: 16,
  },
  balanceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
  },
  coinIcon: { width: 32, height: 32, resizeMode: "contain" },
  balanceText: { fontSize: 22, fontFamily: "Poppins_700Bold" },
  note: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 18,
  },
  footer: {
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  primaryBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Poppins_700Bold",
  },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1.5,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontFamily: "Poppins_600SemiBold",
  },
});
