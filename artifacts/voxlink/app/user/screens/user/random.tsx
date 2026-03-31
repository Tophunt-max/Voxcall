import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Animated, Dimensions, Modal, ScrollView, ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { API } from "@/services/api";

const { width: SW, height: SH } = Dimensions.get("window");
const BG        = "#FBF1EA";
const RIPPLE_C  = "#EDDDD2";
const CARD_BG   = "#EFE9F8";
const AV_BORDER = "#EFE9F8";
const COIN_BORDER = "#E49F14";
const COIN_BG   = "#FFFDF1";
const GRAD: [string, string] = ["#CF00FD", "#8400FF"];
const AVATAR_SIZE = SH * 0.065;
const CIRCLE_IMG_SIZE = 270;

type CallType = "audio" | "video";
type Phase = "idle" | "searching" | "found" | "no_hosts";

interface HostCard {
  id: string;
  name: string;
  avatar_url?: string;
  rating: number;
  coins_per_minute: number;
  specialties: string[];
}

/* ─── Ripple rings (background) ─── */
function RippleRings() {
  const rings = Array.from({ length: 5 }, () => useRef(new Animated.Value(0)).current);
  useEffect(() => {
    const makeRing = (v: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 3000, useNativeDriver: false }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]));
    const anim = Animated.parallel(rings.map((v, i) => makeRing(v, i * 600)));
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={[styles.rippleContainer, { pointerEvents: "none" } as any]}>
      {rings.map((v, i) => (
        <Animated.View key={i} style={[styles.rippleRing, {
          opacity: v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 0.5, 0.5, 0] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.5] }) }],
        }]} />
      ))}
    </View>
  );
}

/* ─── Floating host card ─── */
interface ListenerCardProps {
  host: HostCard;
  isLeft: boolean;
  isSpecial: boolean;
  delay: number;
  onCycled: () => void;
  onPress: () => void;
}
function ListenerCard({ host, isLeft, isSpecial, delay, onCycled, onPress }: ListenerCardProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.98)).current;

  useEffect(() => {
    const cycle = () => {
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: false }),
          Animated.timing(scale,   { toValue: 1, duration: 600, useNativeDriver: false }),
        ]),
        Animated.delay(3500),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 700, useNativeDriver: false }),
          Animated.timing(scale,   { toValue: 0.98, duration: 600, useNativeDriver: false }),
        ]),
      ]).start(({ finished }) => { if (finished) { onCycled(); cycle(); } });
    };
    cycle();
  }, [host.id]);

  const avatarSide  = isSpecial ? { left: -31 } : { right: -31 };
  const pillRadius  = isSpecial
    ? { borderBottomRightRadius: 42, borderTopRightRadius: 42 }
    : { borderBottomLeftRadius: 42, borderTopLeftRadius: 42 };
  const pillPad     = isSpecial
    ? { paddingLeft: 32, paddingRight: 14, paddingVertical: 8 }
    : { paddingLeft: 20, paddingRight: 32, paddingVertical: 8 };

  const avatarUri = host.avatar_url && host.avatar_url.startsWith("http")
    ? host.avatar_url
    : `https://api.dicebear.com/7.x/avataaars/svg?seed=${host.id}`;

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={[styles.cardAligner, isLeft ? { alignSelf: "flex-start" } : { alignSelf: "flex-end" }]}
      >
        <View style={[styles.cardPill, pillRadius, pillPad]}>
          <Text style={styles.cardName} numberOfLines={1}>{host.name}</Text>
          <LinearGradient colors={GRAD} style={styles.topicTag} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            <Text style={styles.topicText} numberOfLines={1}>{host.specialties[0] ?? "Listener"}</Text>
          </LinearGradient>
        </View>
        <View style={[styles.cardAvatar, avatarSide]}>
          <Image source={{ uri: avatarUri }} style={styles.cardAvatarImg} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ─── Call type dialog ─── */
