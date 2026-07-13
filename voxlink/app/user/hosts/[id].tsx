import React, { useState, useEffect, useCallback } from "react";
import { confirmDialog, alertDialog } from "@/utils/dialog";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  Dimensions,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Linking,
  useColorScheme,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { useChat } from "@/context/ChatContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import { InsufficientCoinsPopup } from "@/components/InsufficientCoinsPopup";

const { width: SW, height: SH } = Dimensions.get("window");
// Fixed hero height so the cover-media carousel + overlaid profile info have a
// stable canvas (the old hero used minHeight which can't host a paged carousel).
const HERO_H = Math.round(SH * 0.46);

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

/** "21:00" → "9:00 PM". Returns null for empty/invalid input. */
function formatTime12(hhmm?: string | null): string | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [hStr, m] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

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

/* ─── Hero media cover — swipeable gallery photos / videos behind the
   profile header. Falls back to the brand gradient when the host has no
   media. ─── */
function HeroMediaCover({ media, onOpen, topOffset }: { media: { url: string; type: string }[]; onOpen: (u: string, t: string) => void; topOffset: number }) {
  const [idx, setIdx] = useState(0);
  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / SW))}
      >
        {media.map((m, i) => (
          <TouchableOpacity key={i} activeOpacity={0.95} onPress={() => onOpen(m.url, m.type)} style={{ width: SW, height: HERO_H }}>
            {m.type === "video" ? (
              <View style={s.coverVideo}>
                <View style={s.coverPlayBadge}><Text style={s.coverPlayGlyph}>▶</Text></View>
              </View>
            ) : (
              <Image source={{ uri: resolveMediaUrl(m.url) || m.url }} style={{ width: SW, height: HERO_H }} resizeMode="cover" />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
      {media.length > 1 && (
        <View style={[s.coverDots, { top: topOffset }]} pointerEvents="none">
          {media.map((_, i) => <View key={i} style={[s.coverDot, i === idx && s.coverDotActive]} />)}
        </View>
      )}
    </View>
  );
}

/* ─── Talk Now bottom sheet ─── */
function TalkNowSheet({
  visible, host, onClose, onAudio, onVideo, freeMinutes = 0,
}: {
  visible: boolean;
  host: any;
  onClose: () => void;
  onAudio: () => void;
  onVideo: () => void;
  freeMinutes?: number;
}) {
  const audioRate = host?.audio_coins_per_minute ?? host?.coinsPerMinute ?? 25;
  const videoRate = host?.video_coins_per_minute ?? (audioRate + 5);
  const colors = useColors();
  const { t } = useLanguage();
  const isDark = useColorScheme() === "dark";
  const boxBg = isDark ? colors.card : "#fff";
  const txtColor = isDark ? colors.text : "#111329";
  const dividerColor = isDark ? colors.border : "#eee";
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={sht.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[sht.box, { backgroundColor: boxBg }]}>
          <View style={sht.handle} />
          <Text style={[sht.title, { color: txtColor, borderBottomColor: dividerColor }]}>{t.hostDetail.selectCallType}</Text>

          {freeMinutes > 0 && (
            <View style={sht.freeHint}>
              <Text style={sht.freeHintText}>🎁 Your first {freeMinutes} {freeMinutes === 1 ? "minute" : "minutes"} are FREE</Text>
            </View>
          )}

          <TouchableOpacity onPress={onAudio} style={sht.row} activeOpacity={0.8}>
            <Image source={require("@/assets/icons/ic_call_gradient.png")} style={sht.ico} resizeMode="contain" />
            <Text style={[sht.label, { color: txtColor }]}>{t.hosts.audioCall}</Text>
            <View style={sht.chip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={sht.chipIco} resizeMode="contain" />
              <Text style={sht.chipTxt}>{t.hostDetail.coinPerMin.replace("{count}", String(audioRate))}</Text>
            </View>
          </TouchableOpacity>

          <View style={[sht.divider, { backgroundColor: dividerColor }]} />

          <TouchableOpacity onPress={onVideo} style={sht.row} activeOpacity={0.8}>
            <Image source={require("@/assets/icons/ic_video_gradient.png")} style={sht.ico} resizeMode="contain" />
            <Text style={[sht.label, { color: txtColor }]}>{t.hosts.videoCall}</Text>
            <View style={sht.chip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={sht.chipIco} resizeMode="contain" />
              <Text style={sht.chipTxt}>{t.hostDetail.coinPerMin.replace("{count}", String(videoRate))}</Text>
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
  const colors = useColors();
  const { t } = useLanguage();
  // Dark-mode theming: keep the branded LIGHT look exactly as-is in light mode
  // (isDark === false → original Flutter-matched constants), and swap surfaces
  // + text to palette tokens in dark mode so the screen isn't a wall of white.
  const isDark = useColorScheme() === "dark";
  const screenBg = isDark ? colors.background : "#fff";
  const infoBg = isDark ? colors.card : INFO_BG;
  const cardBg = isDark ? colors.surface : CARD_BG;
  const cardBorder = isDark ? colors.border : BORDER;
  const reviewBg = isDark ? colors.surface : REVIEW_BG;
  const reviewBorder = isDark ? colors.border : REVIEW_BORDER;
  const titleColor = isDark ? colors.text : "#111329";
  const subColor = isDark ? colors.mutedForeground : PROFILE_LANG;
  const bioColor = isDark ? colors.mutedForeground : PROFILE_TEXT;
  const barBg = isDark ? colors.card : "#fff";
  const sheetBg = isDark ? colors.card : "#fff";
  const dottedBorder = isDark ? colors.border : "#111329";
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const { getOrCreateConversation } = useChat();
  const queryClient = useQueryClient();
  const [talkSheet, setTalkSheet] = useState(false);
  const [coinPopup, setCoinPopup] = useState(false);
  const [coinPopupRequired, setCoinPopupRequired] = useState(0);
  const [reportModal, setReportModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // M1: consume the ['host', id] cache the home screen prefetches on tap, so
  // opening a profile is instant (no spinner on a warm cache) + cached.
  const { data: host, isLoading: loading } = useQuery({
    queryKey: ['host', id],
    queryFn: () => API.getHost(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
  const { data: reviews = [] } = useQuery<any[]>({
    queryKey: ['host-reviews', id],
    queryFn: () => API.getHostReviews(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
  const { data: chatUnlocked = false } = useQuery({
    queryKey: ['chat-status', id],
    queryFn: async () => { try { const sN = await API.getChatStatus(id!); return !!(sN as any)?.unlocked; } catch { return false; } },
    enabled: !!id,
    staleTime: 30_000,
  });
  // Data-driven "usually online" hint (smart availability-prediction engine).
  // A probability from the host's history — shown only when they're OFFLINE
  // (live status wins when online). DEFAULT OFF server-side → { enabled:false }.
  const { data: availability } = useQuery({
    queryKey: ['host-availability', id],
    queryFn: async () => { try { return await API.getHostAvailability(id!); } catch { return null; } },
    enabled: !!id,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  // Highlight gallery (photos / videos the host uploaded). Public endpoint.
  const { data: gallery = [] } = useQuery<any[]>({
    queryKey: ['host-gallery', id],
    queryFn: () => API.getHostGallery(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
  // Full-screen image viewer target (null = closed). Videos open externally.
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  // H3: favorite state derived from the favorites list, mirrored into local
  // state so the heart toggles instantly (optimistic) before the server round-trip.
  const { data: serverIsFavorite = false } = useQuery({
    queryKey: ['favorite-status', id],
    queryFn: async () => {
      // Lightweight single-row check — no longer downloads the whole list.
      try { const r = await API.isFavorite(id); return !!r?.favorite; }
      catch { return false; }
    },
    enabled: !!id,
    staleTime: 30_000,
  });
  const [isFavorite, setIsFavorite] = useState(false);
  useEffect(() => { setIsFavorite(serverIsFavorite); }, [serverIsFavorite]);

  // Caller's free-trial minutes — used to show "first X min free" before a call.
  // Shares the home screen's cache key so it stays in sync.
  const { data: freeMinutes = 0 } = useQuery({
    queryKey: ['free-call-minutes-balance'],
    queryFn: async () => { try { const me: any = await API.me(); return Number(me?.free_call_minutes ?? 0) || 0; } catch { return 0; } },
    staleTime: 60_000,
  });

  const toggleFavorite = useCallback(async () => {
    if (!id) return;
    const next = !isFavorite;
    setIsFavorite(next); // optimistic
    try {
      if (next) await API.addFavorite(id); else await API.removeFavorite(id);
      // Keep the home "Your favorites" rail + this screen's status in sync.
      queryClient.invalidateQueries({ queryKey: ['favorite-hosts'] });
      queryClient.invalidateQueries({ queryKey: ['favorite-status', id] });
    } catch (e: any) {
      setIsFavorite(!next); // revert on failure — the reverted heart is the feedback
      // Surface actionable server errors (favorites cap / rate limit) when
      // ADDING. Transient network blips stay silent — the reverted heart says it.
      const msg = String(e?.message || '');
      if (next && /favorite up to|too many/i.test(msg)) showErrorToast(msg);
    }
  }, [id, isFavorite, queryClient]);

  // H4: live presence — if this host's online status flips while the profile is
  // open, patch the cached host so the "Talk Now" button enables/disables
  // immediately (the screen used to show stale status until re-opened).
  useSocketEvent(
    SocketEvents.PRESENCE_UPDATE,
    (data: any) => {
      // SocketService emits camelCase `hostId` (= hosts.id). Accept snake_case too.
      const hid = data?.hostId ?? data?.host_id;
      if (!hid || hid !== id) return;
      const online = !!(data?.isOnline ?? data?.is_online);
      queryClient.setQueryData(['host', id], (old: any) => (old ? { ...old, is_online: online } : old));
    },
    [id, queryClient],
  );

  // M2: pull-to-refresh re-pulls host, reviews, chat-unlock + favorite status.
  const onRefresh = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['host', id] }),
        queryClient.invalidateQueries({ queryKey: ['host-reviews', id] }),
        queryClient.invalidateQueries({ queryKey: ['chat-status', id] }),
        queryClient.invalidateQueries({ queryKey: ['favorite-status', id] }),
        queryClient.invalidateQueries({ queryKey: ['host-gallery', id] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [id, queryClient]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!host) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <Text style={{ color: colors.text, fontFamily: "Poppins_500Medium" }}>{t.hostDetail.notFound}</Text>
      </View>
    );
  }

  /* ─── Derived fields ─── */
  const hostName = host.display_name || host.name || t.hosts.host;
  const hostAvatar = resolveMediaUrl(host.avatar_url) || `https://api.dicebear.com/7.x/avataaars/png?seed=${host.id}`;
  const uniqueId = `VX${String(host.id).slice(-6).padStart(6, "0")}`;
  const callCount = host.total_minutes ? Math.floor(host.total_minutes / 30) : host.review_count * 2;
  const experience = `${Math.max(1, Math.floor((host.total_minutes ?? 0) / 5000))}+`;
  const audioRate: number = host.audio_coins_per_minute ?? host.coins_per_minute ?? 25;
  const videoRate: number = host.video_coins_per_minute ?? audioRate + 5;
  // Prefer the server's admin-configured level_info (single source of truth);
  // fall back to the local map only if the API is on an older build.
  const level: number = host.level_info?.level ?? host.level ?? 1;
  const levelInfo = host.level_info ?? LEVEL_CONFIG[level] ?? LEVEL_CONFIG[1];
  // Intro video (hosts.intro_video_url). Resolved to an absolute media URL.
  const introVideoUrl: string | null = host.intro_video_url
    ? (resolveMediaUrl(host.intro_video_url) || host.intro_video_url)
    : null;

  // Open a gallery item: images go to the in-app full-screen viewer; videos
  // open in the device's player/browser (no bundled video component needed,
  // so it works identically on web + native).
  const openMedia = (url: string, type: string) => {
    const full = resolveMediaUrl(url) || url;
    if (type === "video") { Linking.openURL(full).catch(() => {}); }
    else { setViewerImage(full); }
  };

  // Media shown in the hero cover carousel: intro video first (if any), then
  // gallery photos/videos. Empty → hero falls back to the brand gradient.
  const coverMedia: { url: string; type: string }[] = [
    ...(introVideoUrl ? [{ url: introVideoUrl, type: "video" }] : []),
    ...gallery.map((g: any) => ({ url: g.media_url, type: g.media_type || "image" })),
  ];

  // Availability window (host-set schedule). Shown only when a real window is
  // configured; "always available" hosts clear both fields → no chip.
  const availFrom = formatTime12(host.available_from);
  const availTo = formatTime12(host.available_to);
  const tzShort = host.timezone ? String(host.timezone).split("/").pop()?.replace(/_/g, " ") : null;
  const scheduleText = availFrom && availTo ? `${availFrom} – ${availTo}${tzShort ? ` · ${tzShort}` : ""}` : null;

  /* ─── Handlers ─── */
  const checkCoins = (rate: number) => {
    if ((user?.coins ?? 0) < rate * 2) {
      setCoinPopupRequired(rate * 2);
      setCoinPopup(true);
      return false;
    }
    return true;
  };

  const handleAudio = () => {
    setTalkSheet(false);
    if (!checkCoins(audioRate)) return;
    const topics = Array.isArray(host.topics) ? host.topics : (host.topics ? String(host.topics).split(",") : []);
    initiateCall({ id: host.id, name: hostName, avatar: hostAvatar, role: "host" }, "audio", audioRate);
    router.push({ pathname: "/user/call/outgoing", params: { hostId: host.id, callType: "audio", hostName, hostAvatar, specialty: topics[0] ?? "" } });
  };

  const handleVideo = () => {
    setTalkSheet(false);
    if (!checkCoins(videoRate)) return;
    const topics = Array.isArray(host.topics) ? host.topics : (host.topics ? String(host.topics).split(",") : []);
    initiateCall({ id: host.id, name: hostName, avatar: hostAvatar, role: "host" }, "video", videoRate);
    router.push({ pathname: "/user/call/outgoing", params: { hostId: host.id, callType: "video", hostName, hostAvatar, specialty: topics[0] ?? "" } });
  };

  const handleChat = async () => {
    if (!chatUnlocked) {
      confirmDialog({
        title: t.hostDetail.chatLockedTitle,
        message: t.hostDetail.chatLockedMsg.replace("{name}", hostName),
        confirmText: t.hosts.callNow,
        onConfirm: () => {
          if (host.is_online) setTalkSheet(true);
          else alertDialog(t.hosts.offline, t.hostDetail.offlineMsg.replace("{name}", hostName));
        },
      });
      return;
    }
    try {
      const room = await API.createChatRoom(host.id);
      // Pass the freshly-fetched online state + host_user_id so the chat
      // header has correct presence on first render — without this it would
      // briefly show "Offline" until the chat list refresh / next presence
      // event arrives.
      getOrCreateConversation(host.id, hostName, hostAvatar, room.id, {
        participantUserId: host.user_id,
        isOnline: !!host.is_online,
      });
      router.push(`/user/chat/${room.id}`);
    } catch (e: any) {
      if (e.message?.includes("CHAT_LOCKED") || e.message?.includes("locked")) {
        alertDialog(t.hostDetail.chatLockedTitle, t.hostDetail.chatLockedMsg2);
      } else {
        getOrCreateConversation(host.id, hostName, hostAvatar, undefined, {
          participantUserId: host.user_id,
          isOnline: !!host.is_online,
        });
        router.push(`/user/chat/${host.id}`);
      }
    }
  };

  const copyId = async () => {
    try {
      await Clipboard.setStringAsync(uniqueId);
      showSuccessToast(t.hostDetail.idCopied, t.common.copied);
    } catch {
      // Clipboard write can fail on some web/permission contexts — non-fatal.
    }
  };

  const handleReport = async (reason: string, category: string) => {
    try {
      await API.submitReport({ reported_user_id: host.user_id || host.id, reported_user: hostName, reason, category, reported_type: "host" });
      showSuccessToast(t.hostDetail.reportThanks, t.hostDetail.reportSubmitted);
    } catch (err: any) {
      const msg = err?.message || t.hostDetail.reportFailMsg;
      showErrorToast(msg, t.hostDetail.reportFailed);
    }
  };

  const statsList = [
    { image: require("@/assets/icons/ic_call_gradient.png"), title: t.hostDetail.totalCall, count: String(callCount) },
    { image: require("@/assets/icons/ic_star.png"), title: t.hosts.rating, count: (host.rating ?? 0).toFixed(1) },
    { image: require("@/assets/icons/ic_experience.png"), title: t.hostDetail.experience, count: experience },
  ];

  const BOTTOM_H = insets.bottom + 70;

  return (
    <View style={[s.root, { backgroundColor: screenBg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: BOTTOM_H + 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {/* ══════ TopImageView — gradient hero + centered avatar ══════ */}
        <View style={s.hero}>
          {/* Cover: swipeable gallery photos/videos, or the brand gradient
              when the host has no media yet. */}
          {coverMedia.length > 0 ? (
            <HeroMediaCover media={coverMedia} onOpen={openMedia} topOffset={insets.top + 56} />
          ) : (
            <LinearGradient colors={COVER_GRAD} style={StyleSheet.absoluteFill} />
          )}
          {/* Dark scrim keeps the overlaid avatar / name / rating readable over
              bright photos. */}
          <LinearGradient
            colors={["rgba(17,19,41,0.20)", "rgba(17,19,41,0.45)", "rgba(17,19,41,0.92)"]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* box-none → empty areas pass touches to the cover carousel below so
              it stays swipeable, while the buttons still receive taps. */}
          <View style={[StyleSheet.absoluteFill, s.heroContent, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          {/* Back button + Favorite + Report */}
          <View style={s.heroTopRow}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Go back">
              <Image
                source={require("@/assets/icons/ic_back.png")}
                style={s.backIco}
                tintColor="#fff"
                resizeMode="contain"
              />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={toggleFavorite}
                style={s.reportBtn}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={isFavorite ? `Remove ${hostName} from favorites` : `Add ${hostName} to favorites`}
              >
                <Text style={{ fontSize: 17 }}>{isFavorite ? "❤️" : "🤍"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setReportModal(true)}
                style={s.reportBtn}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Report ${hostName}`}
              >
                <Image source={require("@/assets/icons/ic_flag.png")} style={{ width: 18, height: 18, tintColor: "#fff" }} resizeMode="contain" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Centered avatar */}
          <View style={s.heroCenterCol}>
            <View style={s.heroDotBorder}>
              <Image source={{ uri: hostAvatar }} style={s.heroAvatar} resizeMode="cover" />
            </View>
            {/* Level badge */}
            <View style={[s.levelBadge, { backgroundColor: levelInfo.color + "33", borderColor: levelInfo.color }]}>
              <Text style={s.levelBadgeEmoji}>{levelInfo.badge}</Text>
              <Text style={[s.levelBadgeTxt, { color: levelInfo.color }]}>{t.hostDetail.levelShort}{level} {levelInfo.name}</Text>
            </View>
            <Text style={s.heroName}>{hostName}</Text>
            <View style={s.heroRatingRow}>
              <Image source={require("@/assets/icons/ic_star.png")} style={{ width: 16, height: 16 }} tintColor={STAR_COLOR} resizeMode="contain" />
              <Text style={s.heroRatingTxt}>{(host.rating ?? 0).toFixed(1)} ({t.reviews.reviewsCount.replace("{count}", String(host.review_count ?? 0))})</Text>
            </View>
            <View style={[s.heroStatusPill, { backgroundColor: host.is_online ? "rgba(11,175,35,0.92)" : "rgba(255,255,255,0.18)" }]}>
              <View style={[s.heroStatusDot, { backgroundColor: host.is_online ? "#fff" : "#CBCBD4" }]} />
              <Text style={s.heroStatusTxt}>{host.is_online ? t.hosts.online : t.hosts.offline}</Text>
            </View>
            {/* Predicted-availability hint — offline hosts only, best-effort */}
            {!host.is_online && availability?.enabled && availability.label ? (
              <Text style={{ marginTop: 6, fontSize: 12, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.85)", textAlign: "center" }}>
                {availability.label}
              </Text>
            ) : null}
          </View>
          </View>
        </View>

        {/* ══════ UserProfileInfoView ══════ */}
        <View style={[s.infoCard, { backgroundColor: infoBg }]}>
          <View style={s.infoTopRow}>
            {/* Avatar dotted (small, 50x50) */}
            <View style={[s.infoDotBorder, { borderColor: dottedBorder }]}>
              <View style={s.infoAvatarCircle}>
                <Image source={{ uri: hostAvatar }} style={s.infoAvatarImg} resizeMode="cover" />
              </View>
            </View>

            {/* Name + status + ID */}
            <View style={s.infoMid}>
              <Text style={[s.infoName, { color: titleColor }]} numberOfLines={1}>{hostName}</Text>
              <View style={s.statusRow}>
                {/* Status pill */}
                <View style={[s.statusPill, { backgroundColor: host.is_online ? GREEN : "#EDEDEF" }]}>
                  <View style={[s.dotOuter, { backgroundColor: host.is_online ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.08)" }]}>
                    <View style={[s.dotInner, { backgroundColor: host.is_online ? "#fff" : PROFILE_LANG }]} />
                  </View>
                  <Text style={[s.statusTxt, { color: host.is_online ? "#fff" : PROFILE_LANG }]}>
                    {host.is_online ? t.hosts.online : t.hosts.offline}
                  </Text>
                </View>
                {/* ID chip */}
                <TouchableOpacity onPress={copyId} style={s.idChip} activeOpacity={0.7}>
                  <Text style={s.idTxt} numberOfLines={1}>{t.hostDetail.idLabel} {uniqueId}</Text>
                  <Image source={require("@/assets/icons/ic_copy.png")} style={s.copyIco} tintColor={ID_TXT} resizeMode="contain" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Coin rate chip */}
            <View style={s.coinChip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={s.coinChipIco} resizeMode="contain" />
              <Text style={s.coinChipTxt}>{t.hostDetail.coin.replace("{count}", String(audioRate))}</Text>
            </View>
          </View>

          {/* Bio */}
          <Text style={[s.bioTxt, { color: bioColor }]}>{host.bio}</Text>

          {/* Language */}
          <View style={s.langRow}>
            <Image source={require("@/assets/icons/ic_language.png")} style={s.langIco} resizeMode="contain" />
            <Text style={[s.langLabel, { color: subColor }]}>{t.hostDetail.languageColon}</Text>
            <Text style={[s.langVal, { color: titleColor }]} numberOfLines={2}>{(host.languages ?? []).join(", ")}</Text>
          </View>

          {/* Availability window (host-set schedule) */}
          {scheduleText ? (
            <View style={s.scheduleRow}>
              <Text style={s.scheduleClock}>🕒</Text>
              <Text style={[s.scheduleTxt, { color: subColor }]} numberOfLines={1}>{scheduleText}</Text>
            </View>
          ) : null}

          {/* Topics */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.topicsContent}
            style={s.topicsScroll}
          >
            {(host.specialties ?? []).map((sp: string) => (
              <View key={sp} style={[s.topicTag, { backgroundColor: cardBg }]}>
                <Text style={[s.topicTxt, { color: subColor }]}>{sp}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ══════ Highlights — host gallery photos / videos + intro video ══════ */}
        {(introVideoUrl || gallery.length > 0) && (
          <View style={s.highlightsSec}>
            <Text style={[s.highlightsTitle, { color: titleColor }]}>{t.hostDetail.highlights}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.highlightsRow}
            >
              {introVideoUrl ? (
                <TouchableOpacity
                  onPress={() => openMedia(introVideoUrl, "video")}
                  style={s.highlightCard}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t.hostDetail.introVideo}
                >
                  <LinearGradient colors={COVER_GRAD} style={s.highlightMedia}>
                    <View style={s.playBadge}>
                      <Text style={s.playGlyph}>▶</Text>
                    </View>
                  </LinearGradient>
                  <Text style={[s.highlightCaption, { color: subColor }]} numberOfLines={1}>{t.hostDetail.introVideo}</Text>
                </TouchableOpacity>
              ) : null}

              {gallery.map((g: any) => (
                <TouchableOpacity
                  key={g.id}
                  onPress={() => openMedia(g.media_url, g.media_type)}
                  style={s.highlightCard}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={g.caption || (g.media_type === "video" ? "Play video" : "View photo")}
                >
                  {g.media_type === "video" ? (
                    <View style={[s.highlightMedia, { backgroundColor: "#111329", alignItems: "center", justifyContent: "center" }]}>
                      <View style={s.playBadge}>
                        <Text style={s.playGlyph}>▶</Text>
                      </View>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: resolveMediaUrl(g.media_url) || g.media_url }}
                      style={s.highlightMedia}
                      resizeMode="cover"
                    />
                  )}
                  {g.caption ? <Text style={[s.highlightCaption, { color: subColor }]} numberOfLines={1}>{g.caption}</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ══════ StatusView — 3 stat boxes ══════ */}
        <View style={s.statsRow}>
          {statsList.map((item, i) => (
            <View key={i} style={[s.statBox, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <Image source={item.image} style={s.statIco} resizeMode="contain" />
              <Text style={[s.statLbl, { color: subColor }]}>{item.title}</Text>
              <Text style={[s.statVal, { color: titleColor }]}>{item.count}</Text>
            </View>
          ))}
        </View>

        {/* ══════ ReviewShow ══════ */}
        <View style={s.reviewSec}>
          <View style={s.reviewHeader}>
            <Text style={[s.reviewHeaderTxt, { color: titleColor }]}>{t.hosts.reviews}</Text>
            {(host.review_count ?? reviews.length) > 0 && (
              <TouchableOpacity
                onPress={() => router.push({
                  pathname: "/user/hosts/reviews",
                  params: {
                    hostId: String(host.id),
                    hostRating: String(host.rating ?? 0),
                    hostReviewCount: String(host.review_count ?? reviews.length),
                  },
                })}
                accessibilityRole="button"
                accessibilityLabel="View all reviews"
              >
                <Text style={[s.viewAllTxt, { color: subColor }]}>{t.home.viewAll}</Text>
              </TouchableOpacity>
            )}
          </View>

          {reviews.length === 0 && (
            <Text style={{ color: subColor, fontFamily: "Poppins_400Regular", fontSize: 13, textAlign: "center", paddingVertical: 16 }}>
              {t.reviews.noReviews}
            </Text>
          )}

          {reviews.slice(0, 5).map((r: any, i: number) => (
            <View key={r.id ?? i} style={[s.reviewCard, { backgroundColor: reviewBg, borderColor: reviewBorder }]}>
              <View style={s.reviewTop}>
                <View style={[s.reviewDot, { borderColor: dottedBorder }]}>
                  <View style={s.reviewAvatarCircle}>
                    <Image
                      source={{ uri: resolveMediaUrl(r.avatar_url) ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${r.user_id ?? i}` }}
                      style={s.reviewAvatarImg}
                    />
                  </View>
                </View>
                <View style={s.reviewInfo}>
                  <Text style={[s.reviewName, { color: titleColor }]}>{r.name ?? t.reviews.user}</Text>
                  <StarRating rating={r.stars ?? r.rating ?? 5} size={16} />
                </View>
                <View style={s.timeBadge}>
                  <Text style={s.timeTxt}>{r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : t.hostDetail.recent}</Text>
                </View>
              </View>
              {r.comment ? <Text style={[s.reviewTxt, { color: subColor }]}>{r.comment}</Text> : null}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ══════ ProfileBottomButtonView ══════ */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10, backgroundColor: barBg }]}>
        <TouchableOpacity onPress={handleChat} style={[s.bottomBtn, { backgroundColor: chatUnlocked ? GREEN : "#9CA3AF" }]} activeOpacity={0.85}>
          <Text style={s.bottomBtnTxt}>{chatUnlocked ? t.hostDetail.chatNow : t.hostDetail.chatLocked}</Text>
        </TouchableOpacity>

        {host.is_online ? (
          <TouchableOpacity onPress={() => setTalkSheet(true)} style={[s.bottomBtn, { backgroundColor: APP_COLOR }]} activeOpacity={0.85}>
            <Image source={require("@/assets/icons/ic_call_gradient.png")} style={s.talkIco} tintColor="#fff" resizeMode="contain" />
            <Text style={s.bottomBtnTxt}>{t.hosts.talkNow}</Text>
          </TouchableOpacity>
        ) : (
          <View style={[s.bottomBtn, { backgroundColor: "#D1D5DB" }]}>
            <Text style={[s.bottomBtnTxt, { color: "#6B7280" }]}>{t.hosts.offline}</Text>
          </View>
        )}
      </View>

      <TalkNowSheet
        visible={talkSheet}
        host={{ ...host, coinsPerMinute: audioRate }}
        freeMinutes={freeMinutes}
        onClose={() => setTalkSheet(false)}
        onAudio={handleAudio}
        onVideo={handleVideo}
      />

      <InsufficientCoinsPopup
        visible={coinPopup}
        freeMinutes={freeMinutes}
        onClose={() => setCoinPopup(false)}
        requiredCoins={coinPopupRequired}
        currentCoins={user?.coins ?? 0}
      />

      {/* Full-screen image viewer for gallery photos. */}
      <Modal visible={!!viewerImage} transparent animationType="fade" onRequestClose={() => setViewerImage(null)}>
        <TouchableOpacity style={s.viewerOverlay} activeOpacity={1} onPress={() => setViewerImage(null)}>
          {viewerImage ? <Image source={{ uri: viewerImage }} style={s.viewerImg} resizeMode="contain" /> : null}
          <View style={s.viewerClose}>
            <Image source={require("@/assets/icons/ic_close.png")} style={{ width: 22, height: 22, tintColor: "#fff" }} resizeMode="contain" />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={reportModal} transparent animationType="slide" onRequestClose={() => setReportModal(false)}>
        <TouchableOpacity style={s.reportOverlay} activeOpacity={1} onPress={() => setReportModal(false)}>
          <View style={[s.reportSheet, { backgroundColor: sheetBg }]}>
            <View style={s.reportHandle} />
            <Text style={[s.reportTitle, { color: titleColor }]}>{t.hostDetail.reportTitle.replace("{name}", hostName)}</Text>
            <Text style={s.reportSubtitle}>{t.hostDetail.reportSubtitle}</Text>
            {[
              { label: t.hostDetail.reportInappropriate, reason: "Inappropriate Content", category: "inappropriate_content" },
              { label: t.hostDetail.reportHarassment, reason: "Harassment or Bullying", category: "harassment" },
              { label: t.hostDetail.reportFakeProfile, reason: "Fake or Misleading Profile", category: "fake_profile" },
              { label: t.hostDetail.reportScam, reason: "Scam or Fraudulent Activity", category: "fraud" },
              { label: t.hostDetail.reportSpam, reason: "Spamming or Unsolicited Messages", category: "spam" },
            ].map((opt) => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => { setReportModal(false); handleReport(opt.reason, opt.category); }}
                style={[s.reportOption, { borderBottomColor: cardBorder }]}
                activeOpacity={0.7}
              >
                <Text style={[s.reportOptionTxt, { color: titleColor }]}>{opt.label}</Text>
                <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 16, height: 16, tintColor: "#9CA3AF", transform: [{ rotate: "180deg" }] }} resizeMode="contain" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setReportModal(false)} style={s.reportCancel} activeOpacity={0.8}>
              <Text style={s.reportCancelTxt}>{t.common.cancel}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

/* ═══════════════════ STYLES ═══════════════════ */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },

  /* ── Hero / cover ── */
  hero: {
    width: SW,
    height: HERO_H,
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    justifyContent: "space-between",
  },
  // Cover carousel
  coverVideo: { width: SW, height: HERO_H, backgroundColor: "#1A1140", alignItems: "center", justifyContent: "center" },
  coverPlayBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" },
  coverPlayGlyph: { fontSize: 26, color: "#111329", marginLeft: 4 },
  coverDots: { position: "absolute", alignSelf: "center", flexDirection: "row", gap: 6 },
  coverDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.45)" },
  coverDotActive: { width: 18, backgroundColor: "#fff" },
  heroTopRow: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  reportBtn: {
    width: 36, height: 36, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
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
  heroStatusPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, marginTop: 8 },
  heroStatusDot: { width: 7, height: 7, borderRadius: 4 },
  heroStatusTxt: { fontSize: 11, fontFamily: "Poppins_600SemiBold", color: "#fff" },
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

  /* availability schedule */
  scheduleRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 8 },
  scheduleClock: { fontSize: 14 },
  scheduleTxt: { fontSize: 13, fontFamily: "Poppins_500Medium", color: PROFILE_LANG },

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

  /* ── Highlights (gallery) ── */
  highlightsSec: { paddingHorizontal: 16, paddingTop: 14, gap: 10 },
  highlightsTitle: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  highlightsRow: { gap: 10, paddingRight: 16 },
  highlightCard: { width: 110, gap: 5 },
  highlightMedia: { width: 110, height: 150, borderRadius: 14, backgroundColor: "#EEE", overflow: "hidden" },
  playBadge: {
    position: "absolute", top: "50%", left: "50%", marginTop: -20, marginLeft: -20,
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center", justifyContent: "center",
  },
  playGlyph: { fontSize: 16, color: "#111329", marginLeft: 2 },
  highlightCaption: { fontSize: 11, fontFamily: "Poppins_500Medium" },

  /* ── Image viewer ── */
  viewerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerImg: { width: SW, height: SH * 0.8 },
  viewerClose: { position: "absolute", top: 50, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },

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

  reportOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" } as any,
  reportSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 32 } as any,
  reportHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E0E0E0", alignSelf: "center" as const, marginTop: 12, marginBottom: 16 },
  reportTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: "#111329", textAlign: "center" as const },
  reportSubtitle: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#9CA3AF", textAlign: "center" as const, marginTop: 4, marginBottom: 16 },
  reportOption: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#F0F0F0" },
  reportOptionTxt: { fontSize: 15, fontFamily: "Poppins_500Medium", color: "#111329" },
  reportCancel: { marginTop: 12, paddingVertical: 14, alignItems: "center" as const, backgroundColor: "#F3F4F6", borderRadius: 12 },
  reportCancelTxt: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: "#6B7280" },
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
  freeHint: { backgroundColor: "#E6F9EA", borderWidth: 1, borderColor: "#0BAF2333", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 12, marginBottom: 2 },
  freeHintText: { color: "#0B8F1C", fontSize: 13, fontFamily: "Poppins_700Bold", textAlign: "center" },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
