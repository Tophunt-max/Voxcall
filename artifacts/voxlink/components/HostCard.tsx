import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from "react-native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { Host } from "@/data/mockData";

interface Props {
  host: Host;
  onPress: () => void;
  compact?: boolean;
}

export function HostCard({ host, onPress, compact = false }: Props) {
  const colors = useColors();

  if (compact) {
    return (
      <TouchableOpacity onPress={onPress} style={[styles.compactCard, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={0.75}>
        <View style={styles.compactAvatarWrapper}>
          <Image source={{ uri: host.avatar }} style={styles.compactAvatar} />
          <View style={[styles.onlineDot, { backgroundColor: host.isOnline ? colors.online : colors.offline }]} />
        </View>
        <Text style={[styles.compactName, { color: colors.foreground }]} numberOfLines={1}>{host.name}</Text>
        <View style={styles.compactRating}>
          <MaterialIcons name="star" size={10} color={colors.coinGold} />
          <Text style={[styles.compactRatingText, { color: colors.mutedForeground }]}>{host.rating}</Text>
        </View>
        <View style={styles.compactCoins}>
          <Text style={[styles.compactCoinText, { color: colors.primary }]}>{host.coinsPerMinute}</Text>
          <Text style={[styles.compactCoinLabel, { color: colors.mutedForeground }]}>/min</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={0.75}>
      <View style={styles.cardTop}>
        <View style={styles.avatarWrapper}>
          <Image source={{ uri: host.avatar }} style={styles.avatar} />
          <View style={[styles.onlineDot, { backgroundColor: host.isOnline ? colors.online : colors.offline }]} />
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{host.name}</Text>
            {host.isTopRated && (
              <View style={[styles.topBadge, { backgroundColor: colors.coinGold + "22" }]}>
                <MaterialIcons name="star" size={10} color={colors.coinGold} />
                <Text style={[styles.topBadgeText, { color: colors.coinGold }]}>TOP</Text>
              </View>
            )}
          </View>
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((i) => (
              <MaterialIcons key={i} name="star" size={12} color={i <= Math.floor(host.rating) ? colors.coinGold : colors.border} />
            ))}
            <Text style={[styles.ratingText, { color: colors.mutedForeground }]}> {host.rating} ({host.reviewCount})</Text>
          </View>
          <Text style={[styles.country, { color: colors.mutedForeground }]}>{host.country}</Text>
        </View>
        <View style={styles.coinBadge}>
          <Text style={[styles.coinAmount, { color: colors.primary }]}>{host.coinsPerMinute}</Text>
          <Text style={[styles.coinLabel, { color: colors.mutedForeground }]}>coins/min</Text>
        </View>
      </View>
      <Text style={[styles.bio, { color: colors.mutedForeground }]} numberOfLines={2}>{host.bio}</Text>
      <View style={styles.tags}>
        {host.specialties.slice(0, 3).map((s) => (
          <View key={s} style={[styles.tag, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.tagText, { color: colors.primary }]}>{s}</Text>
          </View>
        ))}
      </View>
      <View style={styles.bottomRow}>
        <View style={styles.langRow}>
          <Feather name="globe" size={12} color={colors.mutedForeground} />
          <Text style={[styles.langText, { color: colors.mutedForeground }]}>{host.languages.slice(0, 2).join(", ")}</Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: host.isOnline ? colors.online + "22" : colors.muted }]}>
          <View style={[styles.statusDot, { backgroundColor: host.isOnline ? colors.online : colors.offline }]} />
          <Text style={[styles.statusText, { color: host.isOnline ? colors.online : colors.mutedForeground }]}>
            {host.isOnline ? "Available" : "Offline"}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    gap: 10,
  },
  cardTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  avatarWrapper: { position: "relative" },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  onlineDot: { position: "absolute", right: 2, bottom: 2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: "#fff" },
  info: { flex: 1, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  topBadge: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  topBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold" },
  ratingRow: { flexDirection: "row", alignItems: "center" },
  ratingText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  country: { fontSize: 12, fontFamily: "Inter_400Regular" },
  coinBadge: { alignItems: "center" },
  coinAmount: { fontSize: 20, fontFamily: "Inter_700Bold" },
  coinLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  bio: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  tagText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  bottomRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  langRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  langText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  compactCard: {
    width: 110,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
    marginRight: 10,
  },
  compactAvatarWrapper: { position: "relative" },
  compactAvatar: { width: 48, height: 48, borderRadius: 24 },
  compactName: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  compactRating: { flexDirection: "row", alignItems: "center", gap: 2 },
  compactRatingText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  compactCoins: { flexDirection: "row", alignItems: "baseline", gap: 1 },
  compactCoinText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  compactCoinLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },
});
