import React, { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Image,
  Dimensions,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { HostCard } from "@/components/HostCard";
import { InsufficientCoinsPopup } from "@/components/InsufficientCoinsPopup";
import { SkeletonHostCard, SkeletonHostCardCompact } from "@/components/SkeletonCard";
import { Host } from "@/data/mockData";
import { API, resolveMediaUrl } from "@/services/api";
import { openBannerLink } from "@/utils/bannerLink";
import PromoBannerCard from "@/components/PromoBannerCard";
import { fetchAppConfig } from "@/hooks/useAppConfig";
import { logEngagement, logImpressionOnce } from "@/services/engagement";
import { RefreshControl } from "react-native";

const SCREEN_W = Dimensions.get("window").width;
const BANNER_W = SCREEN_W - 32;
const AUTO_SLIDE_INTERVAL = 3500;
// P3: below this coin balance we surface a top-up nudge (≈ can't comfortably
// afford a couple of minutes at a typical rate). Kept in sync conceptually with
// AuthContext's low-coin alert threshold.
const LOW_BALANCE_THRESHOLD = 20;
// How often the home host list re-shuffles its order + how often it pulls a
// fresh list. Re-ordering on a timer keeps the "available now" list feeling
// live (different hosts surface to the top over time) instead of a static
// arrangement; the data refresh keeps online status current.
const ROTATE_INTERVAL_MS = 9000;
const REFRESH_EVERY_N_TICKS = 4; // ~36s → invalidate the hosts query

// ---------------------------------------------------------------------------
// Host ranking algorithm
// ---------------------------------------------------------------------------
// The home "available now" list used to be a pure Fisher-Yates shuffle keyed by
// the rotation tick. That gave a "live" rotating feel, but it also buried the
// best listeners at random — a proven 4.9★/200-review host could land at the
// bottom while a brand-new 5.0★/1-review host floated to the top. That's bad for
// both users (worse matches surfaced first) and good hosts (lost visibility).
//
// We replace it with a weighted composite score:
//   • Bayesian-smoothed rating  — a lone 5★ doesn't outrank a proven high rating
//   • log-scaled popularity     — total minutes talked, diminishing returns
//   • top-rated bonus           — small editorial boost for flagged hosts
//   • affordability nudge        — softly demote hosts the viewer can't afford a
//                                  minute of (avoids leading them into a top-up wall)
//   • deterministic tick jitter  — a bounded per-(host,tick) wobble so near-equal
//                                  hosts gently rotate positions over time
//                                  (fairness for newer hosts + the "live" feel)
// The jitter band is small relative to the quality signal, so ordering stays
// stable/quality-first while still visibly rotating among comparable hosts.

// Global prior for the Bayesian average (a sensible platform-wide mean) and the
// confidence weight — how many reviews a host needs before their own average
// dominates the prior instead of it.
const RATING_PRIOR = 4.3;
const RATING_CONFIDENCE = 8;

/** FNV-1a hash of a string id → stable 32-bit int (per-host jitter seed base). */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 → deterministic float in [0,1) for a given integer seed. */
function pseudoRandom(seed: number): number {
  let s = seed >>> 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Composite quality score for ranking hosts. Higher = surfaced earlier.
 * `tick` drives the rotation jitter (bump it to gently reshuffle near-ties);
 * `userCoins` (when known) applies the affordability nudge.
 */
function hostScore(h: Host, tick: number, userCoins?: number): number {
  const reviews = Math.max(0, h.reviewCount || 0);
  const rating = Math.max(0, Math.min(5, h.rating || 0));
  // Bayesian average pulls low-sample ratings toward the prior.
  const bayes = (RATING_PRIOR * RATING_CONFIDENCE + rating * reviews) / (RATING_CONFIDENCE + reviews);
  const ratingComponent = (bayes / 5) * 60; // up to ~60 pts

  // log10(1 + minutes): 100min→~2, 1k→3, 10k→4. Capped so a whale host can't
  // dominate purely on volume.
  const popularity = Math.log10(1 + Math.max(0, h.totalMinutes || 0));
  const popComponent = Math.min(popularity / 4, 1) * 20; // up to 20 pts

  const topRatedBonus = h.isTopRated ? 8 : 0;

  let affordability = 0;
  if (typeof userCoins === "number" && h.coinsPerMinute > 0) {
    affordability = userCoins >= h.coinsPerMinute ? 5 : -6;
  }

  // Bounded jitter in [0,12): reorders hosts whose scores are within ~12 pts of
  // each other, so comparable listeners rotate over time without letting a weak
  // host leapfrog a clearly stronger one.
  const jitter = pseudoRandom(hashId(h.id) ^ Math.imul(tick + 1, 0x9e3779b1)) * 12;

  return ratingComponent + popComponent + topRatedBonus + affordability + jitter;
}

/**
 * Rank a host list by composite score (descending). Same (list, tick, coins)
 * always yields the same order, so a re-render within one tick is stable (no
 * flicker); a new tick re-rolls the jitter and gently rotates near-ties.
 */
function rankHosts(list: Host[], tick: number, userCoins?: number): Host[] {
  return list
    .map((h) => ({ h, s: hostScore(h, tick, userCoins) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.h);
}

function mapApiHost(h: any): Host {
  return {
    id: h.id,
    name: h.display_name || h.name || "Host",
    avatar: resolveMediaUrl(h.avatar_url) || `https://api.dicebear.com/7.x/avataaars/png?seed=${h.id}`,
    bio: h.bio || "",
    rating: Number(h.rating) || 0,
    reviewCount: Number(h.review_count) || 0,
    languages: Array.isArray(h.languages) ? h.languages : (() => { try { return JSON.parse(h.languages || "[]"); } catch { return []; } })(),
    specialties: Array.isArray(h.specialties) ? h.specialties : (() => { try { return JSON.parse(h.specialties || "[]"); } catch { return []; } })(),
    coinsPerMinute: Number(h.audio_coins_per_minute ?? h.coins_per_minute) || 1,
    totalMinutes: Number(h.total_minutes) || 0,
    isOnline: !!h.is_online,
    isTopRated: !!h.is_top_rated,
    gender: h.gender || "male",
    country: h.country || "",
  };
}

type SlideItem = { type: "admin"; id: string; title: string; subtitle?: string; cta_text?: string; cta_link?: string; link_type?: string; bg_color?: string; gradient_to?: string; icon?: string };

function BannerSlider({ slides }: { slides: SlideItem[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const flatRef = useRef<FlatList<SlideItem>>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIdx = useRef(0);

  const goTo = useCallback((idx: number) => {
    if (!flatRef.current || slides.length === 0) return;
    const safe = Math.max(0, Math.min(idx, slides.length - 1));
    flatRef.current.scrollToIndex({ index: safe, animated: true });
    currentIdx.current = safe;
    setActiveIdx(safe);
  }, [slides.length]);

  // Single source of truth for the auto-advance timer. Both the initial mount
  // and every swipe/tap interaction call this, so we never leave two
  // overlapping intervals fighting each other (the previous code duplicated the
  // setInterval setup in the effect AND in onMomentumScrollEnd).
  const restartAutoSlide = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (slides.length <= 1) return;
    timerRef.current = setInterval(() => {
      goTo((currentIdx.current + 1) % slides.length);
    }, AUTO_SLIDE_INTERVAL);
  }, [slides.length, goTo]);

  useEffect(() => {
    restartAutoSlide();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [restartAutoSlide]);

  const onMomentumScrollEnd = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / BANNER_W);
    currentIdx.current = idx;
    setActiveIdx(idx);
    restartAutoSlide();
  }, [restartAutoSlide]);

  const renderSlide = ({ item }: { item: SlideItem }) => (
    <PromoBannerCard banner={item} width={BANNER_W} onPress={() => openBannerLink(item)} />
  );

  if (slides.length === 0) return null;

  return (
    <View style={styles.sliderWrap}>
      <FlatList
        ref={flatRef}
        data={slides}
        horizontal
        // On web (pages.dev) `pagingEnabled` makes each full-width slide a
        // mandatory scroll-snap surface, so the browser swallows taps as the
        // start of a swipe and the slide's onPress never fires. Disable it on
        // web — auto-advance + the dots still drive the carousel. Native keeps
        // smooth paging swipe.
        pagingEnabled={Platform.OS !== "web"}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, i) => (item as any).id || String(i)}
        renderItem={renderSlide}
        onMomentumScrollEnd={onMomentumScrollEnd}
        snapToInterval={BANNER_W}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: BANNER_W, offset: BANNER_W * index, index })}
        onScrollToIndexFailed={({ index }) => {
          // Rare race when the list isn't laid out yet. Retry on the next tick.
          setTimeout(() => flatRef.current?.scrollToIndex({ index, animated: true }), 50);
        }}
        style={{ width: BANNER_W }}
      />
      {slides.length > 1 && (
        <View style={styles.dotsRow}>
          {slides.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} activeOpacity={0.7}>
              <View style={[styles.dot, activeIdx === i && styles.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const { t: tr } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedSpecialty, setSelectedSpecialty] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [coinPopup, setCoinPopup] = useState(false);
  const [coinPopupRequired, setCoinPopupRequired] = useState(0);
  // Admin-configured platform floor for starting a call (min_coins_for_call).
  // The server enforces it on /initiate; we mirror it in the UI gate so the
  // user sees the InsufficientCoins popup instead of a failed call.
  const [minCoinsForCall, setMinCoinsForCall] = useState(0);
  // Admin-set default call rates (App Config → Calling System). Used as the
  // fallback rate when a host row somehow lacks an explicit rate, so the UI
  // mirrors exactly what the server will bill.
  const [defaultRates, setDefaultRates] = useState({ audio: 25, video: 40 });
  // Bumps every ROTATE_INTERVAL_MS to re-shuffle the host list order.
  const [rotationTick, setRotationTick] = useState(0);

  useEffect(() => {
    fetchAppConfig()
      .then((cfg) => {
        const m = parseInt(cfg?.min_coins_for_call ?? "", 10);
        if (Number.isFinite(m) && m > 0) setMinCoinsForCall(m);
        const a = parseInt(cfg?.default_audio_rate ?? "", 10);
        const v = parseInt(cfg?.default_video_rate ?? "", 10);
        setDefaultRates((prev) => ({
          audio: Number.isFinite(a) && a > 0 ? a : prev.audio,
          video: Number.isFinite(v) && v > 0 ? v : prev.video,
        }));
      })
      .catch(() => { /* keep default */ });
  }, []);

  const startCall = useCallback((host: Host, type: "audio" | "video") => {
    const rate = host.coinsPerMinute || (type === "video" ? defaultRates.video : defaultRates.audio);
    // Require at least the admin floor (min_coins_for_call) OR ~2 minutes at
    // the host's rate, whichever is higher.
    const required = Math.max(rate * 2, minCoinsForCall);
    if ((user?.coins ?? 0) < required) {
      setCoinPopupRequired(required);
      setCoinPopup(true);
      return;
    }
    const avatar = host.avatar || `https://api.dicebear.com/7.x/avataaars/png?seed=${host.id}`;
    initiateCall({ id: host.id, name: host.name, avatar, role: "host" }, type, rate);
    router.push({ pathname: "/user/call/outgoing", params: { hostId: host.id, callType: type, hostName: host.name, hostAvatar: avatar, specialty: host.specialties?.[0] ?? "" } });
  }, [user?.coins, initiateCall, minCoinsForCall, defaultRates]);

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  // OPTIMIZATION #7: useQuery replaces manual loadHosts + useEffect
  //   - Automatic background refetch every 2 min (online status changes frequently)
  //   - Cached in React Query store: navigating back to home is INSTANT (no re-fetch if fresh)
  //   - staleTime=60s: won't re-fetch within 60s of last fetch even on component remount
  const { data: hostsData, isLoading: hostsLoading } = useQuery({
    queryKey: ['hosts'],
    queryFn: async () => {
      const res = await API.getHosts({ limit: 50 });
      return res.hosts.map(mapApiHost);
    },
    staleTime: 30_000,
    refetchInterval: 90_000,
    retry: 2,
  });

  // OPTIMIZATION #7: Topics — cached 10 min (topics rarely change)
  const { data: topicsData } = useQuery({
    queryKey: ['talk-topics'],
    queryFn: () => API.getTalkTopics(),
    staleTime: 10 * 60_000,
  });

  // Personalized "Recommended for you" rail. Best-effort: if the endpoint
  // errors (e.g. older backend), the query just yields [] and the rail hides.
  const { data: recommendedData } = useQuery({
    queryKey: ['recommended-hosts'],
    queryFn: async () => {
      const res = await API.getRecommendedHosts(20);
      return (res.hosts ?? []).map((h: any) => ({
        host: mapApiHost(h),
        reason: typeof h.reason === 'string' ? (h.reason as string) : undefined,
      }));
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
    // P6: keep the previous rail visible during background refetch so it never
    // flickers to empty + re-populates.
    placeholderData: keepPreviousData,
  });
  const recommended = recommendedData ?? [];

  // P1: "Your favorites" rail — the user's saved hosts. Highest-intent rail, so
  // it renders ABOVE Recommended for returning users. Best-effort; empty/older
  // backend simply hides it. Favorites endpoint returns host_id (= hosts.id).
  const { data: favoriteHosts = [] } = useQuery({
    queryKey: ['favorite-hosts'],
    queryFn: async () => {
      try {
        const rows = await API.getFavorites();
        return (rows ?? []).map((r: any) => mapApiHost({ ...r, id: r.host_id ?? r.id }));
      } catch { return [] as Host[]; }
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // OPTIMIZATION #7: Banners — cached 5 min
  const { data: bannersData = [] } = useQuery({
    queryKey: ['banners', 'home'],
    queryFn: () => API.getBanners('home'),
    staleTime: 5 * 60_000,
  });

  // First-call-free trial — surface the user's remaining free call minutes
  // (admin sets the pool via first_call_free_minutes; /api/user/me returns the
  // remaining balance). 0 / older backend simply hides the banner.
  const { data: freeMinutes = 0 } = useQuery({
    queryKey: ['free-call-minutes'],
    queryFn: async () => {
      try { const me: any = await API.me(); return Number(me?.free_call_minutes ?? 0) || 0; }
      catch { return 0; }
    },
    staleTime: 60_000,
  });

  const hosts: Host[] = hostsData ?? [];
  const banners: any[] = bannersData as any[];

  const specialties = (() => {
    if (!topicsData) return ["All", "Life Coaching", "Relationships", "Career", "Wellness", "Mental Health"];
    const unique = Array.from(new Map((topicsData as any[]).map((t: any) => [t.name.toLowerCase(), t.name])).values());
    return ["All", ...unique];
  })();

  // Purely admin-driven: the carousel shows ONLY active banners configured in
  // the admin panel. When there are no active banners the slider renders
  // nothing (see BannerSlider's `slides.length === 0` guard) — there is no
  // hardcoded fallback slide, so the app always reflects the admin panel.
  const slides: SlideItem[] = banners.map((b): SlideItem => ({
    type: "admin",
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    cta_text: b.cta_text,
    cta_link: b.cta_link,
    link_type: b.link_type,
    bg_color: b.bg_color,
    gradient_to: b.gradient_to,
    icon: b.icon,
  }));

  // "Top Listeners" rail. Prefer hosts the admin flagged as top-rated. If none
  // are flagged, fall back to the highest-scoring online hosts — but only when
  // the roster is large enough (≥5 online) that a curated strip is meaningfully
  // different from the full list below (avoids showing the same 2-3 cards twice).
  const onlineForTop = hosts.filter((h) => h.isOnline);
  const flaggedTop = onlineForTop.filter((h) => h.isTopRated);
  const topPool = flaggedTop.length > 0 ? flaggedTop : (onlineForTop.length >= 5 ? onlineForTop : []);
  const topHosts = rankHosts(topPool, rotationTick, user?.coins).slice(0, 10);
  const filteredHosts =
    selectedSpecialty === "All"
      ? hosts
      : hosts.filter((h) =>
          h.specialties.some((s) =>
            s.toLowerCase().includes(selectedSpecialty.toLowerCase())
          )
        );
  const onlineHosts = filteredHosts.filter((h) => h.isOnline);
  const offlineHosts = filteredHosts.filter((h) => !h.isOnline);
  // Quality-ranked copies (see hostScore/rankHosts). The rotation tick re-rolls
  // the bounded jitter so comparable hosts gently swap positions over time,
  // while a re-render within the same tick is stable (no mid-frame reshuffle).
  // Keys stay host.id, so React just reorders the existing cards. Affordability
  // is only applied to the online list — offline hosts can't be called now, so
  // demoting them by the viewer's balance would be noise.
  const displayedOnline = rankHosts(onlineHosts, rotationTick, user?.coins);
  const displayedOffline = rankHosts(offlineHosts, rotationTick);

  // OPTIMIZATION #10: Prefetch host detail page when host is tapped (before navigation)
  const prefetchHost = useCallback((hostId: string) => {
    queryClient.prefetchQuery({
      queryKey: ['host', hostId],
      queryFn: () => API.getHost(hostId),
      staleTime: 30_000,
    });
  }, [queryClient]);

  // Engagement feedback loop — log a "viewable" impression for each recommended
  // host that is actually ≥60% on screen (not merely mounted by FlatList
  // windowing), de-duped per session in the logger. onViewableItemsChanged +
  // viewabilityConfig MUST be stable refs (React Native throws if they change
  // between renders), hence useRef.
  const onRecoViewable = useRef(({ viewableItems }: { viewableItems: Array<{ item?: { host?: Host; reason?: string } }> }) => {
    for (const vi of viewableItems) {
      const hostId = vi?.item?.host?.id;
      if (hostId) logImpressionOnce(hostId, 'home_reco');
    }
  }).current;
  const recoViewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // Same viewability-based impression logging for the favorites rail.
  const onFavViewable = useRef(({ viewableItems }: { viewableItems: Array<{ item?: Host }> }) => {
    for (const vi of viewableItems) {
      const hostId = vi?.item?.id;
      if (hostId) logImpressionOnce(hostId, 'home_favorites', { type: 'host_impression' });
    }
  }).current;
  const favViewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // Pull-to-refresh invalidates ALL queries the home feed renders, so the user
  // gets a fully fresh screen (hosts, favorites, recommendations, topics,
  // banners and the free-minute balance) — not just the main host list.
  // invalidateQueries refetches the active queries; awaiting them keeps the
  // spinner up until every rail has settled.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hosts'] }),
        queryClient.invalidateQueries({ queryKey: ['recommended-hosts'] }),
        queryClient.invalidateQueries({ queryKey: ['favorite-hosts'] }),
        queryClient.invalidateQueries({ queryKey: ['talk-topics'] }),
        queryClient.invalidateQueries({ queryKey: ['banners', 'home'] }),
        queryClient.invalidateQueries({ queryKey: ['free-call-minutes'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  // Auto-rotate the host list order on a timer so the "available now" list
  // feels live (different listeners surface to the top over time) instead of a
  // static arrangement, and periodically pull a fresh list so online status
  // stays current. One interval drives both: every tick re-shuffles, every
  // Nth tick also invalidates the hosts query (React Query dedupes the fetch).
  useEffect(() => {
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      setRotationTick((t) => t + 1);
      if (ticks % REFRESH_EVERY_N_TICKS === 0) {
        queryClient.invalidateQueries({ queryKey: ['hosts'] });
      }
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [queryClient]);

  // PRESENCE_UPDATE — host_id (hosts.id) se match karo. Backend user_id (users.id)
  // bhi bhejta hai, lekin user app cache mein h.id = hosts.id hota hai, isliye
  // host_id comparison hi sahi hai.
  //
  // FIX: pehle invalidateQueries() setQueryData ke updater ke ANDAR call ho raha
  // tha — updater pure hona chahiye (React Query use dobara bhi chala sakta hai),
  // to side-effect bahar nikal diya. Ab pehle cache check karte hain, phir ya to
  // sirf us host ko patch karte hain ya (cache miss par) ek hi baar invalidate.
  useSocketEvent(
    SocketEvents.PRESENCE_UPDATE,
    (data: any) => {
      // SocketService emits camelCase `hostId` (= hosts.id); accept snake_case
      // too for safety. Reading only `host_id` here was the bug that left the
      // home list stale when a host came online (hostId was always undefined →
      // the handler early-returned and never patched the cache).
      const hostId: string | undefined = data?.hostId ?? data?.host_id;
      const isOnline: boolean = !!(data?.isOnline ?? data?.is_online);
      if (!hostId) return;

      const current = queryClient.getQueryData<Host[]>(['hosts']);
      const inCache = current?.some((h) => h.id === hostId);

      if (inCache) {
        // Sirf is host ka online flag patch karo — poori list refetch ki zarurat nahi.
        queryClient.setQueryData<Host[]>(['hosts'], (old) =>
          old?.map((h) => (h.id === hostId ? { ...h, isOnline } : h)),
        );
      } else if (current) {
        // Host cache mein nahi mila — fresh list le aao.
        queryClient.invalidateQueries({ queryKey: ['hosts'] });
      }
    },
    [queryClient]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header bar */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => router.push("/user/screens/home/profile")}
            style={styles.avatarBorderWrapper}
            accessibilityRole="button"
            accessibilityLabel="Open your profile"
          >
            <View style={[styles.avatarBorder, { borderColor: colors.primary }]}>
              <Image
                source={{ uri: resolveMediaUrl(user?.avatar) || `https://api.dicebear.com/7.x/avataaars/png?seed=${user?.id ?? "me"}` }}
                style={styles.headerAvatar}
                onError={() => {}}
                defaultSource={require("@/assets/images/home_call_person.png")}
              />
            </View>
          </TouchableOpacity>

          <View style={styles.headerNameCol}>
            <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
              {user?.name?.split(" ")[0] ?? tr.home.welcome}
            </Text>
            <View style={[styles.uniqueIdBadge, { backgroundColor: "#F0E4F8" }]}>
              <Image
                source={require("@/assets/icons/ic_id_badge.png")}
                style={styles.uniqueIdIcon}
                tintColor="#9D82B6"
                resizeMode="contain"
              />
              <Text style={[styles.uniqueIdText, { color: "#9D82B6" }]}>
                ID: {user?.id?.slice(0, 8) ?? "00000000"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => router.push("/user/payment/checkout")}
            style={[styles.coinBadge, { backgroundColor: "#FFF2D9" }]}
            accessibilityRole="button"
            accessibilityLabel={`Coin balance ${(user?.coins ?? 0).toLocaleString()}. Buy coins`}
          >
            <Image
              source={require("@/assets/icons/ic_coin.png")}
              style={styles.coinIconHeader}
              resizeMode="contain"
            />
            <Text style={[styles.coinText, { color: colors.coinGoldText }]}>
              {(user?.coins ?? 0).toLocaleString()}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push("/user/search-hosts")}
            style={[styles.bellBtn, { backgroundColor: colors.muted }]}
            accessibilityRole="button"
            accessibilityLabel="Search hosts"
          >
            <Image source={require("@/assets/icons/ic_search.png")} style={{ width: 18, height: 18 }} tintColor={colors.text} resizeMode="contain" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push("/user/notifications")}
            style={[styles.bellBtn, { backgroundColor: colors.muted }]}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Image source={require("@/assets/icons/ic_notify.png")} style={{ width: 18, height: 18, tintColor: colors.text }} resizeMode="contain" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 100 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Unified Auto/Manual Banner Slider */}
        <BannerSlider slides={slides} />

        {/* First-call-free trial — admin-configured free minutes for new users */}
        {freeMinutes > 0 && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push("/user/screens/home/search")}
            accessibilityRole="button"
            accessibilityLabel={`${freeMinutes} free call minutes available. Tap to pick a host and start a call.`}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F4E8FD", borderRadius: 16, padding: 14, marginBottom: 8 }}
          >
            <Text style={{ fontSize: 28 }}>🎁</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: "Poppins_700Bold", color: "#6A00B8" }}>
                {tr.home.freeMinutesTitle.replace("{count}", String(freeMinutes))}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Poppins_400Regular", color: "#9A74BD", marginTop: 2 }}>
                {tr.home.freeMinutesSub.replace("{count}", String(freeMinutes))}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* P3: Low-balance nudge — when the wallet is too low to comfortably
            start a call (≈ can't afford 2 min of a typical rate), surface a
            1-tap top-up. Hidden while the free-trial pool covers the user. */}
        {freeMinutes <= 0 && (user?.coins ?? 0) <= LOW_BALANCE_THRESHOLD && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push("/user/payment/checkout")}
            accessibilityRole="button"
            accessibilityLabel={`Low balance: ${(user?.coins ?? 0)} coins. Tap to top up.`}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF2D9", borderRadius: 16, padding: 14, marginBottom: 8 }}
          >
            <Text style={{ fontSize: 26 }}>🪙</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: "Poppins_700Bold", color: "#8A5B00" }}>
                {tr.home.lowOnCoins.replace("{count}", String(user?.coins ?? 0))}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Poppins_400Regular", color: "#A9803A", marginTop: 2 }}>
                {tr.home.lowOnCoinsSub}
              </Text>
            </View>
            <View style={{ backgroundColor: "#E49F14", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 }}>
              <Text style={{ fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#fff" }}>{tr.home.topUp}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* P1: Your favorites — highest-intent rail, shown above Recommended
            for returning users who have saved hosts. */}
        {favoriteHosts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{tr.home.yourFavorites}</Text>
              <TouchableOpacity onPress={() => router.push("/user/screens/home/messages")}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>{tr.home.viewAll}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={favoriteHosts}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(h) => h.id}
              onViewableItemsChanged={onFavViewable}
              viewabilityConfig={favViewabilityConfig}
              renderItem={({ item }) => (
                <HostCard
                  host={item}
                  compact
                  userCoins={user?.coins}
                  onPress={() => {
                    logEngagement({ type: 'host_click', host_id: item.id, surface: 'home_favorites' });
                    prefetchHost(item.id);
                    router.push(`/user/hosts/${item.id}`);
                  }}
                />
              )}
              contentContainerStyle={{ paddingRight: 16, paddingLeft: 2 }}
            />
          </View>
        )}

        {/* Recommended for you — personalized rail (see services/api.getRecommendedHosts) */}
        {recommended.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{tr.home.recommendedForYou}</Text>
            </View>
            <FlatList
              data={recommended}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(it) => it.host.id}
              onViewableItemsChanged={onRecoViewable}
              viewabilityConfig={recoViewabilityConfig}
              renderItem={({ item }) => (
                <View style={styles.recoItem}>
                  <HostCard
                    host={item.host}
                    compact
                    userCoins={user?.coins}
                    onPress={() => {
                      logEngagement({ type: 'reco_click', host_id: item.host.id, surface: 'home_reco' });
                      prefetchHost(item.host.id);
                      router.push(`/user/hosts/${item.host.id}`);
                    }}
                  />
                  {item.reason ? (
                    <Text numberOfLines={1} style={[styles.recoReason, { color: colors.primary }]}>
                      {item.reason}
                    </Text>
                  ) : null}
                </View>
              )}
              contentContainerStyle={{ paddingRight: 16, paddingLeft: 2 }}
            />
          </View>
        )}

        {/* Top Listeners section — OPTIMIZATION #8: skeleton cards while loading */}
        {hostsLoading ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{tr.home.topListeners}</Text>
            <View style={{ flexDirection: "row" }}>
              {[1, 2, 3].map((i) => <SkeletonHostCardCompact key={i} />)}
            </View>
          </View>
        ) : topHosts.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{tr.home.topListeners}</Text>
              <TouchableOpacity onPress={() => router.push("/user/hosts/all")}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>{tr.home.viewAll}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={topHosts}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(h) => h.id}
              renderItem={({ item }) => (
                <HostCard
                  host={item}
                  compact
                  userCoins={user?.coins}
                  onPress={() => {
                    logEngagement({ type: 'host_click', host_id: item.id, surface: 'home_top' });
                    prefetchHost(item.id);
                    router.push(`/user/hosts/${item.id}`);
                  }}
                />
              )}
              contentContainerStyle={{ paddingRight: 16, paddingLeft: 2 }}
            />
          </View>
        ) : null}

        {/* Filter chips */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{tr.home.browseByTopic}</Text>
          <FlatList
            data={specialties}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(s) => s}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedSpecialty(item)}
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      selectedSpecialty === item ? colors.primary : "#F0E4F8",
                  },
                ]}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color:
                        selectedSpecialty === item ? "#fff" : colors.primary,
                    },
                  ]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingRight: 20, gap: 8 }}
          />
        </View>

        {/* Listener list — OPTIMIZATION #8: skeleton while loading, #10: prefetch on press */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.availableTitleRow}>
              {!hostsLoading && onlineHosts.length > 0 && selectedSpecialty === "All" && (
                <View style={[styles.livePulseDot, { backgroundColor: colors.online }]} />
              )}
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {selectedSpecialty === "All" ? tr.home.availableNow : selectedSpecialty}
              </Text>
            </View>
            {!hostsLoading && (
              <Text style={[styles.countText, { color: colors.mutedForeground }]}>
                {onlineHosts.length} {tr.home.online}
              </Text>
            )}
          </View>

          {hostsLoading ? (
            [1, 2, 3, 4].map((i) => <SkeletonHostCard key={i} />)
          ) : onlineHosts.length > 0 ? (
            displayedOnline.map((host) => (
              <HostCard
                key={host.id}
                host={host}
                onPress={() => {
                  prefetchHost(host.id);
                  router.push(`/user/hosts/${host.id}`);
                }}
                onAudioCall={() => startCall(host, "audio")}
                onVideoCall={() => startCall(host, "video")}
              />
            ))
          ) : offlineHosts.length === 0 ? (
            // Truly nothing for this filter — full empty-state illustration.
            <View style={styles.emptyState}>
              <Image
                source={require("@/assets/images/empty_hosts.png")}
                style={styles.emptyImage}
                resizeMode="contain"
              />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {tr.home.noListenersAvailable}
              </Text>
            </View>
          ) : (
            // Nobody online right now, but offline listeners exist below — show a
            // compact note instead of the big "empty" illustration (which would
            // contradict the offline list rendered just beneath it).
            <Text style={[styles.offlineLabel, { color: colors.mutedForeground }]}>
              {tr.home.noListenersAvailable}
            </Text>
          )}

          {!hostsLoading && offlineHosts.length > 0 && (
            <>
              <Text style={[styles.offlineLabel, { color: colors.mutedForeground }]}>
                {tr.home.offlineListeners}
              </Text>
              {displayedOffline.map((host) => (
                <HostCard
                  key={host.id}
                  host={host}
                  onPress={() => {
                    prefetchHost(host.id);
                    router.push(`/user/hosts/${host.id}`);
                  }}
                />
              ))}
            </>
          )}
        </View>
      </ScrollView>

      <InsufficientCoinsPopup
        visible={coinPopup}
        onClose={() => setCoinPopup(false)}
        requiredCoins={coinPopupRequired}
        currentCoins={user?.coins ?? 0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  avatarBorderWrapper: { padding: 3 },
  avatarBorder: {
    borderWidth: 1.5,
    borderRadius: 28,
    borderStyle: "dashed" as any,
    padding: 2,
  },
  headerAvatar: { width: 42, height: 42, borderRadius: 21 },
  headerNameCol: { flex: 1, gap: 3 },
  headerName: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  uniqueIdBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  uniqueIdIcon: { width: 10, height: 10 },
  uniqueIdText: { fontSize: 10, fontFamily: "Poppins_500Medium" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  coinBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  coinIconHeader: { width: 18, height: 18 },
  coinText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  bellBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  content: { paddingHorizontal: 16, paddingTop: 8 },

  sliderWrap: {
    marginBottom: 20,
    alignItems: "center",
  },
  slide: {
    width: BANNER_W,
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
    minHeight: 130,
  },

  findMoreLeft: { flex: 1, gap: 6 },
  findMoreTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#fff" },
  findMoreSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.8)" },
  findMoreBtn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    marginTop: 4,
  },
  findMoreBtnText: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  findMoreImage: { width: 90, height: 90, marginLeft: 12 },

  adminBannerContent: { flex: 1, gap: 6 },
  adminBannerTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: "#fff" },
  adminBannerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.85)" },
  adminBannerBtn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 4,
  },
  adminBannerBtnText: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#fff" },

  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#D0C0E0",
  },
  dotActive: {
    width: 20,
    backgroundColor: "#A00EE7",
    borderRadius: 3,
  },

  section: { marginBottom: 20, gap: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  availableTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  livePulseDot: { width: 8, height: 8, borderRadius: 4 },
  recoItem: { marginRight: 0 },
  recoReason: { fontSize: 10, fontFamily: "Poppins_500Medium", marginTop: 4, marginLeft: 4, maxWidth: 150 },
  seeAll: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  countText: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  chipText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  offlineLabel: { fontSize: 13, fontFamily: "Poppins_500Medium", marginTop: 4, marginBottom: 4 },
  emptyState: { alignItems: "center", gap: 12, paddingVertical: 40 },
  emptyImage: { width: 160, height: 120 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});


// Per-screen error boundary — a render crash on the home hub stays contained
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
