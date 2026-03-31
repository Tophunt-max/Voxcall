import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { MOCK_HOSTS } from "@/data/mockData";

const { width: SW, height: SH } = Dimensions.get("window");

/* ─── Colors (exact from Flutter source) ─── */
const BG        = "#FBF1EA";   // warm peach
const RIPPLE_C  = "#EDDDD2";   // ripple peach
const CARD_BG   = "#EFE9F8";   // light lavender
const AV_BORDER = "#EFE9F8";
const COIN_BORDER = "#E49F14";
const COIN_BG   = "#FFFDF1";
const GRAD: [string, string] = ["#CF00FD", "#8400FF"];

type CallType = "audio" | "video";
type Phase = "idle" | "searching" | "found";

/* ─────────────────── Ripple component ─────────────────── */
function RippleRings() {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const makeRing = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 3000, useNativeDriver: false }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: false }),
        ])
      );
    const anim = Animated.parallel(rings.map((v, i) => makeRing(v, i * 600)));
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={[styles.rippleContainer, { pointerEvents: "none" }]}>
      {rings.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.rippleRing,
            {
              opacity: v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 0.5, 0.5, 0] }),
              transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.5] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

/* ─────────────────── Listener card ─────────────────── */
interface ListenerCardProps {
  host: (typeof MOCK_HOSTS)[0];
  isLeft: boolean;
  isSpecial: boolean; // index == 3 has avatar on left
  delay: number;
  onReplace: () => void;
  onPress: () => void;
}

function ListenerCard({ host, isLeft, isSpecial, delay, onReplace, onPress }: ListenerCardProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.98)).current;

  useEffect(() => {
    const cycle = () => {
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: false }),
          Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: false }),
        ]),
        Animated.delay(3500),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 700, useNativeDriver: false }),
          Animated.timing(scale, { toValue: 0.98, duration: 600, useNativeDriver: false }),
        ]),
      ]).start(({ finished }) => {
        if (finished) { onReplace(); cycle(); }
      });
    };
    cycle();
  }, [host.id]);

  const avatarSide = isSpecial ? { left: -31 } : { right: -31 };
  const pillRadius = isSpecial
    ? { borderBottomRightRadius: 42, borderTopRightRadius: 42 }
    : { borderBottomLeftRadius: 42, borderTopLeftRadius: 42 };
  const pillPad = isSpecial
    ? { paddingLeft: 32, paddingRight: 14, paddingVertical: 8 }
    : { paddingLeft: 20, paddingRight: 32, paddingVertical: 8 };

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
            <Text style={styles.topicText} numberOfLines={1}>{host.specialties[0]}</Text>
          </LinearGradient>
        </View>
        <View style={[styles.cardAvatar, avatarSide]}>
          <Image
            source={require("@/assets/images/avatar_placeholder.png")}
            style={styles.cardAvatarImg}
          />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ─────────────────── Call type dialog ─────────────────── */
