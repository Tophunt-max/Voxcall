import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { MOCK_HOSTS } from "@/data/mockData";

const { width } = Dimensions.get("window");

export default function RandomScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [finding, setFinding] = useState(false);
  const [callType, setCallType] = useState<"audio" | "video">("audio");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const onlineHosts = MOCK_HOSTS.filter((h) => h.isOnline);

  const handleFindMatch = () => {
    setFinding(true);
    setTimeout(() => {
      setFinding(false);
      const random = onlineHosts[Math.floor(Math.random() * onlineHosts.length)];
      if (random) router.push(`/hosts/${random.id}`);
    }, 2000);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.text }]}>Random Match</Text>
      </View>

      <View style={[styles.content, { paddingBottom: bottomPad + 90 }]}>
        {/* Background dots pattern */}
        <Image
          source={require("@/assets/images/dot_bg.png")}
          style={styles.dotsBg}
          resizeMode="cover"
        />

        {/* Center animation area */}
        <View style={styles.matchArea}>
          <Image
            source={require("@/assets/images/match_bg.png")}
            style={styles.randomBg}
            resizeMode="contain"
          />
          <View style={styles.matchCircleWrapper}>
            {finding ? (
              <View style={[styles.matchCircle, { backgroundColor: colors.primary + "20" }]}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.findingText, { color: colors.primary }]}>Finding match...</Text>
              </View>
            ) : (
              <View style={[styles.matchCircle, { backgroundColor: colors.accentLight }]}>
                <Image
                  source={require("@/assets/icons/ic_shuffle.png")}
                  style={[styles.randomIcon, { tintColor: colors.accent }]}
                  resizeMode="contain"
                />
              </View>
            )}
          </View>
        </View>

        <Text style={[styles.heading, { color: colors.text }]}>
          Connect with a Random Listener
        </Text>
        <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
          Instantly match with an available listener for a spontaneous conversation
        </Text>

        {/* Call type selector */}
        <View style={[styles.callTypeRow, { backgroundColor: colors.muted }]}>
          <TouchableOpacity
            onPress={() => setCallType("audio")}
            style={[styles.callTypeBtn, callType === "audio" && { backgroundColor: colors.card }]}
          >
            <Image
              source={require("@/assets/icons/ic_call.png")}
              style={[styles.callTypeIcon, { tintColor: callType === "audio" ? colors.primary : colors.mutedForeground }]}
              resizeMode="contain"
            />
            <Text
              style={[
                styles.callTypeText,
                { color: callType === "audio" ? colors.primary : colors.mutedForeground },
              ]}
            >
              Audio Call
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setCallType("video")}
            style={[styles.callTypeBtn, callType === "video" && { backgroundColor: colors.card }]}
          >
            <Image
              source={require("@/assets/icons/ic_video.png")}
              style={[styles.callTypeIcon, { tintColor: callType === "video" ? colors.primary : colors.mutedForeground }]}
              resizeMode="contain"
            />
            <Text
              style={[
                styles.callTypeText,
                { color: callType === "video" ? colors.primary : colors.mutedForeground },
              ]}
            >
              Video Call
            </Text>
          </TouchableOpacity>
        </View>

        {/* Online count info */}
        <View style={[styles.infoRow, { backgroundColor: "#F0E4F8" }]}>
          <Image
            source={require("@/assets/icons/ic_users.png")}
            style={[styles.infoIcon, { tintColor: colors.accent }]}
            resizeMode="contain"
          />
          <Text style={[styles.infoText, { color: colors.accent }]}>
            {onlineHosts.length} listeners available right now
          </Text>
        </View>

        {/* Find button */}
        <TouchableOpacity
          onPress={handleFindMatch}
          disabled={finding}
          style={[
            styles.findBtn,
            {
              backgroundColor: finding ? colors.mutedForeground : colors.primary,
              opacity: finding ? 0.7 : 1,
            },
          ]}
          activeOpacity={0.85}
        >
          {finding ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.findBtnText}>Find a Match</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/hosts/all")} style={styles.browseLink}>
          <Text style={[styles.browseLinkText, { color: colors.mutedForeground }]}>
            Or browse all listeners
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  dotsBg: {
    position: "absolute",
    width: "100%",
    height: "100%",
    opacity: 0.3,
  },
  matchArea: {
    alignItems: "center",
    justifyContent: "center",
    width: 200,
    height: 200,
  },
  randomBg: {
    position: "absolute",
    width: 200,
    height: 200,
    opacity: 0.5,
  },
  matchCircleWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  matchCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  randomIcon: { width: 48, height: 48 },
  findingText: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  heading: { fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  subheading: {
    fontSize: 13,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  callTypeRow: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
    gap: 4,
    width: "100%",
  },
  callTypeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 9,
  },
  callTypeIcon: { width: 18, height: 18 },
  callTypeText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    width: "100%",
  },
  infoIcon: { width: 18, height: 18 },
  infoText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  findBtn: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  findBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  browseLink: { paddingVertical: 8 },
  browseLinkText: { fontSize: 13, fontFamily: "Poppins_400Regular" },
});
