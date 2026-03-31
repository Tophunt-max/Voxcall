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

/* ─── Colors (exact Flutter source) ─── */
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
const COVER_GRAD: [string, string] = ["#2A1A4E", "#111329"];

/* ─── Star rating ─── */
function StarRating({ rating, size = 18 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Image
          key={i}
          source={require("@/assets/icons/ic_star.png")}
          style={{ width: size, height: size }}
          tintColor={i <= Math.round(rating) ? STAR_COLOR : "#D0D0D0"}
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
      <TouchableOpacity style={sht.overlay} activeOpacity={1} onPress={onClose}>
        <View style={sht.box}>
          <View style={sht.handle} />
          <Text style={sht.title}>Select Call Type</Text>

          <TouchableOpacity onPress={onAudio} style={sht.row} activeOpacity={0.8}>
            <Image source={require("@/assets/icons/ic_call_gradient.png")} style={sht.ico} resizeMode="contain" />
            <Text style={sht.label}>Audio Call</Text>
            <View style={sht.chip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={sht.chipIco} resizeMode="contain" />
              <Text style={sht.chipTxt}>{host.coinsPerMinute} Coin/min</Text>
            </View>
          </TouchableOpacity>

          <View style={sht.divider} />

          <TouchableOpacity onPress={onVideo} style={sht.row} activeOpacity={0.8}>
            <Image source={require("@/assets/icons/ic_video_gradient.png")} style={sht.ico} resizeMode="contain" />
            <Text style={sht.label}>Video Call</Text>
            <View style={sht.chip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={sht.chipIco} resizeMode="contain" />
              <Text style={sht.chipTxt}>{host.coinsPerMinute + 5} Coin/min</Text>
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
        <Text style={{ color: APP_COLOR, fontFamily: "Poppins_500Medium" }}>Host not found</Text>
      </View>
    );
  }

  /* ─── Derived fields ─── */
  const num = parseInt(host.id.replace("host", "")) || 1;
  const age = 24 + (num * 3 % 10);
  const uniqueId = `VX${String(num).padStart(6, "0")}`;
  const callCount = host.reviewCount * 2;
  const experience = `${Math.max(1, Math.floor(host.totalMinutes / 5000))}+`;
  const rateVideo = host.coinsPerMinute + 5;

  /* ─── Handlers ─── */
  const checkCoins = (rate: number) => {
    if ((user?.coins ?? 0) < rate * 2) {
      Alert.alert(
        "Insufficient Coins",
        `You need at least ${rate * 2} coins to start a call.`,
        [
          { text: "Buy Coins", onPress: () => router.push("/screens/user/wallet") },
          { text: "Cancel", style: "cancel" },
        ]
      );
      return false;
    }
    return true;
  };

  const handleAudio = () => {
    setTalkSheet(false);
    if (!checkCoins(host.coinsPerMinute)) return;
    initiateCall({ id: host.id, name: host.name, avatar: host.avatar, role: "host" }, "audio", host.coinsPerMinute);
    router.push({ pathname: "/call/outgoing", params: { hostId: host.id, callType: "audio" } });
  };

  const handleVideo = () => {
    setTalkSheet(false);
    if (!checkCoins(rateVideo)) return;
    initiateCall({ id: host.id, name: host.name, avatar: host.avatar, role: "host" }, "video", rateVideo);
    router.push({ pathname: "/call/outgoing", params: { hostId: host.id, callType: "video" } });
  };

  const handleChat = () => {
    getOrCreateConversation(host.id, host.name, host.avatar);
    router.push(`/chat/${host.id}`);
  };

  const copyId = () => {
    if (Platform.OS === "android") {
      // Android clipboard
      try { require("react-native").Clipboard?.setString(uniqueId); } catch (_) {}
    }
  };

  /* ─── Mock reviews ─── */
  const reviews = [
    { name: "Sarah M.", seed: "sarah", rating: 5, text: "Amazing listener! Very understanding and gave great advice.", time: "2d ago" },
    { name: "John D.", seed: "john", rating: 5, text: "Really helped me through a tough time. Professional and empathetic.", time: "5d ago" },
    { name: "Emma W.", seed: "emma", rating: 4, text: "Insightful conversation. Would definitely recommend!", time: "1w ago" },
  ];

  const statsList = [
    { image: require("@/assets/icons/ic_call_gradient.png"), title: "Total Call", count: String(callCount) },
    { image: require("@/assets/icons/ic_star.png"), title: "Rating", count: host.rating.toFixed(1) },
    { image: require("@/assets/icons/ic_experience.png"), title: "Experience", count: experience },
  ];

  const BOTTOM_H = insets.bottom + 70;

  return (
    <View style={s.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: BOTTOM_H + 16 }}
      >
        {/* ══════ TopImageView — gradient hero + centered avatar ══════ */}
        <LinearGradient colors={COVER_GRAD} style={[s.hero, { paddingTop: insets.top + 8 }]}>
          {/* Back button */}
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.85}>
            <Image
              source={require("@/assets/icons/ic_back.png")}
              style={s.backIco}
              tintColor="#fff"
              resizeMode="contain"
            />
          </TouchableOpacity>

          {/* Centered avatar */}
          <View style={s.heroCenterCol}>
            <View style={s.heroDotBorder}>
              <Image source={{ uri: host.avatar }} style={s.heroAvatar} resizeMode="cover" />
            </View>
            <Text style={s.heroName}>{host.name}</Text>
            <View style={s.heroRatingRow}>
              <Image source={require("@/assets/icons/ic_star.png")} style={{ width: 16, height: 16 }} tintColor={STAR_COLOR} resizeMode="contain" />
              <Text style={s.heroRatingTxt}>{host.rating} ({host.reviewCount} reviews)</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ══════ UserProfileInfoView ══════ */}
        <View style={s.infoCard}>
          <View style={s.infoTopRow}>
            {/* Avatar dotted (small, 50x50) */}
            <View style={s.infoDotBorder}>
              <View style={s.infoAvatarCircle}>
                <Image source={{ uri: host.avatar }} style={s.infoAvatarImg} resizeMode="cover" />
              </View>
            </View>

            {/* Name + status + ID */}
            <View style={s.infoMid}>
              <Text style={s.infoName} numberOfLines={1}>{host.name}, {age}</Text>
              <View style={s.statusRow}>
                {/* Status pill */}
                <View style={[s.statusPill, { backgroundColor: host.isOnline ? GREEN : "#EDEDEF" }]}>
                  <View style={[s.dotOuter, { backgroundColor: host.isOnline ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.08)" }]}>
                    <View style={[s.dotInner, { backgroundColor: host.isOnline ? "#fff" : PROFILE_LANG }]} />
                  </View>
                  <Text style={[s.statusTxt, { color: host.isOnline ? "#fff" : PROFILE_LANG }]}>
                    {host.isOnline ? "Online" : "Offline"}
                  </Text>
                </View>
                {/* ID chip */}
                <TouchableOpacity onPress={copyId} style={s.idChip} activeOpacity={0.7}>
                  <Text style={s.idTxt} numberOfLines={1}>ID: {uniqueId}</Text>
                  <Image source={require("@/assets/icons/ic_copy.png")} style={s.copyIco} tintColor={ID_TXT} resizeMode="contain" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Coin rate chip */}
            <View style={s.coinChip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={s.coinChipIco} resizeMode="contain" />
              <Text style={s.coinChipTxt}>{host.coinsPerMinute} Coin</Text>
            </View>
          </View>

          {/* Bio */}
          <Text style={s.bioTxt}>{host.bio}</Text>

          {/* Language */}
          <View style={s.langRow}>
            <Image source={require("@/assets/icons/ic_language.png")} style={s.langIco} resizeMode="contain" />
            <Text style={s.langLabel}>Language : </Text>
            <Text style={s.langVal} numberOfLines={2}>{host.languages.join(", ")}</Text>
          </View>

          {/* Topics */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.topicsContent}
            style={s.topicsScroll}
          >
            {host.specialties.map((sp) => (
              <View key={sp} style={s.topicTag}>
                <Text style={s.topicTxt}>{sp}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ══════ StatusView — 3 stat boxes ══════ */}
        <View style={s.statsRow}>
          {statsList.map((item, i) => (
            <View key={i} style={s.statBox}>
              <Image source={item.image} style={s.statIco} resizeMode="contain" />
              <Text style={s.statLbl}>{item.title}</Text>
              <Text style={s.statVal}>{item.count}</Text>
            </View>
          ))}
        </View>

        {/* ══════ ReviewShow ══════ */}
        <View style={s.reviewSec}>
          <View style={s.reviewHeader}>
            <Text style={s.reviewHeaderTxt}>Reviews</Text>
            <TouchableOpacity onPress={() => router.push({ pathname: "/hosts/reviews", params: { hostId: host.id } })}>
              <Text style={s.viewAllTxt}>View All</Text>
            </TouchableOpacity>
          </View>

          {reviews.map((r, i) => (
            <View key={i} style={s.reviewCard}>
              <View style={s.reviewTop}>
                {/* Reviewer avatar */}
                <View style={s.reviewDot}>
                  <View style={s.reviewAvatarCircle}>
                    <Image
                      source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.seed}` }}
                      style={s.reviewAvatarImg}
                    />
                  </View>
                </View>
                <View style={s.reviewInfo}>
                  <Text style={s.reviewName}>{r.name}</Text>
                  <StarRating rating={r.rating} size={16} />
                </View>
                <View style={s.timeBadge}>
                  <Text style={s.timeTxt}>{r.time}</Text>
                </View>
              </View>
              <Text style={s.reviewTxt}>{r.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ══════ ProfileBottomButtonView ══════ */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity onPress={handleChat} style={[s.bottomBtn, { backgroundColor: GREEN }]} activeOpacity={0.85}>
          <Text style={s.bottomBtnTxt}>Chat Now</Text>
        </TouchableOpacity>

        {host.isOnline && (
          <TouchableOpacity onPress={() => setTalkSheet(true)} style={[s.bottomBtn, { backgroundColor: APP_COLOR }]} activeOpacity={0.85}>
            <Image source={require("@/assets/icons/ic_call_gradient.png")} style={s.talkIco} tintColor="#fff" resizeMode="contain" />
            <Text style={s.bottomBtnTxt}>Talk Now</Text>
          </TouchableOpacity>
        )}
      </View>

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
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },

  /* ── Hero / cover ── */
  hero: {
    width: SW,
    minHeight: SH * 0.36,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  backIco: { width: 18, height: 18 },
  heroCenterCol: { alignItems: "center", gap: 8 },
  heroDotBorder: {
    width: 106,
    height: 106,
    borderRadius: 53,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatar: { width: 96, height: 96, borderRadius: 48 },
  heroName: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#fff", marginTop: 4 },
  heroRatingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroRatingTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.8)" },

  /* ── Info card ── */
  infoCard: {
    backgroundColor: INFO_BG,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  infoTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 },
  infoDotBorder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: "#111329",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  infoAvatarCircle: { width: 48, height: 48, borderRadius: 24, overflow: "hidden", backgroundColor: "#eee" },
  infoAvatarImg: { width: "100%", height: "100%" },
  infoMid: { flex: 1 },
  infoName: { fontSize: 16, fontFamily: "Poppins_700Bold", color: "#111329", marginBottom: 5 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },

  /* status badge */
  statusPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 4, borderRadius: 20, gap: 4 },
  dotOuter: { width: 11, height: 11, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  dotInner: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 10, fontFamily: "Poppins_500Medium" },

  /* ID chip */
  idChip: { flexDirection: "row", alignItems: "center", backgroundColor: ID_BG, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 60, gap: 3 },
  idTxt: { fontSize: 10, fontFamily: "Poppins_600SemiBold", color: ID_TXT },
  copyIco: { width: 11, height: 11 },

  /* coin chip */
  coinChip: { flexDirection: "row", alignItems: "center", backgroundColor: LIGHT_YELLOW, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 30, gap: 4, flexShrink: 0 },
  coinChipIco: { width: 18, height: 18 },
  coinChipTxt: { fontSize: 12, fontFamily: "Poppins_700Bold", color: ORANGE },

  /* bio */
  bioTxt: { fontSize: 12, fontFamily: "Poppins_500Medium", color: PROFILE_TEXT, lineHeight: 22, paddingVertical: 8 },

  /* language */
  langRow: { flexDirection: "row", alignItems: "flex-start", paddingTop: 4, paddingBottom: 0 },
  langIco: { width: 20, height: 20, marginTop: 1 },
  langLabel: { fontSize: 14, fontFamily: "Poppins_500Medium", color: PROFILE_LANG, marginLeft: 8 },
  langVal: { flex: 1, fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#111329" },

  /* topics */
  topicsScroll: { marginTop: 16, marginBottom: 12, maxHeight: 36 },
  topicsContent: { gap: 6, paddingRight: 12 },
  topicTag: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: CARD_BG, borderRadius: 30 },
  topicTxt: { fontSize: 12, fontFamily: "Poppins_500Medium", color: PROFILE_LANG },

  /* ── Stats ── */
  statsRow: { flexDirection: "row", paddingHorizontal: 8, paddingTop: 12, paddingBottom: 12, gap: 0 },
  statBox: {
    flex: 1,
    marginHorizontal: 6,
    paddingHorizontal: 6,
    paddingVertical: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    alignItems: "center",
    gap: 4,
  },
  statIco: { width: 34, height: 34, marginBottom: 6 },
  statLbl: { fontSize: 11, fontFamily: "Poppins_500Medium", color: PROFILE_LANG, textAlign: "center" },
  statVal: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329" },

  /* ── Reviews ── */
  reviewSec: { paddingHorizontal: 16, paddingBottom: 12 },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 18, paddingBottom: 14 },
  reviewHeaderTxt: { fontSize: 18, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  viewAllTxt: { fontSize: 13, fontFamily: "Poppins_500Medium", color: PROFILE_LANG, textDecorationLine: "underline" },
  reviewCard: {
    backgroundColor: REVIEW_BG,
    borderWidth: 1,
    borderColor: REVIEW_BORDER,
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
  },
  reviewTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  reviewDot: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: "#111329",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    flexShrink: 0,
  },
  reviewAvatarCircle: { width: 44, height: 44, borderRadius: 22, overflow: "hidden", backgroundColor: "#eee" },
  reviewAvatarImg: { width: "100%", height: "100%" },
  reviewInfo: { flex: 1, gap: 3 },
  reviewName: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  timeBadge: { backgroundColor: "#E7EBF7", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 34, marginLeft: 8 },
  timeTxt: { fontSize: 10, fontFamily: "Poppins_600SemiBold", color: PROFILE_LANG },
  reviewTxt: { fontSize: 12, fontFamily: "Poppins_500Medium", color: PROFILE_LANG, lineHeight: 20 },

  /* ── Bottom bar ── */
  bottomBar: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 10,
  },
  bottomBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  bottomBtnTxt: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  talkIco: { width: 22, height: 22 },
});

/* ─── Talk Now sheet styles ─── */
const sht = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  box: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E0E0E0", alignSelf: "center", marginTop: 12, marginBottom: 16 },
  title: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329", textAlign: "center", paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 18, gap: 12 },
  ico: { width: 32, height: 32 },
  label: { flex: 1, fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#eee", marginHorizontal: 20 },
  chip: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF8E7", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16, gap: 4 },
  chipIco: { width: 16, height: 16 },
  chipTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: ORANGE },
});