function CallTypeDialog({
  visible, selected, onSelect, onClose,
}: { visible: boolean; selected: CallType; onSelect: (t: CallType) => void; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.dialogOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.dialogBox}>
          <Text style={styles.dialogTitle}>Select Call Type</Text>

          {(["audio", "video"] as CallType[]).map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => { onSelect(type); onClose(); }}
              style={styles.dialogRow}
            >
              <Image
                source={type === "audio" ? require("@/assets/icons/ic_call_gradient.png") : require("@/assets/icons/ic_video_gradient.png")}
                style={styles.dialogIcon}
                resizeMode="contain"
              />
              <Text style={styles.dialogLabel}>{type === "audio" ? "Audio Call" : "Video Call"}</Text>
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

/* ─────────────────── Match Found overlay ─────────────────── */
function MatchFoundScreen({
  host, callType, onAccept, onDecline,
}: { host: (typeof MOCK_HOSTS)[0]; callType: CallType; onAccept: () => void; onDecline: () => void }) {
  const scale = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, tension: 55, friction: 8, useNativeDriver: false }).start();
  }, []);

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <Image source={require("@/assets/images/random_match_bg.png")} style={styles.matchBg} resizeMode="cover" />
      <View style={styles.matchOverlay}>
        {/* Close */}
        <TouchableOpacity onPress={onDecline} style={styles.matchClose}>
          <Image source={require("@/assets/icons/ic_close.png")} style={styles.matchCloseIco} tintColor="#111329" resizeMode="contain" />
        </TouchableOpacity>

        <Animated.View style={[styles.matchContent, { transform: [{ scale }] }]}>
          <Text style={styles.matchTitle}>It's a Match!</Text>

          {/* Ripple + Avatar */}
          <View style={styles.matchAvatarWrap}>
            <MatchRipple />
            <View style={styles.matchAvatarCircle}>
              <Image source={require("@/assets/images/avatar_placeholder.png")} style={styles.matchAvatarImg} />
            </View>
          </View>

          <Text style={styles.matchName}>{host.name}</Text>
          <Text style={styles.matchId}>ID: {host.id.replace("host", "").padStart(8, "0")}</Text>

          {/* Topics */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.matchTopicsRow}>
            {host.specialties.map((t) => (
              <LinearGradient key={t} colors={GRAD} style={styles.matchTopicTag} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={styles.matchTopicTxt}>{t}</Text>
              </LinearGradient>
            ))}
          </ScrollView>

          {/* Buttons */}
          <View style={styles.matchBtns}>
            <TouchableOpacity onPress={onDecline} style={styles.matchDecline} activeOpacity={0.8}>
              <Image source={require("@/assets/icons/ic_call_end.png")} style={styles.matchBtnIco} tintColor="#fff" resizeMode="contain" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onAccept} activeOpacity={0.8}>
              <LinearGradient colors={GRAD} style={styles.matchAccept} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Image source={require("@/assets/icons/ic_call_gradient.png")} style={styles.matchBtnIco} tintColor="#fff" resizeMode="contain" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function MatchRipple() {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anim = Animated.parallel(
      rings.map((v, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(i * 400),
            Animated.timing(v, { toValue: 1, duration: 3000, useNativeDriver: false }),
            Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: false }),
          ])
        )
      )
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={[styles.matchRippleWrap, { pointerEvents: "none" }]}>
      {rings.map((v, i) => (
        <Animated.View key={i} style={[styles.matchRippleRing, { opacity: v.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.4, 0.4, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.8] }) }] }]} />
      ))}
    </View>
  );
}

