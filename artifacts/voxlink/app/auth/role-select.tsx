import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width, height } = Dimensions.get("window");

const USER_GRAD: [string, string] = ["#A00EE7", "#6A00B8"];
const HOST_GRAD: [string, string] = ["#111329", "#2D3057"];

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.root, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 30 }]}>
      {/* Logo + title */}
      <View style={s.top}>
        <Image source={require("@/assets/images/app_logo.png")} style={s.logo} resizeMode="contain" />
        <Text style={s.appName}>VoxLink</Text>
        <Text style={s.sub}>Who are you today?</Text>
      </View>

      {/* Cards */}
      <View style={s.cards}>
        {/* User Card */}
        <TouchableOpacity onPress={() => router.push("/auth/login")} activeOpacity={0.88} style={s.cardTouch}>
          <LinearGradient colors={USER_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.card}>
            <View style={s.cardIcoWrap}>
              <Image source={require("@/assets/icons/ic_profile.png")} style={s.cardIco} tintColor="#fff" resizeMode="contain" />
            </View>
            <Text style={s.cardTitle}>I'm a User</Text>
            <Text style={s.cardDesc}>Browse hosts, book calls, chat and grow your connections</Text>
            <View style={s.cardArrow}>
              <Image source={require("@/assets/images/onboard_next.png")} style={s.arrowIco} tintColor="rgba(255,255,255,0.8)" resizeMode="contain" />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Host Card */}
        <TouchableOpacity onPress={() => router.push("/auth/host-login")} activeOpacity={0.88} style={s.cardTouch}>
          <LinearGradient colors={HOST_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.card}>
            <View style={s.cardIcoWrap}>
              <Image source={require("@/assets/icons/ic_listener.png")} style={s.cardIco} tintColor="#fff" resizeMode="contain" />
            </View>
            <Text style={s.cardTitle}>I'm a Host</Text>
            <Text style={s.cardDesc}>Manage your sessions, earn coins and grow your audience</Text>
            <View style={s.cardArrow}>
              <Image source={require("@/assets/images/onboard_next.png")} style={s.arrowIco} tintColor="rgba(255,255,255,0.8)" resizeMode="contain" />
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>Choose your role to get started</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAFEFF", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24 },
  top: { alignItems: "center", gap: 8 },
  logo: { width: 72, height: 72 },
  appName: { fontSize: 30, fontFamily: "Poppins_700Bold", color: "#111329" },
  sub: { fontSize: 15, fontFamily: "Poppins_400Regular", color: "#84889F" },
  cards: { gap: 20, width: "100%" },
  cardTouch: { width: "100%", borderRadius: 24, overflow: "hidden" },
  card: { padding: 28, borderRadius: 24, minHeight: 190, justifyContent: "space-between" },
  cardIcoWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  cardIco: { width: 28, height: 28 },
  cardTitle: { fontSize: 24, fontFamily: "Poppins_700Bold", color: "#fff", marginTop: 12 },
  cardDesc: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.8)", lineHeight: 20, marginTop: 4 },
  cardArrow: { alignSelf: "flex-end", marginTop: 8 },
  arrowIco: { width: 26, height: 26 },
  footer: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", textAlign: "center" },
});
