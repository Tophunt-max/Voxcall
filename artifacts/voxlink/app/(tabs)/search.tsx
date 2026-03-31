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
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { MOCK_HOSTS } from "@/data/mockData";

const { width, height } = Dimensions.get("window");
const SCREEN_HEIGHT = height;

type Phase = "idle" | "searching" | "found";

function PulseRings({ color, active }: { color: string; active: boolean }) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      const makeRing = (val: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(val, {
              toValue: 1,
              duration: 1800,
              useNativeDriver: true,
            }),
            Animated.timing(val, {
              toValue: 0,
              duration: 0,
              useNativeDriver: true,
            }),
          ])
        );
      anim.current = Animated.parallel([
        makeRing(ring1, 0),
        makeRing(ring2, 600),
        makeRing(ring3, 1200),
      ]);
      anim.current.start();
    } else {
      anim.current?.stop();
      ring1.setValue(0);
      ring2.setValue(0);
      ring3.setValue(0);
    }
    return () => anim.current?.stop();
  }, [active]);

  const makeStyle = (val: Animated.Value) => ({
    opacity: val.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.5, 0] }),
    transform: [
      {
        scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }),
      },
    ],
  });

  return (
    <>
      <Animated.View
        style={[
          styles.ring,
          { backgroundColor: color, borderColor: color },
          makeStyle(ring1),
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          { backgroundColor: color, borderColor: color },
          makeStyle(ring2),
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          { backgroundColor: color, borderColor: color },
          makeStyle(ring3),
        ]}
      />
    </>
  );
}