/* ═══════════════════ MAIN SCREEN ═══════════════════ */
export default function RandomScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [dialogVisible, setDialogVisible] = useState(false);
  const [matchedHost, setMatchedHost] = useState<(typeof MOCK_HOSTS)[0] | null>(null);

  const onlineHosts = MOCK_HOSTS.filter((h) => h.isOnline);
  const displayHosts = useRef([...onlineHosts].sort(() => Math.random() - 0.5).slice(0, 4)).current;
  const currentHosts = useRef([...displayHosts]);
  const [cardKeys, setCardKeys] = useState([0, 1, 2, 3]);

  const handleReplace = useCallback((index: number) => {
    const used = new Set(currentHosts.current.map((h) => h.id));
    const available = MOCK_HOSTS.filter((h) => !used.has(h.id));
    if (available.length > 0) {
      currentHosts.current[index] = available[Math.floor(Math.random() * available.length)];
      setCardKeys((prev) => { const next = [...prev]; next[index] = prev[index] + 4; return next; });
    }
  }, []);

  const handleFindMatch = () => {
    setPhase("searching");
    setTimeout(() => {
      const host = onlineHosts[Math.floor(Math.random() * onlineHosts.length)];
      setMatchedHost(host);
      setPhase("found");
    }, 2500);
  };

  const handleAccept = () => {
    if (!matchedHost) return;
    setPhase("idle");
    router.push(
      callType === "video"
        ? `/call/video-call?hostId=${matchedHost.id}`
        : `/call/audio-call?hostId=${matchedHost.id}`
    );
  };

  const handleDecline = () => { setPhase("idle"); setMatchedHost(null); };

  const topPad = insets.top;
  const dotTop = SH * 0.2;
  const cardTop = SH * 0.18;
  const cardBottom = SH * 0.17;

  return (
    <View style={styles.root}>
      {/* ── Warm background ── */}
      <View style={[styles.bg, { backgroundColor: BG }]} />

      {/* ── Ripple on right side ── */}
      <View style={[styles.ripplePositioner, { top: dotTop }]}>
        <RippleRings />
      </View>

      {/* ── Dot pattern ── */}
      <Image
        source={require("@/assets/images/random_dot_bg.png")}
        style={[styles.dotBg, { top: dotTop, pointerEvents: "none" } as any]}
        resizeMode="cover"
      />

      {/* ── Circular person image (right side) ── */}
      <View style={[styles.circleImgWrap, { top: dotTop }]}>
        <Image
          source={require("@/assets/images/random_bg.png")}
          style={styles.circleImg}
          resizeMode="cover"
        />
      </View>

      {/* ── Bottom background ── */}
      <Image
        source={require("@/assets/images/random_bottom_bg.png")}
        style={[styles.bottomBgImg, { pointerEvents: "none" } as any]}
        resizeMode="cover"
      />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        {/* User avatar (dotted border) */}
        <View style={styles.avatarDotBorder}>
          <View style={styles.avatarCircle}>
            <Image
              source={require("@/assets/images/avatar_placeholder.png")}
              style={styles.userAvatarImg}
            />
          </View>
        </View>

        {/* Name + email */}
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>{user?.name ?? "Guest"}</Text>
          <Text style={styles.headerEmail} numberOfLines={1}>{user?.email ?? "guest@voxlink.com"}</Text>
        </View>

        {/* Coin balance */}
        <TouchableOpacity onPress={() => router.push("/(tabs)/wallet")} style={styles.coinWidget} activeOpacity={0.85}>
          <View style={styles.coinInfo}>
            <Text style={styles.coinAmount}>{user?.coins ?? 0}</Text>
            <Text style={styles.coinLabel}>My Balance</Text>
          </View>
          <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
        </TouchableOpacity>
      </View>

      {/* ── 4 Listener cards ── */}
      <View
        style={[
          styles.cardsZone,
          { top: cardTop, bottom: cardBottom + 90, pointerEvents: "box-none" },
        ]}
      >
        {displayHosts.slice(0, 4).map((host, index) => {
          const isLeft = index % 2 === 0;
          const isSpecial = index === 3;
          return (
            <ListenerCard
              key={`${cardKeys[index]}-${index}`}
              host={currentHosts.current[index]}
              isLeft={isLeft}
              isSpecial={isSpecial}
              delay={index * 400}
              onReplace={() => handleReplace(index)}
              onPress={() => router.push(`/hosts/${currentHosts.current[index].id}`)}
            />
          );
        })}
      </View>

      {/* ── Bottom buttons ── */}
      <View style={[styles.bottomBtns, { paddingBottom: insets.bottom + 16 }]}>
        {/* Call type selector */}
        <TouchableOpacity onPress={() => setDialogVisible(true)} style={styles.callTypeBtn} activeOpacity={0.85}>
          <Image
            source={callType === "audio" ? require("@/assets/icons/ic_call_gradient.png") : require("@/assets/icons/ic_video_gradient.png")}
            style={styles.callTypeBtnIcon}
            resizeMode="contain"
          />
          <Text style={styles.callTypeBtnTxt}>{callType === "audio" ? "Audio Call" : "Video Call"}</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.dropArrow} tintColor="#111329" resizeMode="contain" />
        </TouchableOpacity>

        {/* Random Match gradient button */}
        <TouchableOpacity onPress={handleFindMatch} disabled={phase === "searching"} activeOpacity={0.85} style={styles.randomBtnWrap}>
          <LinearGradient colors={GRAD} style={styles.randomBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            <Text style={styles.randomBtnTxt}>
              {phase === "searching" ? "Searching..." : "Random Match"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ── Call type dialog ── */}
      <CallTypeDialog
        visible={dialogVisible}
        selected={callType}
        onSelect={setCallType}
        onClose={() => setDialogVisible(false)}
      />

      {/* ── Match Found ── */}
      {phase === "found" && matchedHost && (
        <MatchFoundScreen
          host={matchedHost}
          callType={callType}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      )}
    </View>
  );
}

