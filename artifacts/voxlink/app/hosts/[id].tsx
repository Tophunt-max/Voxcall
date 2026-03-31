import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  Dimensions,
  Clipboard,
  ToastAndroid,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { useChat } from "@/context/ChatContext";
import { MOCK_HOSTS } from "@/data/mockData";

const { width: SW, height: SH } = Dimensions.get("window");

/* ─── Exact Flutter colors ─── */
const INFO_BG       = "#F3E6FF";
const CARD_BG       = "#F6F8FF";
const PROFILE_TEXT  = "#616263";
const PROFILE_LANG  = "#84889F";
const BORDER        = "#F1F1F1";
const REVIEW_BG     = "#F6F8FF";
const REVIEW_BORDER = "#EEEEF7";
const LIGHT_YELLOW  = "#FFFACF";
const ORANGE        = "#E49F14";
const ID_BG         = "#E9D5FB";
const ID_TXT        = "#9A74BD";
const STAR_COLOR    = "#FEA622";
const GREEN         = "#0BAF23";
const APP_COLOR     = "#111329";
const ACCENT        = "#A00EE7";

/* ─── Star rating component ─── */
function StarRating({ rating, size = 22 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Image
          key={i}
          source={require("@/assets/icons/ic_star.png")}
          style={{ width: size, height: size }}
          tintColor={i <= Math.round(rating) ? STAR_COLOR : "#E0E0E0"}
          resizeMode="contain"
        />
      ))}
    </View>
  );
}