function CallTypeDialog({ visible, selected, onSelect, onClose }: {
  visible: boolean; selected: CallType;
  onSelect: (t: CallType) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.dialogOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.dialogBox}>
          <Text style={styles.dialogTitle}>Call Type Chunein</Text>
          {(["audio", "video"] as CallType[]).map((type) => (
            <TouchableOpacity key={type} onPress={() => { onSelect(type); onClose(); }} style={styles.dialogRow}>
              <Image
                source={type === "audio" ? require("@/assets/icons/ic_call_gradient.png") : require("@/assets/icons/ic_chat_video.png")}
                style={styles.dialogIcon}
                resizeMode="contain"
              />
              <Text style={styles.dialogLabel}>{type === "audio" ? "Voice Call" : "Video Call"}</Text>
              <View style={[styles.dialogRadio, selected === type && styles.dialogRadioActive]}>
                {selected === type && <View style={styles.dialogRadioDot} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Match found ripple ─── */
function MatchRipple() {
  const rings = Array.from({ length: 3 }, () => useRef(new Animated.Value(0)).current);
  useEffect(() => {
    const anim = Animated.parallel(rings.map((v, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 400),
      Animated.timing(v, { toValue: 1, duration: 3000, useNativeDriver: false }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: false }),
    ]))));
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={[styles.matchRippleWrap, { pointerEvents: "none" } as any]}>
      {rings.map((v, i) => (
        <Animated.View key={i} style={[styles.matchRippleRing, {
          opacity: v.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.4, 0.4, 0] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.8] }) }],
        }]} />
      ))}
    </View>
  );
}

/* ─── Match found screen overlay ─── */
function MatchFoundScreen({ host, callType, adminCoinRate, onAccept, onDecline }: {
  host: HostCard; callType: CallType; adminCoinRate: number; onAccept: () => void; onDecline: () => void;
}) {
  const scale = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, tension: 55, friction: 8, useNativeDriver: false }).start();
  }, []);

  const avatarUri = host.avatar_url && host.avatar_url.startsWith("http")
    ? host.avatar_url
    : `https://api.dicebear.com/7.x/avataaars/svg?seed=${host.id}`;

  const coinsPerMin = adminCoinRate;

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <Image source={require("@/assets/images/match_bg.png")} style={styles.matchBg} resizeMode="cover" />
      <View style={styles.matchOverlay}>
        <TouchableOpacity onPress={onDecline} style={styles.matchClose}>
          <Image source={require("@/assets/icons/ic_close.png")} style={styles.matchCloseIco} tintColor="#111329" resizeMode="contain" />
        </TouchableOpacity>

        <Animated.View style={[styles.matchContent, { transform: [{ scale }] }]}>
          <Text style={styles.matchTitle}>It's a Match! 🎉</Text>

          <View style={styles.matchAvatarWrap}>
            <MatchRipple />
            <View style={styles.matchAvatarCircle}>
              <Image source={{ uri: avatarUri }} style={styles.matchAvatarImg} />
            </View>
          </View>

          <Text style={styles.matchName}>{host.name}</Text>

          <View style={styles.matchRatingRow}>
            <Text style={styles.matchStar}>⭐</Text>
            <Text style={styles.matchRating}>{(host.rating ?? 0).toFixed(1)}</Text>
            <Text style={styles.matchCoins}>  •  🪙 {coinsPerMin}/min</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.matchTopicsRow}>
            {(host.specialties ?? []).map((t, i) => (
              <LinearGradient key={i} colors={GRAD} style={styles.matchTopicTag} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={styles.matchTopicTxt}>{t}</Text>
              </LinearGradient>
            ))}
          </ScrollView>

          <Text style={styles.matchCallType}>
            {callType === "video" ? "🎥 Video Call" : "🎤 Voice Call"}
          </Text>

          <View style={styles.matchBtns}>
            <View style={styles.matchBtnItem}>
              <TouchableOpacity onPress={onDecline} style={styles.matchDecline} activeOpacity={0.8}>
                <Image source={require("@/assets/icons/ic_call_end.png")} style={styles.matchBtnIco} tintColor="#fff" resizeMode="contain" />
              </TouchableOpacity>
              <Text style={styles.matchBtnLabel}>Decline</Text>
            </View>
            <View style={styles.matchBtnItem}>
              <TouchableOpacity onPress={onAccept} activeOpacity={0.8}>
                <LinearGradient colors={GRAD} style={styles.matchAccept} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Image source={require("@/assets/icons/ic_call_gradient.png")} style={styles.matchBtnIco} tintColor="#fff" resizeMode="contain" />
                </LinearGradient>
              </TouchableOpacity>
              <Text style={styles.matchBtnLabel}>Accept</Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

