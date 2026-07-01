import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Animated, Dimensions, Modal, ScrollView, ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { useLanguage } from "@/context/LanguageContext";
import type { Translations } from "@/localization/en";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";
import { InsufficientCoinsPopup } from "@/components/InsufficientCoinsPopup";
import { MatchLimitSheet } from "@/components/MatchLimitSheet";

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

/**
 * Hard cap on /match/find polls per searching session. At 2.5s/poll this
 * gives roughly a 50-second search window before we stop hammering the
 * server and surface a friendly "no host available" state.
 */
const MAX_POLL_ATTEMPTS = 20;
/** How often to refresh the floating-cards "who's online" list. */
const ONLINE_HOSTS_REFRESH_MS = 30_000;

type CallType = "audio" | "video";
type Phase = "idle" | "searching" | "connecting" | "no_hosts";

type GenderFilter = "any" | "male" | "female";
type RatingFilter = 0 | 3 | 4 | 4.5;

interface MatchFilters {
  gender: GenderFilter;
  minRating: RatingFilter;
}

interface HostCard {
  id: string;
  user_id?: string;
  name: string;
  avatar_url?: string;
  rating: number;
  coins_per_minute: number;
  specialties: string[];
}

/**
 * Fisher-Yates in-place shuffle. The previous `sort(() => Math.random() - 0.5)`
 * approach is biased — V8's TimSort uses the comparator transitively so some
 * permutations end up far more likely than others, making the same hosts
 * cluster on the floating cards. Fisher-Yates picks a uniformly random index
 * for each remaining slot, so every permutation is equally likely.
 */