/* ─── Talk Now bottom sheet ─── */
function TalkNowSheet({
  visible, host, onClose, onAudio, onVideo,
}: {
  visible: boolean;
  host: (typeof MOCK_HOSTS)[0];
  onClose: () => void;
  onAudio: () => void;
  onVideo: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheetBox}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Select Call Type</Text>

          {/* Audio Call */}
          <TouchableOpacity onPress={onAudio} style={styles.sheetRow} activeOpacity={0.8}>
            <Image source={require("@/assets/icons/ic_call_gradient.png")} style={styles.sheetIco} resizeMode="contain" />
            <Text style={styles.sheetLabel}>Audio Call</Text>
            <View style={styles.coinChip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={styles.sheetCoinIco} resizeMode="contain" />
              <Text style={styles.sheetCoinTxt}>{host.coinsPerMinute} Coin/min</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.sheetDivider} />

          {/* Video Call */}
          <TouchableOpacity onPress={onVideo} style={styles.sheetRow} activeOpacity={0.8}>
            <Image source={require("@/assets/icons/ic_video_gradient.png")} style={styles.sheetIco} resizeMode="contain" />
            <Text style={styles.sheetLabel}>Video Call</Text>
            <View style={styles.coinChip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={styles.sheetCoinIco} resizeMode="contain" />
              <Text style={styles.sheetCoinTxt}>{host.coinsPerMinute + 5} Coin/min</Text>
            </View>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ═══════════════════ MAIN SCREEN ═══════════════════ */
export default function HostDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const { getOrCreateConversation } = useChat();
  const [talkSheet, setTalkSheet] = useState(false);

  const host = MOCK_HOSTS.find((h) => h.id === id);

  if (!host) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <Text style={{ color: APP_COLOR }}>Host not found</Text>
      </View>
    );
  }

  /* ─── Derived fields ─── */
  const age = 24 + (parseInt(host.id.replace("host", "")) * 3 % 10);
  const uniqueId = `VX${host.id.replace("host", "").padStart(6, "0")}`;
  const callCount = host.reviewCount * 2;
  const experience = `${Math.max(1, Math.floor(host.totalMinutes / 5000))}+`;
  const statusLabel = host.isOnline ? "Online" : "Offline";

  /* ─── Handlers ─── */
  const checkCoins = (type: "audio" | "video") => {
    const rate = type === "audio" ? host.coinsPerMinute : host.coinsPerMinute + 5;
    if ((user?.coins ?? 0) < rate * 2) {
      Alert.alert("Insufficient Coins", `You need at least ${rate * 2} coins.`, [
        { text: "Buy Coins", onPress: () => router.push("/(tabs)/wallet") },
        { text: "Cancel", style: "cancel" },
      ]);
      return false;
    }
    return true;
  };

  const handleAudio = () => {
    setTalkSheet(false);
    if (!checkCoins("audio")) return;
    initiateCall({ id: host.id, name: host.name, avatar: host.avatar, role: "host" }, "audio", host.coinsPerMinute);
    router.push({ pathname: "/call/outgoing", params: { hostId: host.id, callType: "audio" } });
  };

  const handleVideo = () => {
    setTalkSheet(false);
    if (!checkCoins("video")) return;
    initiateCall({ id: host.id, name: host.name, avatar: host.avatar, role: "host" }, "video", host.coinsPerMinute + 5);
    router.push({ pathname: "/call/outgoing", params: { hostId: host.id, callType: "video" } });
  };

  const handleChat = () => {
    getOrCreateConversation(host.id, host.name, host.avatar);
    router.push(`/chat/${host.id}`);
  };

  const handleCopyId = () => {
    Clipboard.setString(uniqueId);
    if (Platform.OS === "android") ToastAndroid.show("Copied!", ToastAndroid.SHORT);
  };

  /* ─── Mock reviews ─── */
  const reviews = [
    { name: "Sarah M.", avatar: "sarah", rating: 5, text: "Amazing listener! Very understanding and gave great advice.", time: "2d ago" },
    { name: "John D.", avatar: "john", rating: 5, text: "Really helped me through a tough time. Professional and empathetic.", time: "5d ago" },
    { name: "Emma W.", avatar: "emma", rating: 4, text: "Insightful conversation. Would definitely recommend!", time: "1w ago" },
  ];

  const statsList = [
    { image: require("@/assets/icons/ic_call_gradient.png"), title: "Total Call", count: String(callCount) },
    { image: require("@/assets/icons/ic_star.png"), title: "Rating", count: host.rating.toFixed(1) },
    { image: require("@/assets/icons/ic_experience.png"), title: "Experience", count: experience },
  ];

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* ── TopImageView (38% height) ── */}
        <View style={styles.coverWrap}>
          <Image source={{ uri: host.avatar }} style={styles.coverImg} resizeMode="cover" />
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.30)"]}
            style={StyleSheet.absoluteFillObject}
          />
        </View>

        {/* ── UserProfileInfoView ── */}
        <View style={styles.infoCard}>
          <View style={styles.infoTopRow}>
            {/* Avatar dotted border */}
            <View style={styles.avatarDotBorder}>
              <View style={styles.avatarCircle}>
                <Image source={{ uri: host.avatar }} style={styles.avatarImg} resizeMode="cover" />
              </View>
            </View>

            {/* Name + status + ID */}
            <View style={styles.infoMid}>
              <Text style={styles.infoName} numberOfLines={1}>
                {host.name}, {age}
              </Text>
              <View style={styles.statusRow}>
                {/* Status badge */}
                <View style={[
                  styles.statusBadge,
                  { backgroundColor: host.isOnline ? GREEN : "#EDEDEF" },
                ]}>
                  <View style={[
                    styles.statusDotOuter,
                    { backgroundColor: host.isOnline ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.08)" },
                  ]}>
                    <View style={[
                      styles.statusDotInner,
                      { backgroundColor: host.isOnline ? "#fff" : PROFILE_LANG },
                    ]} />
                  </View>
                  <Text style={[styles.statusTxt, { color: host.isOnline ? "#fff" : PROFILE_LANG }]}>
                    {statusLabel}
                  </Text>
                </View>

                {/* ID chip */}
                <TouchableOpacity onPress={handleCopyId} style={styles.idChip} activeOpacity={0.7}>
                  <Text style={styles.idTxt} numberOfLines={1}>ID: {uniqueId}</Text>
                  <Image source={require("@/assets/icons/ic_copy.png")} style={styles.copyIco} tintColor={ID_TXT} resizeMode="contain" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Coin rate chip */}
            <View style={styles.coinRateChip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinRateIco} resizeMode="contain" />
              <Text style={styles.coinRateTxt}>{host.coinsPerMinute} Coin</Text>
            </View>
          </View>

          {/* Bio / self intro */}
          <Text style={styles.bioTxt}>{host.bio}</Text>

          {/* Language row */}
          <View style={styles.langRow}>
            <Image source={require("@/assets/icons/ic_language.png")} style={styles.langIco} resizeMode="contain" />
            <Text style={styles.langLabel}>Language : </Text>
            <Text style={styles.langValue} numberOfLines={1}>{host.languages.join(", ")}</Text>
          </View>

          {/* Topics tags */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.topicsScroll}
            contentContainerStyle={{ gap: 6, paddingRight: 12 }}
          >
            {host.specialties.map((s) => (
              <View key={s} style={styles.topicTag}>
                <Text style={styles.topicTxt}>{s}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── StatusView (3 stat boxes) ── */}
        <View style={styles.statsRow}>
          {statsList.map((item, i) => (
            <View key={i} style={styles.statBox}>
              <Image source={item.image} style={styles.statIco} resizeMode="contain" />
              <Text style={styles.statLabel}>{item.title}</Text>
              <Text style={styles.statCount}>{item.count}</Text>
            </View>
          ))}
        </View>

        {/* ── ReviewShow ── */}
        {reviews.length > 0 && (
          <View style={styles.reviewSection}>
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewHeaderTxt}>Reviews</Text>
              <TouchableOpacity
                onPress={() => router.push({ pathname: "/hosts/reviews", params: { hostId: host.id } })}
              >
                <Text style={styles.viewAllTxt}>View All</Text>
              </TouchableOpacity>
            </View>

            {reviews.slice(0, 4).map((r, i) => (
              <View key={i} style={styles.reviewCard}>
                <View style={styles.reviewTop}>
                  <View style={styles.reviewAvatarDot}>
                    <View style={styles.reviewAvatarCircle}>
                      <Image
                        source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.avatar}` }}
                        style={styles.reviewAvatarImg}
                      />
                    </View>
                  </View>
                  <View style={styles.reviewUserInfo}>
                    <Text style={styles.reviewUsername}>{r.name}</Text>
                    <StarRating rating={r.rating} size={18} />
                  </View>
                  <View style={styles.reviewTimeBadge}>
                    <Text style={styles.reviewTimeTxt}>{r.time}</Text>
                  </View>
                </View>
                <Text style={styles.reviewTxt}>{r.text}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Back button (positioned over cover) ── */}
      <View style={[styles.backBtnWrap, { top: insets.top + 8, pointerEvents: "box-none" }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.85}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIco} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>
      </View>

      {/* ── ProfileBottomButtonView ── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        {/* Chat Now */}
        <TouchableOpacity onPress={handleChat} style={[styles.bottomBtn, { backgroundColor: GREEN }]} activeOpacity={0.85}>
          <Text style={styles.bottomBtnTxt}>Chat Now</Text>
        </TouchableOpacity>

        {/* Talk Now */}
        {host.isOnline && (
          <TouchableOpacity
            onPress={() => setTalkSheet(true)}
            style={[styles.bottomBtn, { backgroundColor: APP_COLOR }]}
            activeOpacity={0.85}
          >
            <Image source={require("@/assets/icons/ic_call_gradient.png")} style={styles.talkIco} tintColor="#fff" resizeMode="contain" />
            <Text style={styles.bottomBtnTxt}>Talk Now</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Talk Now sheet ── */}
      <TalkNowSheet
        visible={talkSheet}
        host={host}
        onClose={() => setTalkSheet(false)}
        onAudio={handleAudio}
        onVideo={handleVideo}
      />
    </View>
  );
}

/* ═══════════════════ STYLES ═══════════════════ */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },

  /* cover image */
  coverWrap: { width: SW, height: SH * 0.38, overflow: "hidden" },
  coverImg: { width: "100%", height: "100%" },

  /* info card */
  infoCard: {
    backgroundColor: INFO_BG,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  infoTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 },

  /* avatar dotted */
  avatarDotBorder: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: "#111329",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCircle: { width: 50, height: 50, borderRadius: 25, overflow: "hidden", backgroundColor: "#eee" },
  avatarImg: { width: "100%", height: "100%" },

  /* name + status */
  infoMid: { flex: 1 },
  infoName: { fontSize: 16, fontFamily: "Poppins_700Bold", color: "#111329", marginBottom: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },

  /* status badge */
  statusBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 4, borderRadius: 20, gap: 4 },
  statusDotOuter: { width: 11, height: 11, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  statusDotInner: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 10, fontFamily: "Poppins_500Medium" },

  /* ID chip */
  idChip: { flexDirection: "row", alignItems: "center", backgroundColor: ID_BG, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 60, gap: 3 },
  idTxt: { fontSize: 10, fontFamily: "Poppins_600SemiBold", color: ID_TXT },
  copyIco: { width: 12, height: 12 },

  /* coin rate chip */
  coinRateChip: { flexDirection: "row", alignItems: "center", backgroundColor: LIGHT_YELLOW, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 30, gap: 4 },
  coinRateIco: { width: 18, height: 18 },
  coinRateTxt: { fontSize: 12, fontFamily: "Poppins_700Bold", color: ORANGE },

  /* bio */
  bioTxt: { fontSize: 12, fontFamily: "Poppins_500Medium", color: PROFILE_TEXT, lineHeight: 21, paddingVertical: 10 },

  /* language row */
  langRow: { flexDirection: "row", alignItems: "center", paddingTop: 8, paddingHorizontal: 0 },
  langIco: { width: 20, height: 20 },
  langLabel: { fontSize: 14, fontFamily: "Poppins_500Medium", color: PROFILE_LANG, marginLeft: 8 },
  langValue: { flex: 1, fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#111329" },

  /* topics */
  topicsScroll: { marginTop: 20, marginBottom: 20, maxHeight: 34 },
  topicTag: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: CARD_BG, borderRadius: 30 },
  topicTxt: { fontSize: 12, fontFamily: "Poppins_500Medium", color: PROFILE_LANG },

  /* stats */
  statsRow: { flexDirection: "row", paddingHorizontal: 8, paddingBottom: 10, gap: 0 },
  statBox: {
    flex: 1,
    marginHorizontal: 8,
    paddingHorizontal: 7,
    paddingVertical: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    alignItems: "center",
    gap: 5,
  },
  statIco: { width: 34, height: 34, marginBottom: 4 },
  statLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", color: PROFILE_LANG },
  statCount: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329" },

  /* reviews */
  reviewSection: { paddingHorizontal: 16, paddingBottom: 16 },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 26, paddingBottom: 18 },
  reviewHeaderTxt: { fontSize: 18, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  viewAllTxt: { fontSize: 13, fontFamily: "Poppins_500Medium", color: PROFILE_LANG, textDecorationLine: "underline" },
  reviewCard: {
    backgroundColor: REVIEW_BG,
    borderWidth: 1,
    borderColor: REVIEW_BORDER,
    borderRadius: 18,
    padding: 10,
    marginBottom: 14,
  },
  reviewTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6, paddingTop: 5, paddingBottom: 6 },
  reviewAvatarDot: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1.5,
    borderColor: "#111329",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  reviewAvatarCircle: { width: 48, height: 48, borderRadius: 24, overflow: "hidden", backgroundColor: "#eee" },
  reviewAvatarImg: { width: "100%", height: "100%" },
  reviewUserInfo: { flex: 1 },
  reviewUsername: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: "#111329", marginBottom: 2 },
  reviewTimeBadge: { backgroundColor: "#E7EBF7", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 34 },
  reviewTimeTxt: { fontSize: 10, fontFamily: "Poppins_600SemiBold", color: PROFILE_LANG },
  reviewTxt: { fontSize: 12, fontFamily: "Poppins_500Medium", color: PROFILE_LANG, lineHeight: 21 },

  /* back button */
  backBtnWrap: { position: "absolute", left: 17, right: 0 },
  backBtn: {
    width: 35,
    height: 35,
    borderRadius: 30,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  backIco: { width: 17, height: 17 },

  /* bottom bar */
  bottomBar: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  bottomBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: SH * 0.03,
    borderRadius: 12,
    gap: 8,
  },
  bottomBtnTxt: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#fff", marginBottom: 10 },
  talkIco: { width: 22, height: 22, marginBottom: 10 },

  /* Talk Now sheet */
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 30 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E0E0E0", alignSelf: "center", marginTop: 12, marginBottom: 16 },
  sheetTitle: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329", textAlign: "center", paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee" },
  sheetRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 18, gap: 12 },
  sheetIco: { width: 32, height: 32 },
  sheetLabel: { flex: 1, fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  sheetDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#eee", marginHorizontal: 20 },
  coinChip: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF8E7", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16, gap: 4 },
  sheetCoinIco: { width: 16, height: 16 },
  sheetCoinTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: ORANGE },
});
