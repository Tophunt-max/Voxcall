import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
  ImageBackground,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MOCK_HOSTS } from "@/data/mockData";

const { width } = Dimensions.get("window");
const RINGS_SIZE = Math.min(width - 32, 360);

const PRIMARY = "#757396";
const ACCENT = "#A00EE7";
const DARK_BG = "rgba(17, 19, 41, 0.82)";

type Phase = "idle" | "searching" | "found";

/* ---------- animated pulse rings ---------- */
function PulseRings({ active }: { active: boolean }) {
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;
  const r3 = useRef(new Animated.Value(0)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      const makeRing = (v: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(v, { toValue: 1, duration: 1600, useNativeDriver: true }),
            Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
          ])
        );
      loop.current = Animated.parallel([makeRing(r1, 0), makeRing(r2, 530), makeRing(r3, 1060)]);
      loop.current.start();
    } else {
      loop.current?.stop();
      r1.setValue(0); r2.setValue(0); r3.setValue(0);
    }
    return () => loop.current?.stop();
  }, [active]);

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.6, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
  });

  return (
    <>
      {[r1, r2, r3].map((v, i) => (
        <Animated.View key={i} style={[styles.pulseRing, ringStyle(v)]} />
      ))}
    </>
  );
}

/* ---------- static decorative rings (always visible) ---------- */
function DecorativeRings() {
  const r1 = RINGS_SIZE * 0.62;
  const r2 = RINGS_SIZE * 0.80;
  const r3 = RINGS_SIZE * 0.97;
  return (
    <>
      <View style={[styles.decoRing, { width: r1, height: r1, borderRadius: r1 / 2, opacity: 0.22 }]} />
      <View style={[styles.decoRing, { width: r2, height: r2, borderRadius: r2 / 2, opacity: 0.14 }]} />
      <View style={[styles.decoRing, { width: r3, height: r3, borderRadius: r3 / 2, opacity: 0.08 }]} />
    </>
  );
}

