import React, { useState, useEffect } from "react";
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
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { useChat } from "@/context/ChatContext";
import { API } from "@/services/api";

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
  host: any;
  onClose: () => void;
  onAudio: () => void;
  onVideo: () => void;
}) {
  const audioRate = host?.audio_coins_per_minute ?? host?.coinsPerMinute ?? 5;
  const videoRate = host?.video_coins_per_minute ?? (audioRate + 5);
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
              <Text style={sht.chipTxt}>{audioRate} Coin/min</Text>
            </View>
          </TouchableOpacity>

          <View style={sht.divider} />

          <TouchableOpacity onPress={onVideo} style={sht.row} activeOpacity={0.8}>
            <Image source={require("@/assets/icons/ic_video_gradient.png")} style={sht.ico} resizeMode="contain" />
            <Text style={sht.label}>Video Call</Text>
            <View style={sht.chip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={sht.chipIco} resizeMode="contain" />
              <Text style={sht.chipTxt}>{videoRate} Coin/min</Text>
            </View>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Level config ─── */
const LEVEL_CONFIG: Record<number, { name: string; badge: string; color: string }> = {
  1: { name: "Newcomer", badge: "🌱", color: "#6B7280" },
  2: { name: "Rising",   badge: "⭐", color: "#F59E0B" },
  3: { name: "Expert",   badge: "🔥", color: "#EF4444" },
  4: { name: "Pro",      badge: "💎", color: "#8B5CF6" },
  5: { name: "Elite",    badge: "👑", color: "#D97706" },
};

/* ═══════════════════ MAIN SCREEN ═══════════════════ */
export default function HostDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const { getOrCreateConversation } = useChat();
  const [talkSheet, setTalkSheet] = useState(false);
  const [host, setHost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [chatUnlocked, setChatUnlocked] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      API.getHost(id),
      API.getHostReviews(id),
      API.getChatStatus(id).catch(() => ({ unlocked: false })),
    ]).then(([h, revs, chatStatus]) => {
      setHost(h);
      setReviews(revs ?? []);
      setChatUnlocked((chatStatus as any)?.unlocked ?? false);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color={APP_COLOR} />
      </View>
    );
  }

  if (!host) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <Text style={{ color: APP_COLOR, fontFamily: "Poppins_500Medium" }}>Host not found</Text>
      </View>
    );
  }

  /* ─── Derived fields ─── */
  const hostName = host.display_name || host.name || "Host";
  const hostAvatar = host.avatar_url
    ? host.avatar_url
    : `https://api.dicebear.com/7.x/avataaars/svg?seed=${host.id}`;
  const uniqueId = `VX${String(host.id).slice(-6).padStart(6, "0")}`;
  const callCount = host.total_minutes ? Math.floor(host.total_minutes / 30) : host.review_count * 2;
  const experience = `${Math.max(1, Math.floor((host.total_minutes ?? 0) / 5000))}+`;
  const audioRate: number = host.audio_coins_per_minute ?? host.coins_per_minute ?? 5;
  const videoRate: number = host.video_coins_per_minute ?? audioRate + 5;
  const level: number = host.level ?? 1;
  const levelInfo = LEVEL_CONFIG[level] ?? LEVEL_CONFIG[1];

  /* ─── Handlers ─── */
  const checkCoins = (rate: number) => {
    if ((user?.coins ?? 0) < rate * 2) {
      Alert.alert(
        "Insufficient Coins",
        `You need at least ${rate * 2} coins to start a call.`,
        [
          { text: "Buy Coins", onPress: () => router.push("/user/screens/user/wallet") },
          { text: "Cancel", style: "cancel" },
        ]
      );
      return false;
    }
    return true;
  };

  const handleAudio = () => {
    setTalkSheet(false);
    if (!checkCoins(audioRate)) return;
    const topics = Array.isArray(host.topics) ? host.topics : (host.topics ? String(host.topics).split(",") : []);
    initiateCall({ id: host.id, name: hostName, avatar: hostAvatar, role: "host" }, "audio", audioRate);
    router.push({ pathname: "/shared/call/outgoing", params: { hostId: host.id, callType: "audio", hostName, hostAvatar, specialty: topics[0] ?? "" } });
  };

  const handleVideo = () => {
    setTalkSheet(false);
    if (!checkCoins(videoRate)) return;
    const topics = Array.isArray(host.topics) ? host.topics : (host.topics ? String(host.topics).split(",") : []);
    initiateCall({ id: host.id, name: hostName, avatar: hostAvatar, role: "host" }, "video", videoRate);
    router.push({ pathname: "/shared/call/outgoing", params: { hostId: host.id, callType: "video", hostName, hostAvatar, specialty: topics[0] ?? "" } });
  };

  const handleChat = async () => {
    if (!chatUnlocked) {
      Alert.alert(
        "🔒 Chat Locked",
        `Chat ke liye pehle ${hostName} se call karo. Call ke baad chat automatically unlock ho jaayegi!`,
        [
          {
            text: "Call Karo",
            onPress: () => {
              if (host.is_online) setTalkSheet(true);
              else Alert.alert("Offline", `${hostName} abhi online nahi hai.`);
            },
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
      return;
    }
    try {
      const room = await API.createChatRoom(host.id);
      getOrCreateConversation(host.id, hostName, hostAvatar);
      router.push(`/shared/chat/${room.id}`);
    } catch (e: any) {
      if (e.message?.includes("CHAT_LOCKED") || e.message?.includes("locked")) {
        Alert.alert("🔒 Chat Locked", "Pehle call karo, phir chat unlock hogi!");
      } else {
        console.log("chat error:", e);
        getOrCreateConversation(host.id, hostName, hostAvatar);
        router.push(`/shared/chat/${host.id}`);
      }
    }
  };

  const copyId = () => {
    try { require("react-native").Clipboard?.setString(uniqueId); } catch (_) {}
  };

  const statsList = [
    { image: require("@/assets/icons/ic_call_gradient.png"), title: "Total Call", count: String(callCount) },
    { image: require("@/assets/icons/ic_star.png"), title: "Rating", count: (host.rating ?? 0).toFixed(1) },
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
              <Image source={{ uri: hostAvatar }} style={s.heroAvatar} resizeMode="cover" />
            </View>
            {/* Level badge */}
            <View style={[s.levelBadge, { backgroundColor: levelInfo.color + "33", borderColor: levelInfo.color }]}>
              <Text style={s.levelBadgeEmoji}>{levelInfo.badge}</Text>
              <Text style={[s.levelBadgeTxt, { color: levelInfo.color }]}>Lv.{level} {levelInfo.name}</Text>
            </View>
            <Text style={s.heroName}>{hostName}</Text>
            <View style={s.heroRatingRow}>
              <Image source={require("@/assets/icons/ic_star.png")} style={{ width: 16, height: 16 }} tintColor={STAR_COLOR} resizeMode="contain" />
              <Text style={s.heroRatingTxt}>{(host.rating ?? 0).toFixed(1)} ({host.review_count ?? 0} reviews)</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ══════ UserProfileInfoView ══════ */}
        <View style={s.infoCard}>
          <View style={s.infoTopRow}>
            {/* Avatar dotted (small, 50x50) */}
            <View style={s.infoDotBorder}>
              <View style={s.infoAvatarCircle}>
                <Image source={{ uri: hostAvatar }} style={s.infoAvatarImg} resizeMode="cover" />
              </View>
            </View>

            {/* Name + status + ID */}
            <View style={s.infoMid}>
              <Text style={s.infoName} numberOfLines={1}>{hostName}</Text>
              <View style={s.statusRow}>
                {/* Status pill */}
                <View style={[s.statusPill, { backgroundColor: host.is_online ? GREEN : "#EDEDEF" }]}>
                  <View style={[s.dotOuter, { backgroundColor: host.is_online ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.08)" }]}>
                    <View style={[s.dotInner, { backgroundColor: host.is_online ? "#fff" : PROFILE_LANG }]} />
                  </View>
                  <Text style={[s.statusTxt, { color: host.is_online ? "#fff" : PROFILE_LANG }]}>
                    {host.is_online ? "Online" : "Offline"}
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
              <Text style={s.coinChipTxt}>{audioRate} Coin</Text>
            </View>
          </View>

          {/* Bio */}
          <Text style={s.bioTxt}>{host.bio}</Text>

          {/* Language */}
          <View style={s.langRow}>
            <Image source={require("@/assets/icons/ic_language.png")} style={s.langIco} resizeMode="contain" />
            <Text style={s.langLabel}>Language : </Text>
            <Text style={s.langVal} numberOfLines={2}>{(host.languages ?? []).join(", ")}</Text>
          </View>

          {/* Topics */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.topicsContent}
            style={s.topicsScroll}
          >
            {(host.specialties ?? []).map((sp: string) => (
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
          </View>

          {reviews.length === 0 && (
            <Text style={{ color: PROFILE_LANG, fontFamily: "Poppins_400Regular", fontSize: 13, textAlign: "center", paddingVertical: 16 }}>
              No reviews yet
            </Text>
          )}

          {reviews.slice(0, 5).map((r: any, i: number) => (
            <View key={r.id ?? i} style={s.reviewCard}>
              <View style={s.reviewTop}>
                <View style={s.reviewDot}>
                  <View style={s.reviewAvatarCircle}>
                    <Image
                      source={{ uri: r.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.user_id ?? i}` }}
                      style={s.reviewAvatarImg}
                    />
                  </View>
                </View>
                <View style={s.reviewInfo}>
                  <Text style={s.reviewName}>{r.name ?? "User"}</Text>
                  <StarRating rating={r.stars ?? r.rating ?? 5} size={16} />
                </View>
                <View style={s.timeBadge}>
                  <Text style={s.timeTxt}>{r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : "Recent"}</Text>
                </View>
              </View>
              {r.comment ? <Text style={s.reviewTxt}>{r.comment}</Text> : null}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ══════ ProfileBottomButtonView ══════ */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity onPress={handleChat} style={[s.bottomBtn, { backgroundColor: chatUnlocked ? GREEN : "#9CA3AF" }]} activeOpacity={0.85}>
          <Text style={s.bottomBtnTxt}>{chatUnlocked ? "Chat Now" : "🔒 Chat"}</Text>
        </TouchableOpacity>

        {host.is_online ? (
          <TouchableOpacity onPress={() => setTalkSheet(true)} style={[s.bottomBtn, { backgroundColor: APP_COLOR }]} activeOpacity={0.85}>
            <Image source={require("@/assets/icons/ic_call_gradient.png")} style={s.talkIco} tintColor="#fff" resizeMode="contain" />
            <Text style={s.bottomBtnTxt}>Talk Now</Text>
          </TouchableOpacity>
        ) : (
          <View style={[s.bottomBtn, { backgroundColor: "#D1D5DB" }]}>
            <Text style={[s.bottomBtnTxt, { color: "#6B7280" }]}>Offline</Text>
          </View>
        )}
      </View>

      <TalkNowSheet
        visible={talkSheet}
        host={{ ...host, coinsPerMinute: audioRate }}
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
  levelBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, marginTop: 6 },
  levelBadgeEmoji: { fontSize: 14 },
  levelBadgeTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },

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