/* ═══════════════════ STYLES ═══════════════════ */
const AVATAR_SIZE = SH * 0.065;
const CIRCLE_IMG_SIZE = 270;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  bg: { ...StyleSheet.absoluteFillObject },

  /* ripple */
  ripplePositioner: { position: "absolute", right: -170, width: 370, height: 370, alignItems: "center", justifyContent: "center" },
  rippleRing: { position: "absolute", width: 370, height: 370, borderRadius: 185, backgroundColor: RIPPLE_C },

  /* dot bg */
  dotBg: { position: "absolute", left: 0, right: 0, width: SW, height: 300 },

  /* circle image */
  circleImgWrap: {
    position: "absolute",
    right: -140,
    width: CIRCLE_IMG_SIZE,
    height: CIRCLE_IMG_SIZE,
    borderRadius: CIRCLE_IMG_SIZE / 2,
    overflow: "hidden",
    opacity: 0.55,
    backgroundColor: "#EFE2DE11",
  },
  circleImg: { width: "100%", height: "100%" },

  /* bottom bg image */
  bottomBgImg: {
    position: "absolute",
    bottom: -SH * 0.1,
    left: 0,
    right: 0,
    width: SW,
    height: 300,
  },

  /* header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 10,
  },
  avatarDotBorder: {
    width: AVATAR_SIZE + 8,
    height: AVATAR_SIZE + 8,
    borderRadius: (AVATAR_SIZE + 8) / 2,
    borderWidth: 1.5,
    borderColor: "#111329",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "#E5E5E5",
    overflow: "hidden",
  },
  userAvatarImg: { width: "100%", height: "100%" },
  headerText: { flex: 1 },
  headerName: { fontSize: 16, fontFamily: "Poppins_700Bold", color: "#111329" },
  headerEmail: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  coinWidget: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COIN_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COIN_BORDER,
    paddingLeft: 10,
  },
  coinInfo: { alignItems: "flex-end" },
  coinAmount: { fontSize: 18, fontFamily: "Poppins_700Bold", color: COIN_BORDER },
  coinLabel: { fontSize: 11, fontFamily: "Poppins_600SemiBold", color: COIN_BORDER },
  coinIcon: { width: 32, height: 32, margin: 8 },

  /* cards zone */
  cardsZone: {
    position: "absolute",
    left: 0,
    right: 0,
    justifyContent: "space-evenly",
    paddingHorizontal: 14,
    gap: 12,
  },

  /* listener card */
  cardAligner: { maxWidth: SW * 0.7 },
  cardPill: {
    backgroundColor: CARD_BG,
    borderWidth: 2,
    borderColor: "#fff",
  },
  cardName: { fontSize: 12, fontFamily: "Poppins_700Bold", color: "#111329", marginBottom: 3 },
  topicTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 46, alignSelf: "flex-start" },
  topicText: { fontSize: 10, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  cardAvatar: {
    position: "absolute",
    top: "50%",
    marginTop: -31,
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 4,
    borderColor: AV_BORDER,
    overflow: "hidden",
    shadowColor: "#CF00FD",
    shadowOffset: { width: 1, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    backgroundColor: "#E5E5E5",
  },
  cardAvatarImg: { width: "100%", height: "100%" },

  /* bottom buttons */
  bottomBtns: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 0,
  },
  callTypeBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 30,
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 6,
    marginBottom: 0,
  },
  callTypeBtnIcon: { width: 20, height: 20 },
  callTypeBtnTxt: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  dropArrow: { width: 14, height: 14, transform: [{ rotate: "-90deg" }] },
  randomBtnWrap: { width: SW - 48, marginTop: 16 },
  randomBtn: { paddingVertical: 14, borderRadius: 30, alignItems: "center" },
  randomBtnTxt: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#fff" },

  /* call type dialog */
  dialogOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  dialogBox: { width: SW - 64, backgroundColor: "#fff", borderRadius: 26, overflow: "hidden" },
  dialogTitle: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329", textAlign: "center", paddingVertical: 13, backgroundColor: "rgba(0,0,0,0.02)" },
  dialogRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 18, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#eee" },
  dialogIcon: { width: 32, height: 32 },
  dialogLabel: { flex: 1, fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  dialogRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: "#ccc", alignItems: "center", justifyContent: "center" },
  dialogRadioActive: { borderColor: "#8400FF", backgroundColor: "#8400FF" },
  dialogRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },

  /* match found */
  matchBg: { ...StyleSheet.absoluteFillObject, width: SW, height: SH },
  matchOverlay: { flex: 1, alignItems: "center", paddingTop: SH * 0.08 },
  matchClose: { alignSelf: "flex-end", marginRight: 33, marginBottom: 36 },
  matchCloseIco: { width: 26, height: 26 },
  matchContent: { alignItems: "center", gap: 8 },
  matchTitle: { fontSize: 40, fontFamily: "Poppins_700Bold", color: "#111329", marginBottom: 22 },

  matchAvatarWrap: { width: 170, height: 170, alignItems: "center", justifyContent: "center" },
  matchRippleWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  matchRippleRing: { position: "absolute", width: 170, height: 170, borderRadius: 85, backgroundColor: "#84889F40" },
  matchAvatarCircle: { width: 100, height: 100, borderRadius: 50, overflow: "hidden", borderWidth: 3, borderColor: "#fff" },
  matchAvatarImg: { width: "100%", height: "100%" },

  matchName: { fontSize: 20, fontFamily: "Poppins_600SemiBold", color: "#111329", marginTop: 18 },
  matchId: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#555", marginBottom: 8 },
  matchTopicsRow: { maxHeight: 36 },
  matchTopicTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 46, marginHorizontal: 4 },
  matchTopicTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#fff" },

  matchBtns: { flexDirection: "row", gap: 48, marginTop: 32 },
  matchDecline: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#FF3B30", alignItems: "center", justifyContent: "center" },
  matchAccept: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  matchBtnIco: { width: 28, height: 28 },
});