/* =========== MAIN SCREEN =========== */
export default function RandomScreen() {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("idle");
  const [callType, setCallType] = useState<"audio" | "video">("audio");
  const [matchedHost, setMatchedHost] = useState<(typeof MOCK_HOSTS)[0] | null>(null);
  const scaleBtn = useRef(new Animated.Value(1)).current;

  const onlineHosts = MOCK_HOSTS.filter((h) => h.isOnline);

  const handleFindMatch = () => {
    if (phase !== "idle") return;
    setPhase("searching");
    Animated.sequence([
      Animated.timing(scaleBtn, { toValue: 0.9, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleBtn, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    setTimeout(() => {
      const host = onlineHosts[Math.floor(Math.random() * onlineHosts.length)];
      setMatchedHost(host || null);
      setPhase("found");
    }, 3000);
  };

  const handleCancel = () => { setPhase("idle"); setMatchedHost(null); };

  const handleAccept = () => {
    if (!matchedHost) return;
    setPhase("idle"); setMatchedHost(null);
    router.push(
      callType === "video"
        ? `/call/video-call?hostId=${matchedHost.id}`
        : `/call/audio-call?hostId=${matchedHost.id}`
    );
  };

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  return (
    <ImageBackground
      source={require("@/assets/images/match_bg.png")}
      style={styles.bg}
      resizeMode="cover"
    >
      {/* dark overlay so background doesn't bleach out UI */}
      <View style={[styles.overlay, { backgroundColor: DARK_BG }]} />

      <View style={[styles.root, { paddingTop: topPad + 16 }]}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Random Match</Text>
          <Text style={styles.headerSub}>Instantly connect with a random listener</Text>
        </View>

        {/* ── Center zone ── */}
        <View style={styles.centerZone}>
          {phase === "found" && matchedHost ? (
            <MatchFoundCard
              host={matchedHost}
              onAccept={handleAccept}
              onDecline={handleCancel}
            />
          ) : (
            <>
              {/* rings container */}
              <View style={styles.ringsContainer}>
                <DecorativeRings />
                <PulseRings active={phase === "searching"} />

                {/* center button */}
                <TouchableOpacity
                  onPress={handleFindMatch}
                  activeOpacity={0.85}
                  disabled={phase === "searching"}
                >
                  <Animated.View style={[styles.centerBtn, { transform: [{ scale: scaleBtn }] }]}>
                    <Image
                      source={require("@/assets/icons/ic_shuffle.png")}
                      style={styles.shuffleIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.centerBtnText}>
                      {phase === "searching" ? "Searching..." : "Tap to Find"}
                    </Text>
                  </Animated.View>
                </TouchableOpacity>
              </View>

              {/* online pill */}
              <View style={styles.onlinePill}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineTxt}>{onlineHosts.length} listeners online</Text>
              </View>
            </>
          )}
        </View>

        {/* ── Bottom panel ── */}
        {phase !== "found" && (
          <ImageBackground
            source={require("@/assets/images/match_bottom_bg.png")}
            style={[styles.bottomPanel, { paddingBottom: bottomPad + 16 }]}
            resizeMode="cover"
            imageStyle={styles.bottomBgImg}
          >
            {/* call type */}
            <Text style={styles.chooseLabel}>Choose call type</Text>
            <View style={styles.callRow}>
              {(["audio", "video"] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  onPress={() => setCallType(type)}
                  activeOpacity={0.8}
                  style={[styles.callBtn, callType === type && styles.callBtnActive]}
                >
                  <Image
                    source={
                      type === "audio"
                        ? require("@/assets/icons/ic_call.png")
                        : require("@/assets/icons/ic_video.png")
                    }
                    style={[
                      styles.callBtnIcon,
                      { tintColor: callType === type ? "#fff" : PRIMARY },
                    ]}
                    resizeMode="contain"
                  />
                  <Text style={[styles.callBtnTxt, { color: callType === type ? "#fff" : PRIMARY }]}>
                    {type === "audio" ? "Audio Call" : "Video Call"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* action button */}
            <TouchableOpacity
              onPress={phase === "searching" ? handleCancel : handleFindMatch}
              activeOpacity={0.85}
              style={[styles.actionBtn, phase === "searching" && styles.actionBtnCancel]}
            >
              <Text style={styles.actionBtnTxt}>
                {phase === "searching" ? "Cancel Search" : "Start Random Match"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push("/hosts/all")} style={styles.browseBtn}>
              <Text style={styles.browseTxt}>Or browse all listeners</Text>
            </TouchableOpacity>
          </ImageBackground>
        )}
      </View>
    </ImageBackground>
  );
}

/* =========== MATCH FOUND CARD =========== */
function MatchFoundCard({
  host,
  onAccept,
  onDecline,
}: {
  host: (typeof MOCK_HOSTS)[0];
  onAccept: () => void;
  onDecline: () => void;
}) {
  const scale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }).start();
  }, []);

  return (
    <ImageBackground
      source={require("@/assets/images/match_found_bg.png")}
      style={styles.foundCard}
      resizeMode="cover"
      imageStyle={{ borderRadius: 24 }}
    >
      <Animated.View style={[styles.foundInner, { transform: [{ scale }] }]}>
        <Text style={styles.foundTitle}>Match Found!</Text>

        {/* avatars row */}
        <View style={styles.avatarRow}>
          <View style={styles.avatarWrap}>
            <Image
              source={require("@/assets/images/avatar_placeholder.png")}
              style={styles.avatar}
            />
            <Text style={styles.avatarLabel}>You</Text>
          </View>
          <View style={styles.vsChip}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          <View style={styles.avatarWrap}>
            <Image
              source={require("@/assets/images/avatar_placeholder.png")}
              style={styles.avatar}
            />
            <Text style={styles.avatarLabel} numberOfLines={1}>
              {host.name.split(" ")[0]}
            </Text>
          </View>
        </View>

        {/* host info */}
        <Text style={styles.foundHostName}>{host.name}</Text>
        <View style={styles.foundRatingRow}>
          <Image
            source={require("@/assets/icons/ic_star.png")}
            style={styles.starIco}
            resizeMode="contain"
          />
          <Text style={styles.foundRatingTxt}>{host.rating}</Text>
          <Text style={styles.foundTopics}>{host.topics.slice(0, 2).join(" • ")}</Text>
        </View>

        {/* accept / decline */}
        <View style={styles.matchBtns}>
          <TouchableOpacity onPress={onDecline} style={styles.declineBtn} activeOpacity={0.8}>
            <Image
              source={require("@/assets/icons/ic_call_end.png")}
              style={styles.matchBtnIco}
              resizeMode="contain"
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={onAccept} style={styles.acceptBtn} activeOpacity={0.8}>
            <Image
              source={require("@/assets/icons/ic_call_gradient.png")}
              style={styles.matchBtnIco}
              resizeMode="contain"
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.foundHint}>Green = Connect  •  Red = Skip</Text>
      </Animated.View>
    </ImageBackground>
  );
}