/* ─── Main Screen ─── */
export default function RandomScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { initiateCall } = useCall();

  const [phase, setPhase]         = useState<Phase>("idle");
  const [callType, setCallType]   = useState<CallType>("audio");
  const [dialogVisible, setDialog] = useState(false);
  const [matchedHost, setMatchedHost] = useState<HostCard | null>(null);
  const [adminCoinRate, setAdminCoinRate] = useState<number>(5);
  const [noHostMsg, setNoHostMsg]  = useState("");

  // Floating card hosts (real API)
  const [cardHosts, setCardHosts] = useState<HostCard[]>([]);
  const currentHosts = useRef<HostCard[]>([]);
  const [cardKeys, setCardKeys]   = useState([0, 1, 2, 3]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMounted = useRef(true);
  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);

  // Load online hosts for floating cards
  useEffect(() => {
    const load = async () => {
      try {
        const hosts = await API.matchOnlineHosts();
        if (!isMounted.current) return;
        if (hosts.length >= 4) {
          const shuffled = [...hosts].sort(() => Math.random() - 0.5);
          setCardHosts(shuffled);
          currentHosts.current = shuffled.slice(0, 4);
        }
      } catch {
        // fallback: show empty cards (no MOCK_HOSTS)
      }
    };
    load();
  }, []);

  const handleReplace = useCallback((index: number) => {
    const used = new Set(currentHosts.current.map((h) => h.id));
    const available = cardHosts.filter((h) => !used.has(h.id));
    if (available.length > 0) {
      currentHosts.current[index] = available[Math.floor(Math.random() * available.length)];
      setCardKeys((prev) => { const next = [...prev]; next[index] = prev[index] + 4; return next; });
    }
  }, [cardHosts]);

  // Start polling for match
  const startSearching = useCallback(() => {
    setPhase("searching");
    setMatchedHost(null);

    const poll = async () => {
      try {
        const res = await API.matchFind(callType);
        if (!isMounted.current) return;
        if (res.matched && res.host) {
          setMatchedHost(res.host);
          setAdminCoinRate(res.coins_per_minute ?? 5);
          setPhase("found");
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        } else {
          // No hosts yet — keep polling
          setNoHostMsg(res.message ?? "Koi host nahi mila, dhundh rahe hain...");
        }
      } catch {
        if (isMounted.current) setNoHostMsg("Network error, retry ho rahi hai...");
      }
    };

    poll(); // immediate first call
    pollRef.current = setInterval(poll, 2500);
  }, [callType]);

  const stopSearching = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPhase("idle");
    setMatchedHost(null);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Accept match → proper call flow using admin-set coin rate
  const handleAccept = useCallback(() => {
    if (!matchedHost) return;
    setPhase("idle");

    const avatarUri = matchedHost.avatar_url && matchedHost.avatar_url.startsWith("http")
      ? matchedHost.avatar_url
      : `https://api.dicebear.com/7.x/avataaars/svg?seed=${matchedHost.id}`;

    // adminCoinRate is set by admin in Settings → Random Call Rates
    initiateCall(
      { id: matchedHost.id, name: matchedHost.name, avatar: avatarUri, role: "host" },
      callType,
      adminCoinRate
    );
    router.push({
      pathname: "/shared/call/outgoing",
      params: {
        hostId: matchedHost.id,
        callType,
        hostName: matchedHost.name,
        hostAvatar: avatarUri,
        specialty: matchedHost.specialties[0] ?? "",
      },
    });
  }, [matchedHost, callType, initiateCall, adminCoinRate]);

  const handleDecline = useCallback(() => {
    setPhase("idle");
    setMatchedHost(null);
  }, []);

  const dotTop    = SH * 0.2;
  const cardTop   = SH * 0.18;
  const cardBottom = SH * 0.17;
  const hasCards  = currentHosts.current.length >= 4;

  return (
    <View style={styles.root}>
      {/* Backgrounds */}
      <View style={[styles.bg, { backgroundColor: BG }]} />
      <View style={[styles.ripplePositioner, { top: dotTop }]}>
        <RippleRings />
      </View>
      <Image source={require("@/assets/images/dot_bg.png")} style={[styles.dotBg, { top: dotTop } as any]} resizeMode="cover" />
      <View style={[styles.circleImgWrap, { top: dotTop }]}>
        <Image source={require("@/assets/images/match_bg.png")} style={styles.circleImg} resizeMode="cover" />
      </View>
      <Image source={require("@/assets/images/match_bottom_bg.png")} style={[styles.bottomBgImg, { pointerEvents: "none" } as any]} resizeMode="cover" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.avatarDotBorder}>
          <View style={styles.avatarCircle}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.userAvatarImg} />
            ) : (
              <Image source={require("@/assets/images/avatar_placeholder.png")} style={styles.userAvatarImg} />
            )}
          </View>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>{user?.name ?? "Guest"}</Text>
          <Text style={styles.headerEmail} numberOfLines={1}>{user?.email ?? "guest@voxlink.com"}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push("/user/payment/checkout")} style={styles.coinWidget} activeOpacity={0.85}>
          <View style={styles.coinInfo}>
            <Text style={styles.coinAmount}>{user?.coins ?? 0}</Text>
            <Text style={styles.coinLabel}>My Balance</Text>
          </View>
          <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
        </TouchableOpacity>
      </View>

      {/* Floating Host Cards */}
      {hasCards && (
        <View style={[styles.cardsZone, { top: cardTop, bottom: cardBottom + 90, pointerEvents: "box-none" } as any]}>
          {currentHosts.current.slice(0, 4).map((host, index) => (
            <ListenerCard
              key={`${cardKeys[index]}-${index}`}
              host={host}
              isLeft={index % 2 === 0}
              isSpecial={index === 3}
              delay={index * 400}
              onCycled={() => handleReplace(index)}
              onPress={() => router.push(`/user/hosts/${host.id}`)}
            />
          ))}
        </View>
      )}

      {/* Searching status */}
      {phase === "searching" && (
        <View style={styles.searchingBadge}>
          <ActivityIndicator size="small" color={GRAD[1]} />
          <Text style={styles.searchingText}>{noHostMsg || "Match dhundh rahe hain..."}</Text>
        </View>
      )}

      {/* Bottom Buttons */}
      <View style={[styles.bottomBtns, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          onPress={() => setDialog(true)}
          style={styles.callTypeBtn}
          activeOpacity={0.85}
          disabled={phase === "searching"}
        >
          <Image
            source={callType === "audio" ? require("@/assets/icons/ic_call_gradient.png") : require("@/assets/icons/ic_chat_video.png")}
            style={styles.callTypeBtnIcon}
            resizeMode="contain"
          />
          <Text style={styles.callTypeBtnTxt}>{callType === "audio" ? "Voice Call" : "Video Call"}</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.dropArrow} tintColor="#111329" resizeMode="contain" />
        </TouchableOpacity>

        {phase === "searching" ? (
          <TouchableOpacity onPress={stopSearching} activeOpacity={0.85} style={styles.randomBtnWrap}>
            <View style={[styles.randomBtn, { backgroundColor: "#FF3B30", justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 8 }]}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.randomBtnTxt}>Cancel</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={startSearching} activeOpacity={0.85} style={styles.randomBtnWrap}>
            <LinearGradient colors={GRAD} style={styles.randomBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Text style={styles.randomBtnTxt}>🎲 Random Match</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      <CallTypeDialog
        visible={dialogVisible}
        selected={callType}
        onSelect={setCallType}
        onClose={() => setDialog(false)}
      />

      {phase === "found" && matchedHost && (
        <MatchFoundScreen
          host={matchedHost}
          callType={callType}
          adminCoinRate={adminCoinRate}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  bg: { ...StyleSheet.absoluteFillObject },
  ripplePositioner: { position: "absolute", right: -170, width: 370, height: 370, alignItems: "center", justifyContent: "center" },
  rippleRing: { position: "absolute", width: 370, height: 370, borderRadius: 185, backgroundColor: RIPPLE_C },
  dotBg: { position: "absolute", left: 0, right: 0, width: SW, height: 300 },
  circleImgWrap: { position: "absolute", right: -140, width: CIRCLE_IMG_SIZE, height: CIRCLE_IMG_SIZE, borderRadius: CIRCLE_IMG_SIZE / 2, overflow: "hidden", opacity: 0.55 },
  circleImg: { width: "100%", height: "100%" },
  bottomBgImg: { position: "absolute", bottom: -SH * 0.1, left: 0, right: 0, width: SW, height: 300 },
  // Header
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingBottom: 12, gap: 10 },
  avatarDotBorder: { width: AVATAR_SIZE + 8, height: AVATAR_SIZE + 8, borderRadius: (AVATAR_SIZE + 8) / 2, borderWidth: 1.5, borderColor: "#111329", borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  avatarCircle: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: "#E5E5E5", overflow: "hidden" },
  userAvatarImg: { width: "100%", height: "100%" },
  headerText: { flex: 1 },
  headerName: { fontSize: 16, fontFamily: "Poppins_700Bold", color: "#111329" },
  headerEmail: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  coinWidget: { flexDirection: "row", alignItems: "center", backgroundColor: COIN_BG, borderRadius: 12, borderWidth: 1, borderColor: COIN_BORDER, paddingLeft: 10 },
  coinInfo: { alignItems: "flex-end" },
  coinAmount: { fontSize: 18, fontFamily: "Poppins_700Bold", color: COIN_BORDER },
  coinLabel: { fontSize: 11, fontFamily: "Poppins_600SemiBold", color: COIN_BORDER },
  coinIcon: { width: 32, height: 32, margin: 8 },
  // Cards
  cardsZone: { position: "absolute", left: 0, right: 0, justifyContent: "space-evenly", paddingHorizontal: 14, gap: 12 },
  cardAligner: { maxWidth: SW * 0.7 },
  cardPill: { backgroundColor: CARD_BG, borderWidth: 2, borderColor: "#fff" },
  cardName: { fontSize: 12, fontFamily: "Poppins_700Bold", color: "#111329", marginBottom: 3 },
  topicTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 46, alignSelf: "flex-start" },
  topicText: { fontSize: 10, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  cardAvatar: { position: "absolute", top: "50%", marginTop: -31, width: 62, height: 62, borderRadius: 31, borderWidth: 4, borderColor: AV_BORDER, overflow: "hidden", backgroundColor: "#E5E5E5" },
  cardAvatarImg: { width: "100%", height: "100%" },
  // Searching badge
  searchingBadge: { position: "absolute", top: SH * 0.42, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.92)", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 30, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  searchingText: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#111329" },
  // Bottom
  bottomBtns: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", gap: 0 },
  callTypeBtn: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 30, paddingVertical: 10, paddingHorizontal: 20, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.1, shadowRadius: 18, elevation: 6 },
  callTypeBtnIcon: { width: 20, height: 20 },
  callTypeBtnTxt: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  dropArrow: { width: 14, height: 14, transform: [{ rotate: "-90deg" }] },
  randomBtnWrap: { width: SW - 48, marginTop: 16 },
  randomBtn: { paddingVertical: 14, borderRadius: 30 },
  randomBtnTxt: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#fff", textAlign: "center" },
  // Dialog
  dialogOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  dialogBox: { width: SW - 64, backgroundColor: "#fff", borderRadius: 26, overflow: "hidden" },
  dialogTitle: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329", textAlign: "center", paddingVertical: 13, backgroundColor: "rgba(0,0,0,0.02)" },
  dialogRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 18, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#eee" },
  dialogIcon: { width: 32, height: 32 },
  dialogLabel: { flex: 1, fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  dialogRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: "#ccc", alignItems: "center", justifyContent: "center" },
  dialogRadioActive: { borderColor: "#8400FF", backgroundColor: "#8400FF" },
  dialogRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  // Match found
  matchBg: { ...StyleSheet.absoluteFillObject, width: SW, height: SH },
  matchOverlay: { flex: 1, alignItems: "center", paddingTop: SH * 0.08 },
  matchClose: { alignSelf: "flex-end", marginRight: 33, marginBottom: 36 },
  matchCloseIco: { width: 26, height: 26 },
  matchContent: { alignItems: "center", gap: 8 },
  matchTitle: { fontSize: 36, fontFamily: "Poppins_700Bold", color: "#111329", marginBottom: 16 },
  matchAvatarWrap: { width: 170, height: 170, alignItems: "center", justifyContent: "center" },
  matchRippleWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  matchRippleRing: { position: "absolute", width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(160,14,231,0.15)" },
  matchAvatarCircle: { width: 120, height: 120, borderRadius: 60, overflow: "hidden", borderWidth: 4, borderColor: "#fff" },
  matchAvatarImg: { width: "100%", height: "100%", backgroundColor: "#E5E5E5" },
  matchName: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#111329", marginTop: 4 },
  matchRatingRow: { flexDirection: "row", alignItems: "center" },
  matchStar: { fontSize: 14 },
  matchRating: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#111329" },
  matchCoins: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#757396" },
  matchTopicsRow: { flexGrow: 0, marginVertical: 6 },
  matchTopicTag: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginHorizontal: 5 },
  matchTopicTxt: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "#fff" },
  matchCallType: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#757396", marginVertical: 4 },
  matchBtns: { flexDirection: "row", gap: 48, marginTop: 12 },
  matchBtnItem: { alignItems: "center", gap: 8 },
  matchBtnLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "#111329" },
  matchDecline: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#FF025F", alignItems: "center", justifyContent: "center" },
  matchAccept: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  matchBtnIco: { width: 28, height: 28 },
});
