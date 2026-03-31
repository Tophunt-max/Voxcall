import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { Host } from "@/data/mockData";

interface Props {
  host: Host;
  onPress: () => void;
  compact?: boolean;
  onTalkNow?: () => void;
}

function StatusBadge({ isOnline, isBusy }: { isOnline: boolean; isBusy?: boolean }) {
  const colors = useColors();
  const label = isBusy ? "Busy" : isOnline ? "Available" : "Offline";
  const bg = isBusy ? colors.coinGoldBg : isOnline ? "#E6F9EA" : "#F2F2F2";
  const txtColor = isBusy ? colors.coinGold : isOnline ? colors.online : colors.mutedForeground;
  const dotColor = isBusy ? colors.coinGold : isOnline ? colors.online : colors.offline;

  return (
    <View style={[styles.statusBadge, { backgroundColor: bg }]}>
      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.statusText, { color: txtColor }]}>{label}</Text>
    </View>
  );
}

export function HostCard({ host, onPress, compact = false, onTalkNow }: Props) {
  const colors = useColors();

  if (compact) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={[styles.compactCard, { backgroundColor: colors.card }]}
        activeOpacity={0.8}
      >
        <View style={styles.compactAvatarWrapper}>
          <Image
            source={{ uri: host.avatar }}
            style={styles.compactAvatar}
            resizeMode="cover"
          />
          {host.isOnline && (
            <View style={[styles.compactOnlineDot, { backgroundColor: colors.online, borderColor: colors.card }]} />
          )}
        </View>
        <Text style={[styles.compactName, { color: colors.text }]} numberOfLines={1}>
          {host.name.split(" ")[0]}
        </Text>
        <Text style={[styles.compactLang, { color: colors.mutedForeground }]} numberOfLines={1}>
          {host.languages[0]}
        </Text>
        <View style={styles.compactCoinRow}>
          <Image source={require("@/assets/icons/ic_coin.png")} style={styles.compactCoinIcon} resizeMode="contain" />
          <Text style={[styles.compactCoinText, { color: colors.coinGold }]}>{host.coinsPerMinute}/min</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, { backgroundColor: colors.card }]}
    >
      <View style={styles.cardInner}>
        {/* Avatar */}
        <Image
          source={{ uri: host.avatar }}
          style={styles.avatar}
          resizeMode="cover"
        />

        {/* Info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {host.name}
            </Text>
            <StatusBadge isOnline={host.isOnline} />
          </View>

          {/* Language */}
          <View style={styles.langRow}>
            <Image
              source={require("@/assets/icons/ic_language.png")}
              style={styles.langIcon}
              tintColor={colors.mutedForeground}
              resizeMode="contain"
            />
            <Text style={[styles.langText, { color: colors.mutedForeground }]}>
              {host.languages.slice(0, 2).join(", ")}
            </Text>
          </View>

          {/* Topics */}
          <View style={styles.topicsRow}>
            {host.specialties.slice(0, 3).map((s) => (
              <View key={s} style={[styles.topicChip, { backgroundColor: colors.accentLight }]}>
                <Text style={[styles.topicText, { color: colors.accent }]}>{s}</Text>
              </View>
            ))}
          </View>

          {/* Call rate + Talk Now button */}
          <View style={styles.bottomRow}>
            <View style={styles.rateRow}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
              <Text style={[styles.rateText, { color: colors.coinGoldText }]}>
                {host.coinsPerMinute} coins/min
              </Text>
            </View>
            <View style={styles.callIcons}>
              {host.isOnline && (
                <>
                  <Image
                    source={require("@/assets/icons/ic_call.png")}
                    style={styles.callIcon}
                    tintColor={colors.primary}
                    resizeMode="contain"
                  />
                  <Image
                    source={require("@/assets/icons/ic_video.png")}
                    style={styles.callIcon}
                    tintColor={colors.primary}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Talk Now Button */}
      {host.isOnline && (
        <TouchableOpacity
          onPress={onTalkNow ?? onPress}
          style={[styles.talkNowBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.85}
        >
          <Text style={styles.talkNowText}>Talk Now</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    marginBottom: 12,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.10,
        shadowRadius: 18,
      },
      android: { elevation: 4 },
      web: {
        boxShadow: "0 0 18px rgba(0,0,0,0.10)",
      } as any,
    }),
  },
  cardInner: { flexDirection: "row", padding: 12, gap: 10 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 8,
    backgroundColor: "#EEF1F7",
  },
  info: { flex: 1, gap: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: 14, fontFamily: "Poppins_600SemiBold", flex: 1 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  langRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  langIcon: { width: 12, height: 12, opacity: 0.6 },
  langText: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  topicsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  topicChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  topicText: { fontSize: 10, fontFamily: "Poppins_500Medium" },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rateRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  coinIcon: { width: 14, height: 14 },
  rateText: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  callIcons: { flexDirection: "row", gap: 8 },
  callIcon: { width: 18, height: 18 },
  talkNowBtn: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  talkNowText: { color: "#fff", fontSize: 13, fontFamily: "Poppins_600SemiBold" },

  // Compact card (horizontal scroll)
  compactCard: {
    width: 100,
    padding: 10,
    borderRadius: 14,
    alignItems: "center",
    gap: 5,
    marginRight: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 3 },
      web: {
        boxShadow: "0 0 12px rgba(0,0,0,0.08)",
      } as any,
    }),
  },
  compactAvatarWrapper: { position: "relative" },
  compactAvatar: { width: 60, height: 60, borderRadius: 8, backgroundColor: "#EEF1F7" },
  compactOnlineDot: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  compactName: { fontSize: 12, fontFamily: "Poppins_600SemiBold", textAlign: "center" },
  compactLang: { fontSize: 10, fontFamily: "Poppins_400Regular", textAlign: "center" },
  compactCoinRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  compactCoinIcon: { width: 12, height: 12 },
  compactCoinText: { fontSize: 10, fontFamily: "Poppins_500Medium" },
});