function shuffle<T>(input: T[]): T[] {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Map a stable server `code` to a user-visible message. The backend never
 * sends localized strings any more — the client owns the wording so it can
 * translate (and the server stays language-agnostic).
 */
function searchingMessageForCode(code: string | undefined, onlineCount: number, tr: Translations): string {
  switch (code) {
    case "INSUFFICIENT_COINS":
      return tr.random.statusInsufficientCoins;
    case "RATE_LIMITED":
      return tr.random.statusRateLimited;
    case "DAILY_LIMIT_REACHED":
      return tr.random.statusDailyLimit;
    case "DECLINE_COOLDOWN":
      return tr.random.statusDeclineCooldown;
    case "NO_MATCH_WITH_FILTERS":
      return tr.random.statusNoMatchFilters;
    case "NO_HOST_AVAILABLE":
      return onlineCount > 0
        ? tr.random.statusSearching
        : tr.random.statusNoneOnline;
    default:
      return tr.random.findingMatch;
  }
}

/**
 * Maps a 429-family limit code to the popup content (emoji + body) shown when
 * a random search is hard-stopped. Reuses the existing status strings so no
 * new i18n keys are needed across the 5 supported languages.
 */
function limitPopupContent(
  res: { code?: string; retry_after_sec?: number; used?: number; daily_limit?: number },
  tr: Translations,
): { emoji: string; message: string; subtext?: string; retryAfterSec?: number } {
  switch (res.code) {
    case "DAILY_LIMIT_REACHED": {
      // Show usage (e.g. "5/5 · ") when the server reported it, plus the
      // reset hint. No retry timer — the daily cap is a 24h rolling window.
      const usage = res.used != null && res.daily_limit != null ? `${res.used}/${res.daily_limit} · ` : "";
      return { emoji: "📅", message: tr.random.statusDailyLimit, subtext: `${usage}${tr.random.dailyLimitReset}` };
    }
    case "DECLINE_COOLDOWN":
      return { emoji: "⏳", message: tr.random.statusDeclineCooldown, retryAfterSec: res.retry_after_sec };
    case "RATE_LIMITED":
      return { emoji: "🚦", message: tr.random.statusRateLimited, retryAfterSec: res.retry_after_sec };
    default:
      return { emoji: "ℹ️", message: tr.random.statusGiveUp, retryAfterSec: res.retry_after_sec };
  }
}

/* ─── Ripple rings (background) ─── */
function RippleRings() {
  const r0 = useRef(new Animated.Value(0)).current;
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;
  const r3 = useRef(new Animated.Value(0)).current;
  const r4 = useRef(new Animated.Value(0)).current;
  const rings = [r0, r1, r2, r3, r4];
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
  const { t: tr } = useLanguage();
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

  const avatarUri = resolveMediaUrl(host.avatar_url) || `https://api.dicebear.com/7.x/avataaars/png?seed=${host.id}`;

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
            <Text style={styles.topicText} numberOfLines={1}>{host.specialties[0] ?? tr.hosts.listener}</Text>
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
  const { t: tr } = useLanguage();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.dialogOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.dialogBox}>
          <Text style={styles.dialogTitle}>{tr.random.chooseCallType}</Text>
          {(["audio", "video"] as CallType[]).map((type) => (
            <TouchableOpacity key={type} onPress={() => { onSelect(type); onClose(); }} style={styles.dialogRow}>
              <Image
                source={type === "audio" ? require("@/assets/icons/ic_call_gradient.png") : require("@/assets/icons/ic_chat_video.png")}
                style={styles.dialogIcon}
                resizeMode="contain"
              />
              <Text style={styles.dialogLabel}>{type === "audio" ? tr.random.voiceCall : tr.random.videoCall}</Text>
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

/* ─── Filters bottom sheet ─── */
function FiltersDialog({ visible, value, onChange, onClose }: {
  visible: boolean;
  value: MatchFilters;
  onChange: (v: MatchFilters) => void;
  onClose: () => void;
}) {
  const { t: tr } = useLanguage();
  const genderOptions: { key: GenderFilter; label: string; emoji: string }[] = [
    { key: "any", label: tr.random.genderAny, emoji: "✨" },
    { key: "male", label: tr.random.genderMale, emoji: "👨" },
    { key: "female", label: tr.random.genderFemale, emoji: "👩" },
  ];
  const ratingOptions: { key: RatingFilter; label: string }[] = [
    { key: 0, label: tr.random.ratingAny },
    { key: 3, label: tr.random.rating3 },
    { key: 4, label: tr.random.rating4 },
    { key: 4.5, label: tr.random.rating4_5 },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.dialogOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => { /* swallow */ }} style={styles.filtersSheet}>
          <Text style={styles.dialogTitle}>{tr.random.matchFilters}</Text>

          <Text style={styles.filterLabel}>{tr.random.gender}</Text>
          <View style={styles.filterChipsRow}>
            {genderOptions.map((opt) => {
              const active = value.gender === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => onChange({ ...value, gender: opt.key })}
                  activeOpacity={0.85}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillTxt, active && styles.filterPillTxtActive]}>
                    {opt.emoji}  {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.filterLabel, { marginTop: 16 }]}>{tr.random.minimumRating}</Text>
          <View style={styles.filterChipsRow}>
            {ratingOptions.map((opt) => {
              const active = value.minRating === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => onChange({ ...value, minRating: opt.key })}
                  activeOpacity={0.85}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillTxt, active && styles.filterPillTxtActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.filtersFooter}>
            <TouchableOpacity
              onPress={() => onChange({ gender: "any", minRating: 0 })}
              activeOpacity={0.7}
              style={styles.filtersResetBtn}
            >
              <Text style={styles.filtersResetTxt}>{tr.random.reset}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} activeOpacity={0.85} style={styles.filtersDoneBtn}>
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.filtersDoneBtnInner}>
                <Text style={styles.filtersDoneTxt}>{tr.random.done}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Match found ripple ─── */
function MatchRipple() {
  const m0 = useRef(new Animated.Value(0)).current;
  const m1 = useRef(new Animated.Value(0)).current;
  const m2 = useRef(new Animated.Value(0)).current;
  const rings = [m0, m1, m2];
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

/* ─── Connecting screen overlay (short cancel window, then auto-calls) ─── */
const CONNECT_COUNTDOWN = 3;
function ConnectingScreen({ host, callType, adminCoinRate, onConnect, onCancel }: {
  host: HostCard; callType: CallType; adminCoinRate: number;
  onConnect: () => void; onCancel: () => void;
}) {
  const { t: tr } = useLanguage();
  const scale = useRef(new Animated.Value(0.7)).current;
  const [count, setCount] = useState(CONNECT_COUNTDOWN);
  // Latest onConnect without retriggering the countdown effect; guard so we
  // only fire the call once even if the interval and unmount race.
  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;
  const firedRef = useRef(false);

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, tension: 55, friction: 8, useNativeDriver: false }).start();
    let n = CONNECT_COUNTDOWN;
    const id = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n <= 0) {
        clearInterval(id);
        if (!firedRef.current) { firedRef.current = true; onConnectRef.current(); }
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avatarUri = resolveMediaUrl(host.avatar_url) || `https://api.dicebear.com/7.x/avataaars/png?seed=${host.id}`;
  const coinsPerMin = adminCoinRate;

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <Image source={require("@/assets/images/match_bg.png")} style={styles.matchBg} resizeMode="cover" />
      <View style={styles.matchOverlay}>
        <Animated.View style={[styles.matchContent, { transform: [{ scale }] }]}>
          <Text style={styles.matchTitle}>{tr.random.matchFound}</Text>

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
            {callType === "video" ? `🎥 ${tr.random.videoCall}` : `🎤 ${tr.random.voiceCall}`}
          </Text>

          {/* Auto-connect: a short cancel window (countdown) then the call is
              placed in the background. Once the countdown hits 0 we show a
              spinner while the outgoing call is set up. */}
          {count > 0 ? (
            <TouchableOpacity onPress={onCancel} activeOpacity={0.85} style={styles.connectCancelBtn} accessibilityLabel="Cancel and stop connecting">
              <Image source={require("@/assets/icons/ic_call_end.png")} style={styles.connectCancelIco} tintColor="#fff" resizeMode="contain" />
              <Text style={styles.connectCancelTxt}>{tr.random.decline}  ·  {count}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.connectingRow}>
              <ActivityIndicator color="#8400FF" />
              <Text style={styles.connectingTxt}>{tr.random.checking}</Text>
            </View>
          )}
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
  const { t: tr } = useLanguage();

  const [phase, setPhase]         = useState<Phase>("idle");
  const [callType, setCallType]   = useState<CallType>("audio");
  const [dialogVisible, setDialog] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<MatchFilters>({ gender: "any", minRating: 0 });
  const [matchedHost, setMatchedHost] = useState<HostCard | null>(null);
  const [adminCoinRate, setAdminCoinRate] = useState<number>(5);
  const [statusMsg, setStatusMsg]  = useState("");
  const [statusCode, setStatusCode] = useState<string | undefined>(undefined);
  const [onlineCount, setOnlineCount] = useState<number>(0);

  // Limit / abuse popups. INSUFFICIENT_COINS gets the coin-plans sheet; the
  // 429 family (daily limit / decline cooldown / rate limit) gets a simple
  // single-button info modal.
  const [showCoinsPopup, setShowCoinsPopup] = useState(false);
  const [requiredCoins, setRequiredCoins] = useState(0);
  const [limitPopup, setLimitPopup] = useState<{ emoji: string; message: string; subtext?: string; retryAfterSec?: number } | null>(null);

  // Floating card hosts (real API)
  const [cardHosts, setCardHosts] = useState<HostCard[]>([]);
  const currentHosts = useRef<HostCard[]>([]);
  const [cardKeys, setCardKeys]   = useState([0, 1, 2, 3]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);
  const startSearchingRef = useRef<() => void>(() => {});
  const isMounted = useRef(true);
  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);

  // Load + periodically refresh online-host list (powers both the floating
  // cards and the "N listeners online" pill). Uses Fisher-Yates so the same
  // hosts don't cluster on the cards.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const res = await API.matchOnlineHosts();
        if (!isMounted.current) return;
        const hosts = res?.hosts ?? [];
        setOnlineCount(res?.online_count ?? hosts.length);
        if (hosts.length >= 4) {
          const shuffled = shuffle(hosts);
          setCardHosts(shuffled);
          currentHosts.current = shuffled.slice(0, 4);
        } else if (hosts.length > 0) {
          setCardHosts(hosts);
          currentHosts.current = hosts.slice(0, Math.min(4, hosts.length));
        }
      } catch {
        // First load failure surfaces a toast; subsequent refreshes stay
        // quiet so a brief network blip doesn't spam the user.
        if (cardHosts.length === 0) {
          showErrorToast(tr.random.failedLoadHosts);
        }
      }
    };
    load();
    intervalId = setInterval(load, ONLINE_HOSTS_REFRESH_MS);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReplace = useCallback((index: number) => {
    const used = new Set(currentHosts.current.map((h) => h.id));
    const available = cardHosts.filter((h) => !used.has(h.id));
    if (available.length > 0) {
      currentHosts.current[index] = available[Math.floor(Math.random() * available.length)];
      setCardKeys((prev) => { const next = [...prev]; next[index] = prev[index] + 4; return next; });
    }
  }, [cardHosts]);

  const stopSearching = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    pollAttemptsRef.current = 0;
    setPhase("idle");
    setMatchedHost(null);
    setStatusMsg("");
    setStatusCode(undefined);
  }, []);

  // Build the request filters payload from the controlled state. Empty fields
  // are omitted so the server falls through to "any" matching.
  const buildFilterPayload = useCallback(() => {
    const payload: { gender?: "male" | "female"; min_rating?: number } = {};
    if (filters.gender !== "any") payload.gender = filters.gender;
    if (filters.minRating > 0) payload.min_rating = filters.minRating;
    return payload;
  }, [filters]);

  // Start polling for match. Each poll runs against the configured filters;
  // a hard cap prevents an idle screen from hammering the server forever.
  // Auto-connect a found match: coin gate → live availability re-check →
  // place the outgoing call in the background and navigate to the call
  // screen. Replaces the old manual "Match Found → Accept" step so a found
  // host is rung immediately. If the host became unavailable in the seconds
  // since /match/find, we transparently resume searching instead of
  // dead-ending on an overlay.
  const autoConnect = useCallback(async (host: HostCard, rate: number) => {
    if ((user?.coins ?? 0) < rate * 2) {
      setPhase("idle");
      setMatchedHost(null);
      setRequiredCoins(rate * 2);
      setShowCoinsPopup(true);
      return;
    }
    try {
      const status = await API.matchHostStatus(host.id);
      if (!isMounted.current) return;
      if (!status.available) {
        showErrorToast(
          status.code === "HOST_BUSY"
            ? tr.random.hostBusy
            : status.code === "HOST_OFFLINE"
              ? tr.random.hostOffline
              : tr.random.hostUnavailable,
        );
        setMatchedHost(null);
        startSearchingRef.current(); // resume search (no circular hook dep)
        return;
      }
    } catch {
      // Status endpoint failure — proceed optimistically; /call/initiate
      // surfaces the real error if the host is genuinely unavailable.
    }
    if (!isMounted.current) return;
    setPhase("idle");
    const avatarUri = resolveMediaUrl(host.avatar_url) || `https://api.dicebear.com/7.x/avataaars/png?seed=${host.id}`;
    initiateCall(
      { id: host.id, name: host.name, avatar: avatarUri, role: "host" },
      callType,
      rate,
    );
    router.push({
      pathname: "/user/call/outgoing",
      params: {
        hostId: host.id,
        callType,
        hostName: host.name,
        hostAvatar: avatarUri,
        specialty: host.specialties[0] ?? "",
        // Turn the outgoing screen into a random auto-dialer: on decline /
        // no-answer / Skip it rings the next matched host in place.
        isRandom: "1",
        gender: filters.gender,
        minRating: String(filters.minRating),
      },
    });
  }, [user?.coins, callType, initiateCall, tr, filters]);

  const startSearching = useCallback(() => {
    setPhase("searching");
    setMatchedHost(null);
    setStatusMsg(searchingMessageForCode(undefined, onlineCount, tr));
    setStatusCode(undefined);
    pollAttemptsRef.current = 0;

    const poll = async () => {
      if (!isMounted.current) return;
      pollAttemptsRef.current += 1;
      try {
        const res = await API.matchFind(callType, buildFilterPayload());
        if (!isMounted.current) return;

        if (typeof res.online_count === "number") setOnlineCount(res.online_count);

        if (res.matched && res.host) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          const rate = res.coins_per_minute ?? res.host?.coins_per_minute ?? 25;
          setMatchedHost(res.host);
          setAdminCoinRate(rate);
          // Show the "Connecting…" state with a short cancel window; the
          // ConnectingScreen auto-connects when its countdown completes (or the
          // user cancels). No manual Accept step.
          setPhase("connecting");
          return;
        }

        // Hard-stop conditions — more polling won't help. Each is surfaced as
        // a POPUP so the user clearly sees why the search stopped (a toast used
        // to vanish, leaving the screen looking stuck). INSUFFICIENT_COINS →
        // coin-plans sheet; the 429 family → single-button info modal.
        if (
          res.code === "INSUFFICIENT_COINS" ||
          res.code === "DAILY_LIMIT_REACHED" ||
          res.code === "DECLINE_COOLDOWN" ||
          res.code === "RATE_LIMITED"
        ) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setPhase("idle");
          setStatusCode(res.code);
          setStatusMsg(searchingMessageForCode(res.code, onlineCount, tr));
          if (res.code === "INSUFFICIENT_COINS") {
            setRequiredCoins(res.min_needed ?? adminCoinRate * 2);
            setShowCoinsPopup(true);
          } else {
            setLimitPopup(limitPopupContent(res, tr));
          }
          return;
        }

        // Soft "still searching" states — keep polling until the cap.
        setStatusMsg(searchingMessageForCode(res.code, res.online_count ?? onlineCount, tr));
        setStatusCode(res.code);

        if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setPhase("idle");
          setStatusMsg(tr.random.statusGiveUp);
          showErrorToast(tr.random.statusGiveUp);
        }
      } catch {
        if (!isMounted.current) return;
        setStatusMsg(tr.random.statusNetworkError);
        if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setPhase("idle");
          showErrorToast(tr.random.statusServerUnreachable);
        }
      }
    };

    poll(); // immediate first call
    pollRef.current = setInterval(poll, 2500);
  }, [callType, buildFilterPayload, onlineCount, adminCoinRate]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Keep the ref pointing at the latest startSearching so autoConnect (defined
  // above it) can resume searching without a circular hook dependency.
  useEffect(() => { startSearchingRef.current = startSearching; }, [startSearching]);

  // User cancelled during the connecting countdown — relay a decline (so the
  // cooldown guard counts it) and drop back to idle.
  const handleCancelConnect = useCallback(() => {
    if (matchedHost) API.matchDecline(matchedHost.id).catch(() => {});
    setMatchedHost(null);
    setPhase("idle");
  }, [matchedHost]);

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
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.userAvatarImg} />
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
            <Text style={styles.coinLabel}>{tr.random.myBalance}</Text>
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
          <Text style={styles.searchingText}>{statusMsg || tr.random.findingMatch}</Text>
        </View>
      )}

      {/* Idle status line. After a search ends with a reason (daily limit,
          cooldown, insufficient coins, gave up, etc.) we show that reason
          persistently — previously the message was only rendered during
          `searching`, so a hard-stop dropped the user back to a blank idle
          screen with no explanation. Otherwise we show the online-listener
          count so the user knows whether it's worth starting a search. */}
      {phase === "idle" && statusMsg ? (
        <View style={styles.statusPill}>
          <Text style={styles.statusPillTxt}>{statusMsg}</Text>
        </View>
      ) : phase === "idle" && onlineCount > 0 ? (
        <View style={styles.onlineCountPill}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineCountTxt}>
            {(onlineCount === 1 ? tr.random.listenerOnline : tr.random.listenersOnline).replace("{count}", String(onlineCount))}
          </Text>
        </View>
      ) : null}

      {/* Bottom Buttons */}
      <View style={[styles.bottomBtns, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.bottomChipsRow}>
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
            <Text style={styles.callTypeBtnTxt}>{callType === "audio" ? tr.random.voiceCall : tr.random.videoCall}</Text>
            <Image source={require("@/assets/icons/ic_back.png")} style={styles.dropArrow} tintColor="#111329" resizeMode="contain" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={styles.filterChip}
            activeOpacity={0.85}
            disabled={phase === "searching"}
            accessibilityLabel="Match filters"
          >
            <Text style={styles.filterChipTxt}>
              ⚙️ {filters.gender === "any" && filters.minRating === 0
                ? tr.random.filters
                : `${tr.random.filters} (${[filters.gender !== "any" ? filters.gender : null, filters.minRating > 0 ? `${filters.minRating}★+` : null].filter(Boolean).join(" · ")})`}
            </Text>
          </TouchableOpacity>
        </View>

        {phase === "searching" ? (
          <TouchableOpacity onPress={stopSearching} activeOpacity={0.85} style={styles.randomBtnWrap}>
            <View style={[styles.randomBtn, { backgroundColor: "#FF3B30", justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 8 }]}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.randomBtnTxt}>{tr.random.cancel}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={startSearching} activeOpacity={0.85} style={styles.randomBtnWrap}>
            <LinearGradient colors={GRAD} style={styles.randomBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Text style={styles.randomBtnTxt}>{tr.random.randomMatch}</Text>
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

      <FiltersDialog
        visible={filtersOpen}
        value={filters}
        onChange={setFilters}
        onClose={() => setFiltersOpen(false)}
      />

      {phase === "connecting" && matchedHost && (
        <ConnectingScreen
          host={matchedHost}
          callType={callType}
          adminCoinRate={adminCoinRate}
          onConnect={() => autoConnect(matchedHost, adminCoinRate)}
          onCancel={handleCancelConnect}
        />
      )}

      {/* Insufficient-coins sheet (coin plans + Go to Wallet). */}
      <InsufficientCoinsPopup
        visible={showCoinsPopup}
        onClose={() => setShowCoinsPopup(false)}
        requiredCoins={requiredCoins}
        currentCoins={user?.coins ?? 0}
      />

      {/* 429-family limit sheet (daily limit / decline cooldown / rate). Shows
          a live countdown + auto-enabled "Try Again" when the server provided
          a retry window. */}
      <MatchLimitSheet
        visible={!!limitPopup}
        emoji={limitPopup?.emoji ?? "ℹ️"}
        message={limitPopup?.message ?? ""}
        subtext={limitPopup?.subtext}
        retryAfterSec={limitPopup?.retryAfterSec}
        retryInTemplate={tr.random.retryIn}
        retryLabel={tr.common.retry}
        closeLabel={tr.common.ok}
        onRetry={() => { setLimitPopup(null); startSearching(); }}
        onClose={() => setLimitPopup(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  bg: { ...StyleSheet.absoluteFillObject },
  ripplePositioner: { position: "absolute", right: -170, width: 370, height: 370, alignItems: "center", justifyContent: "center" },
  // FIX: missing style — RippleRings() referenced styles.rippleContainer (TS2339).
  // Mirrors matchRippleWrap pattern: fills the parent positioner and centers the rings.
  rippleContainer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
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
  // Online listeners count pill — visible on idle to set caller expectations
  onlineCountPill: { position: "absolute", top: SH * 0.43, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.92)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#0BAF23" },
  onlineCountTxt: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  // Persistent idle status line (limit reached / cooldown / gave up). Wider +
  // centered so a full sentence wraps cleanly instead of being clipped.
  statusPill: { position: "absolute", top: SH * 0.42, alignSelf: "center", maxWidth: SW - 72, backgroundColor: "rgba(255,255,255,0.95)", paddingHorizontal: 18, paddingVertical: 11, borderRadius: 22, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  statusPillTxt: { fontSize: 12.5, fontFamily: "Poppins_500Medium", color: "#111329", textAlign: "center" },
  // Filter chip
  bottomChipsRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  filterChip: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 30, paddingVertical: 10, paddingHorizontal: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.1, shadowRadius: 18, elevation: 6 },
  filterChipTxt: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#111329" },
  // Filters sheet
  filtersSheet: { width: SW - 48, backgroundColor: "#fff", borderRadius: 26, padding: 20, gap: 8 },
  filterLabel: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#757396", textTransform: "uppercase", letterSpacing: 0.5 },
  filterChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, borderWidth: 1, borderColor: "#E0DCEB", backgroundColor: "#FAFAFC" },
  filterPillActive: { borderColor: "#8400FF", backgroundColor: "rgba(160,14,231,0.08)" },
  filterPillTxt: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#111329" },
  filterPillTxtActive: { color: "#8400FF", fontFamily: "Poppins_700Bold" },
  filtersFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18 },
  filtersResetBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  filtersResetTxt: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#757396" },
  filtersDoneBtn: { flex: 1, marginLeft: 12 },
  filtersDoneBtnInner: { paddingVertical: 12, borderRadius: 22, alignItems: "center" },
  filtersDoneTxt: { color: "#fff", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
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
  connectingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  connectingTxt: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: "#8400FF" },
  connectCancelBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16,
    backgroundColor: "#FF4D5E", paddingHorizontal: 22, paddingVertical: 11, borderRadius: 999,
    shadowColor: "#FF4D5E", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  connectCancelIco: { width: 18, height: 18 },
  connectCancelTxt: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#fff", letterSpacing: 0.3 },
  matchBtns: { flexDirection: "row", gap: 24, marginTop: 12 },
  matchBtnItem: { alignItems: "center", gap: 8 },
  matchBtnLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "#111329" },
  matchDecline: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#FF025F", alignItems: "center", justifyContent: "center" },
  matchSkip: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#7C7C8A", alignItems: "center", justifyContent: "center" },
  matchAccept: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  matchBtnIco: { width: 28, height: 28 },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