/* =========== STYLES =========== */
const CIRCLE = 148;

const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject },
  root: { flex: 1 },

  header: { alignItems: "center", paddingBottom: 8 },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.65)", marginTop: 2 },

  centerZone: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingBottom: 24,
  },

  ringsContainer: {
    width: RINGS_SIZE,
    height: RINGS_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },

  /* static decorative rings */
  decoRing: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: ACCENT,
    backgroundColor: "transparent",
  },

  /* animated pulse ring */
  pulseRing: {
    position: "absolute",
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: ACCENT,
  },

  /* center circle button */
  centerBtn: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.4)",
    // shadow
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 24,
    elevation: 16,
  },
  shuffleIcon: { width: 42, height: 42, tintColor: "#fff" },
  centerBtnText: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#fff" },

  onlinePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  onlineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#0BAF23" },
  onlineTxt: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#fff" },

  /* bottom */
  bottomPanel: {
    paddingHorizontal: 24,
    paddingTop: 28,
    gap: 14,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: "hidden",
  },
  bottomBgImg: { borderTopLeftRadius: 32, borderTopRightRadius: 32 },

  chooseLabel: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#333", textAlign: "center" },

  callRow: { flexDirection: "row", gap: 12 },
  callBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: PRIMARY,
    backgroundColor: "transparent",
  },
  callBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  callBtnIcon: { width: 20, height: 20 },
  callBtnTxt: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },

  actionBtn: {
    backgroundColor: PRIMARY,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnCancel: { backgroundColor: "#cc4444" },
  actionBtnTxt: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },

  browseBtn: { alignItems: "center", paddingBottom: 4 },
  browseTxt: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#888" },

  /* match found card */
  foundCard: { width: width - 48, borderRadius: 24, overflow: "hidden" },
  foundInner: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 28, gap: 10 },
  foundTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff" },

  avatarRow: { flexDirection: "row", alignItems: "center", gap: 16, marginVertical: 4 },
  avatarWrap: { alignItems: "center", gap: 6 },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: "#fff" },
  avatarLabel: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#fff", maxWidth: 80, textAlign: "center" },
  vsChip: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  vsText: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "#fff" },

  foundHostName: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  foundRatingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  starIco: { width: 14, height: 14, tintColor: "#FFA100" },
  foundRatingTxt: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#FFA100" },
  foundTopics: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.75)" },

  matchBtns: { flexDirection: "row", gap: 40, marginTop: 8 },
  declineBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#FF4444", alignItems: "center", justifyContent: "center" },
  acceptBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#0BAF23", alignItems: "center", justifyContent: "center" },
  matchBtnIco: { width: 28, height: 28, tintColor: "#fff" },
  foundHint: { fontSize: 11, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.6)", textAlign: "center" },
});