export default function RandomScreen() {
  const colors = useColors();
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
      Animated.timing(scaleBtn, { toValue: 0.92, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleBtn, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    setTimeout(() => {
      const random = onlineHosts[Math.floor(Math.random() * onlineHosts.length)];
      setMatchedHost(random || null);
      setPhase("found");
    }, 3000);
  };

  const handleCancel = () => {
    setPhase("idle");
    setMatchedHost(null);
  };

  const handleAccept = () => {
    if (!matchedHost) return;
    setPhase("idle");
    setMatchedHost(null);
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
      <View style={[styles.overlay, { paddingTop: topPad + 16 }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Random Match</Text>
          <Text style={styles.headerSub}>Connect with a random listener instantly</Text>
        </View>

        {/* Center area */}
        <View style={styles.centerArea}>
          {phase === "found" && matchedHost ? (
            <MatchFoundView host={matchedHost} onAccept={handleAccept} onDecline={handleCancel} />
          ) : (
            <>
              {/* Pulse rings + center button */}
              <View style={styles.pulseContainer}>
                <PulseRings color="#ffffff" active={phase === "searching"} />
                <TouchableOpacity
                  onPress={handleFindMatch}
                  activeOpacity={0.85}
                  disabled={phase === "searching"}
                >
                  <Animated.View
                    style={[
                      styles.centerCircle,
                      { transform: [{ scale: scaleBtn }] },
                    ]}
                  >
                    {phase === "searching" ? (
                      <>
                        <Image
                          source={require("@/assets/icons/ic_shuffle.png")}
                          style={styles.centerIcon}
                          resizeMode="contain"
                        />
                        <Text style={styles.centerSearchText}>Searching...</Text>
                      </>
                    ) : (
                      <>
                        <Image
                          source={require("@/assets/icons/ic_shuffle.png")}
                          style={styles.centerIcon}
                          resizeMode="contain"
                        />
                        <Text style={styles.centerTapText}>Tap to{"\n"}Find</Text>
                      </>
                    )}
                  </Animated.View>
                </TouchableOpacity>
              </View>

              {/* Online users row */}
              <View style={styles.onlineRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>
                  {onlineHosts.length} listeners available right now
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Bottom panel */}
        {phase !== "found" && (
          <ImageBackground
            source={require("@/assets/images/match_bottom_bg.png")}
            style={[styles.bottomPanel, { paddingBottom: bottomPad + 16 }]}
            resizeMode="cover"
            imageStyle={styles.bottomBgImage}
          >
            {/* Call type toggle */}
            <Text style={styles.chooseLabel}>Choose call type</Text>
            <View style={styles.callTypeRow}>
              <TouchableOpacity
                onPress={() => setCallType("audio")}
                style={[
                  styles.callTypeBtn,
                  callType === "audio" && styles.callTypeBtnActive,
                ]}
                activeOpacity={0.8}
              >
                <Image
                  source={require("@/assets/icons/ic_call.png")}
                  style={[
                    styles.callTypeIcon,
                    { tintColor: callType === "audio" ? "#fff" : "#757396" },
                  ]}
                  resizeMode="contain"
                />
                <Text
                  style={[
                    styles.callTypeText,
                    { color: callType === "audio" ? "#fff" : "#757396" },
                  ]}
                >
                  Audio Call
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setCallType("video")}
                style={[
                  styles.callTypeBtn,
                  callType === "video" && styles.callTypeBtnActive,
                ]}
                activeOpacity={0.8}
              >
                <Image
                  source={require("@/assets/icons/ic_video.png")}
                  style={[
                    styles.callTypeIcon,
                    { tintColor: callType === "video" ? "#fff" : "#757396" },
                  ]}
                  resizeMode="contain"
                />
                <Text
                  style={[
                    styles.callTypeText,
                    { color: callType === "video" ? "#fff" : "#757396" },
                  ]}
                >
                  Video Call
                </Text>
              </TouchableOpacity>
            </View>

            {/* Find button */}
            <TouchableOpacity
              onPress={handleFindMatch}
              disabled={phase === "searching"}
              activeOpacity={0.85}
              style={[
                styles.findBtn,
                phase === "searching" && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.findBtnText}>
                {phase === "searching" ? "Searching for match..." : "Start Random Match"}
              </Text>
            </TouchableOpacity>

            {phase === "searching" ? (
              <TouchableOpacity onPress={handleCancel} style={styles.cancelLink}>
                <Text style={styles.cancelLinkText}>Cancel</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => router.push("/hosts/all")}
                style={styles.browseLink}
              >
                <Text style={styles.browseLinkText}>Or browse all listeners</Text>
              </TouchableOpacity>
            )}
          </ImageBackground>
        )}
      </View>
    </ImageBackground>
  );
}

function MatchFoundView({
  host,
  onAccept,
  onDecline,
}: {
  host: (typeof MOCK_HOSTS)[0];
  onAccept: () => void;
  onDecline: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 60,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <ImageBackground
      source={require("@/assets/images/match_found_bg.png")}
      style={styles.matchFoundBox}
      resizeMode="cover"
      imageStyle={{ borderRadius: 24 }}
    >
      <Animated.View style={[styles.matchFoundInner, { transform: [{ scale: scaleAnim }] }]}>
        <Text style={styles.matchFoundLabel}>Match Found!</Text>

        <View style={styles.matchAvatarsRow}>
          {/* User */}
          <View style={styles.matchAvatarWrap}>
            <Image
              source={require("@/assets/images/avatar_placeholder.png")}
              style={styles.matchAvatar}
            />
            <Text style={styles.matchAvatarName}>You</Text>
          </View>

          {/* VS divider */}
          <View style={styles.vsCircle}>
            <Text style={styles.vsText}>VS</Text>
          </View>

          {/* Host */}
          <View style={styles.matchAvatarWrap}>
            <Image
              source={
                host.avatar
                  ? { uri: host.avatar }
                  : require("@/assets/images/avatar_placeholder.png")
              }
              style={styles.matchAvatar}
            />
            <Text style={styles.matchAvatarName} numberOfLines={1}>
              {host.name.split(" ")[0]}
            </Text>
          </View>
        </View>

        <View style={styles.hostInfoRow}>
          <Text style={styles.hostInfoName}>{host.name}</Text>
          <View style={styles.hostRating}>
            <Image
              source={require("@/assets/icons/ic_star.png")}
              style={styles.starIcon}
              resizeMode="contain"
            />
            <Text style={styles.hostRatingText}>{host.rating}</Text>
          </View>
        </View>
        <Text style={styles.hostInfoTopics}>{host.topics.slice(0, 2).join(" • ")}</Text>

        <View style={styles.matchActions}>
          <TouchableOpacity onPress={onDecline} style={styles.declineBtn} activeOpacity={0.8}>
            <Image
              source={require("@/assets/icons/ic_call_end.png")}
              style={styles.matchActionIcon}
              resizeMode="contain"
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={onAccept} style={styles.acceptBtn} activeOpacity={0.8}>
            <Image
              source={require("@/assets/icons/ic_call_gradient.png")}
              style={styles.matchActionIcon}
              resizeMode="contain"
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.matchHint}>Tap green to connect • Red to skip</Text>
      </Animated.View>
    </ImageBackground>
  );
}

const CIRCLE_SIZE = 160;
const RING_SIZE = CIRCLE_SIZE;

const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { flex: 1 },
  header: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Poppins_700Bold",
    color: "#fff",
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
  },

  centerArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },

  pulseContainer: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
  },
  centerCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  centerIcon: { width: 40, height: 40, tintColor: "#fff" },
  centerTapText: {
    fontSize: 13,
    fontFamily: "Poppins_600SemiBold",
    color: "#fff",
    textAlign: "center",
    lineHeight: 18,
  },
  centerSearchText: {
    fontSize: 11,
    fontFamily: "Poppins_500Medium",
    color: "#fff",
    textAlign: "center",
  },

  onlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0BAF23",
  },
  onlineText: {
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
    color: "#fff",
  },

  bottomPanel: {
    paddingHorizontal: 24,
    paddingTop: 28,
    overflow: "hidden",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    gap: 14,
  },
  bottomBgImage: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  chooseLabel: {
    fontSize: 13,
    fontFamily: "Poppins_600SemiBold",
    color: "#333",
    textAlign: "center",
  },
  callTypeRow: {
    flexDirection: "row",
    gap: 12,
  },
  callTypeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e0ddf0",
    backgroundColor: "#f5f4fc",
  },
  callTypeBtnActive: {
    backgroundColor: "#757396",
    borderColor: "#757396",
  },
  callTypeIcon: { width: 20, height: 20 },
  callTypeText: {
    fontSize: 13,
    fontFamily: "Poppins_600SemiBold",
  },
  findBtn: {
    backgroundColor: "#757396",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  findBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
  },
  browseLink: { alignItems: "center", paddingBottom: 4 },
  browseLinkText: {
    fontSize: 13,
    fontFamily: "Poppins_400Regular",
    color: "#888",
  },
  cancelLink: { alignItems: "center", paddingBottom: 4 },
  cancelLinkText: {
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
    color: "#E55",
  },

  // Match found
  matchFoundBox: {
    width: width - 48,
    borderRadius: 24,
    overflow: "hidden",
  },
  matchFoundInner: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 28,
    gap: 12,
  },
  matchFoundLabel: {
    fontSize: 20,
    fontFamily: "Poppins_700Bold",
    color: "#fff",
  },
  matchAvatarsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginVertical: 4,
  },
  matchAvatarWrap: { alignItems: "center", gap: 6 },
  matchAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: "#fff",
  },
  matchAvatarName: {
    fontSize: 13,
    fontFamily: "Poppins_600SemiBold",
    color: "#fff",
    maxWidth: 80,
    textAlign: "center",
  },
  vsCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  vsText: {
    fontSize: 13,
    fontFamily: "Poppins_700Bold",
    color: "#fff",
  },
  hostInfoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hostInfoName: {
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
    color: "#fff",
  },
  hostRating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  starIcon: { width: 12, height: 12, tintColor: "#FFA100" },
  hostRatingText: {
    fontSize: 12,
    fontFamily: "Poppins_600SemiBold",
    color: "#fff",
  },
  hostInfoTopics: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
  },
  matchActions: {
    flexDirection: "row",
    gap: 40,
    marginTop: 8,
  },
  declineBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#0BAF23",
    alignItems: "center",
    justifyContent: "center",
  },
  matchActionIcon: { width: 28, height: 28, tintColor: "#fff" },
  matchHint: {
    fontSize: 11,
    fontFamily: "Poppins_400Regular",
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
  },
});
