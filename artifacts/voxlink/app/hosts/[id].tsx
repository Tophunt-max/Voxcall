import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { useChat } from "@/context/ChatContext";
import { MOCK_HOSTS } from "@/data/mockData";
import { StarRating } from "@/components/StarRating";
import * as Haptics from "expo-haptics";

export default function HostDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const { getOrCreateConversation } = useChat();
  const [isFav, setIsFav] = useState(false);

  const host = MOCK_HOSTS.find((h) => h.id === id);

  const bottomPad = insets.bottom;

  if (!host) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <Text style={{ color: colors.foreground }}>Host not found</Text>
      </View>
    );
  }

  const handleAudioCall = () => {
    if ((user?.coins ?? 0) < host.coinsPerMinute * 2) {
      Alert.alert("Insufficient Coins", `You need at least ${host.coinsPerMinute * 2} coins to start a call.`, [
        { text: "Buy Coins", onPress: () => router.push("/(tabs)/wallet") },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    initiateCall({ id: host.id, name: host.name, avatar: host.avatar, role: "host" }, "audio", host.coinsPerMinute);
    router.push({ pathname: "/call/outgoing", params: { hostId: host.id, callType: "audio" } });
  };

  const handleVideoCall = () => {
    if ((user?.coins ?? 0) < host.coinsPerMinute * 2) {
      Alert.alert("Insufficient Coins", `You need at least ${host.coinsPerMinute * 2} coins to start a call.`, [
        { text: "Buy Coins", onPress: () => router.push("/(tabs)/wallet") },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    initiateCall({ id: host.id, name: host.name, avatar: host.avatar, role: "host" }, "video", host.coinsPerMinute);
    router.push({ pathname: "/call/outgoing", params: { hostId: host.id, callType: "video" } });
  };

  const handleChat = () => {
    getOrCreateConversation(host.id, host.name, host.avatar);
    router.push(`/chat/${host.id}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomPad + 100 }}>
        <View style={[styles.heroSection, { paddingTop: (insets.top) + 8 }]}>
          <View style={styles.heroNav}>
            <TouchableOpacity onPress={() => router.back()} style={[styles.navBtn, { backgroundColor: colors.card }]}>
              <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 20, height: 20, tintColor: colors.foreground }} resizeMode="contain" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsFav(!isFav); }}
              style={[styles.navBtn, { backgroundColor: colors.card }]}
            >
              <Feather name="heart" size={20} color={isFav ? colors.destructive : colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={styles.profileSection}>
            <View style={styles.avatarWrapper}>
              <Image source={{ uri: host.avatar }} style={styles.avatar} />
              <View style={[styles.onlineDot, { backgroundColor: host.isOnline ? colors.online : colors.offline }]} />
            </View>
            <Text style={[styles.hostName, { color: colors.foreground }]}>{host.name}</Text>
            <Text style={[styles.hostCountry, { color: colors.mutedForeground }]}>{host.country}</Text>
            <TouchableOpacity style={styles.ratingRow} onPress={() => router.push({ pathname: "/hosts/reviews", params: { hostId: host.id } })} activeOpacity={0.8}>
              <StarRating rating={host.rating} size={18} />
              <Text style={[styles.ratingText, { color: colors.mutedForeground }]}>{host.rating} ({host.reviewCount} reviews)</Text>
              <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
            {host.isTopRated && (
              <View style={[styles.topBadge, { backgroundColor: colors.coinGold + "20" }]}>
                <MaterialIcons name="star" size={14} color={colors.coinGold} />
                <Text style={[styles.topBadgeText, { color: colors.coinGold }]}>Top Rated Host</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{host.coinsPerMinute}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Coins/min</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{Math.floor(host.totalMinutes / 60)}h</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total hours</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: host.isOnline ? colors.online : colors.offline }]}>{host.isOnline ? "Online" : "Offline"}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Status</Text>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>About</Text>
          <Text style={[styles.bio, { color: colors.mutedForeground }]}>{host.bio}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Specialties</Text>
          <View style={styles.tags}>
            {host.specialties.map((s) => (
              <View key={s} style={[styles.tag, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.tagText, { color: colors.primary }]}>{s}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Languages</Text>
          <View style={styles.tags}>
            {host.languages.map((l) => (
              <View key={l} style={[styles.tag, { backgroundColor: colors.muted }]}>
                <Feather name="globe" size={12} color={colors.mutedForeground} />
                <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{l}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Reviews preview */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Reviews</Text>
            <TouchableOpacity onPress={() => router.push({ pathname: "/hosts/reviews", params: { hostId: host.id } })}>
              <Text style={[{ fontSize: 13, fontFamily: "Poppins_600SemiBold", color: colors.accent }]}>See all</Text>
            </TouchableOpacity>
          </View>
          {[
            { user: "Sarah M.", avatar: "sarah", rating: 5, text: "Amazing listener! Very understanding and gave great advice." },
            { user: "John D.", avatar: "john", rating: 5, text: "Really helped me through a tough time. Professional and empathetic." },
          ].map((r, i) => (
            <View key={i} style={{ gap: 8, marginBottom: i === 0 ? 14 : 0, paddingBottom: i === 0 ? 14 : 0, borderBottomWidth: i === 0 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Image source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.avatar}` }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Poppins_600SemiBold", color: colors.foreground }}>{r.user}</Text>
                  <Text style={{ color: "#FFA100", fontSize: 11 }}>{"★".repeat(r.rating)}</Text>
                </View>
              </View>
              <Text style={[styles.bio, { color: colors.mutedForeground, marginTop: 0 }]}>{r.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.actionBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: bottomPad + 12 }]}>
        <TouchableOpacity onPress={handleChat} style={[styles.chatBtn, { borderColor: colors.border }]} activeOpacity={0.8}>
          <Feather name="message-circle" size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleAudioCall}
          disabled={!host.isOnline}
          style={[styles.callBtn, { backgroundColor: host.isOnline ? colors.primary : colors.muted }]}
          activeOpacity={0.85}
        >
          <Feather name="phone" size={18} color={host.isOnline ? "#fff" : colors.mutedForeground} />
          <Text style={[styles.callBtnText, { color: host.isOnline ? "#fff" : colors.mutedForeground }]}>Audio Call</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleVideoCall}
          disabled={!host.isOnline}
          style={[styles.callBtn, { backgroundColor: host.isOnline ? colors.gradientEnd : colors.muted }]}
          activeOpacity={0.85}
        >
          <Feather name="video" size={18} color={host.isOnline ? "#fff" : colors.mutedForeground} />
          <Text style={[styles.callBtnText, { color: host.isOnline ? "#fff" : colors.mutedForeground }]}>Video Call</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroSection: { paddingHorizontal: 20, paddingBottom: 24 },
  heroNav: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  navBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  profileSection: { alignItems: "center", gap: 8 },
  avatarWrapper: { position: "relative" },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  onlineDot: { position: "absolute", right: 4, bottom: 4, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: "#fff" },
  hostName: { fontSize: 24, fontFamily: "Poppins_700Bold", marginTop: 8 },
  hostCountry: { fontSize: 14, fontFamily: "Poppins_400Regular" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ratingText: { fontSize: 13, fontFamily: "Poppins_400Regular" },
  topBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  topBadgeText: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  statsRow: { flexDirection: "row", paddingHorizontal: 20, gap: 12, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 14, padding: 14, borderWidth: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Poppins_400Regular" },
  section: { marginHorizontal: 20, borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 12, gap: 10 },
  sectionTitle: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  bio: { fontSize: 14, fontFamily: "Poppins_400Regular", lineHeight: 22 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  tagText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  actionBar: { paddingHorizontal: 20, paddingTop: 12, flexDirection: "row", gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  chatBtn: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  callBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 14 },
  callBtnText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
});
