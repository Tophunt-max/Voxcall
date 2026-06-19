import React, { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { HostCard } from "@/components/HostCard";
import { InsufficientCoinsPopup } from "@/components/InsufficientCoinsPopup";
import { SkeletonHostCard, SkeletonHostCardCompact } from "@/components/SkeletonCard";
import { Host } from "@/data/mockData";
import { API, resolveMediaUrl } from "@/services/api";
import { fetchAppConfig } from "@/hooks/useAppConfig";
import { showErrorToast } from "@/components/Toast";
import { GROWTH_FEATURES, FEATURE_STATUS_LABEL, FEATURE_STATUS_SUMMARY, GrowthFeature } from "@/constants/growthFeatures";
import { RefreshControl } from "react-native";

const SCREEN_W = Dimensions.get("window").width;
const BANNER_W = SCREEN_W - 32;
const AUTO_SLIDE_INTERVAL = 3500;

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

type SlideItem =
  | { type: "find_more" }
  | { type: "admin"; id: string; title: string; subtitle?: string; cta_text?: string; cta_link?: string; bg_color?: string };

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

  useEffect(() => {
    if (slides.length <= 1) return;
    timerRef.current = setInterval(() => {
      const next = (currentIdx.current + 1) % slides.length;
      goTo(next);
    }, AUTO_SLIDE_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [slides.length, goTo]);

  const onMomentumScrollEnd = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / BANNER_W);
    currentIdx.current = idx;
    setActiveIdx(idx);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const next = (currentIdx.current + 1) % slides.length;
      goTo(next);
    }, AUTO_SLIDE_INTERVAL);
  }, [slides.length, goTo]);

  const renderSlide = ({ item }: { item: SlideItem }) => {
    if (item.type === "find_more") {
      return (
        <TouchableOpacity
          onPress={() => router.push("/user/screens/home/random")}
          activeOpacity={0.9}
          style={[styles.slide, { backgroundColor: "#A00EE7" }]}
        >
          <View style={styles.findMoreLeft}>
            <Text style={styles.findMoreTitle}>Find More</Text>
            <Text style={styles.findMoreSub}>Connect with a random listener now</Text>
            <View style={styles.findMoreBtn}>
              <Text style={styles.findMoreBtnText}>Start Random Call</Text>
            </View>
          </View>
          <Image
            source={require("@/assets/images/home_call_person.png")}
            style={styles.findMoreImage}
            resizeMode="contain"
          />
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          if (item.cta_link) router.push(item.cta_link as any);
        }}
        style={[styles.slide, { backgroundColor: item.bg_color || "#A00EE7" }]}
      >
        <View style={styles.adminBannerContent}>
          <Text style={styles.adminBannerTitle}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.adminBannerSub}>{item.subtitle}</Text> : null}
          {item.cta_text ? (
            <View style={styles.adminBannerBtn}>
              <Text style={styles.adminBannerBtnText}>{item.cta_text}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  if (slides.length === 0) return null;

  return (
    <View style={styles.sliderWrap}>
      <FlatList
        ref={flatRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, i) => item.type === "find_more" ? "find_more" : (item as any).id || String(i)}
        renderItem={renderSlide}
        onMomentumScrollEnd={onMomentumScrollEnd}
        snapToInterval={BANNER_W}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: BANNER_W, offset: BANNER_W * index, index })}
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


function GrowthFeatureLaunchpad({ colors }: { colors: any }) {
  const featured = GROWTH_FEATURES;

  const openFeature = useCallback((feature: GrowthFeature) => {
    if (feature.route) {
      router.push(feature.route as any);
      return;
    }
    showErrorToast(`${feature.title} is in the product backlog.`);
  }, []);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Growth Features</Text>
          <Text style={[styles.featureSubtitle, { color: colors.mutedForeground }]}>20 suggested calling-system upgrades</Text>
        </View>
        <TouchableOpacity onPress={() => router.push("/user/features")}>
          <Text style={[styles.countText, { color: colors.primary }]}>
            {FEATURE_STATUS_SUMMARY.completed} done · View all
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={featured}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingRight: 16 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.86}
            onPress={() => openFeature(item)}
            style={[styles.featureCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.featureTopRow}>
              <View style={[styles.featureStatus, statusStyle(item.status)]}>
                <Text style={styles.featureStatusText}>{FEATURE_STATUS_LABEL[item.status]}</Text>
              </View>
              <Text style={[styles.featureAudience, { color: colors.mutedForeground }]}>{item.audience}</Text>
            </View>
            <Text numberOfLines={2} style={[styles.featureTitle, { color: colors.text }]}>{item.title}</Text>
            <Text numberOfLines={3} style={[styles.featureDescription, { color: colors.mutedForeground }]}>{item.description}</Text>
            <Text style={[styles.featureCta, { color: colors.primary }]}>{item.cta}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function statusStyle(status: GrowthFeature["status"]) {
  if (status === "completed") return { backgroundColor: "#E8F8EE" };
  if (status === "ready") return { backgroundColor: "#FFF4D8" };
  return { backgroundColor: "#F0E4F8" };
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { initiateCall } = useCall();
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
  const { data: hostsData, isLoading: hostsLoading, refetch: refetchHosts } = useQuery({
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
  });
  const recommended = recommendedData ?? [];

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

  const slides: SlideItem[] = [
    ...banners.map((b): SlideItem => ({
      type: "admin",
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      cta_text: b.cta_text,
      cta_link: b.cta_link,
      bg_color: b.bg_color,
    })),
    { type: "find_more" },
  ];

  const topHosts = hosts.filter((h) => h.isTopRated && h.isOnline);
  const filteredHosts =
    selectedSpecialty === "All"
      ? hosts
      : hosts.filter((h) =>
          h.specialties.some((s) =>
            s.toLowerCase().includes(selectedSpecialty.toLowerCase())
          )
        );
  const onlineHosts = filteredHosts.filter((h) => h.isOnline);

  // OPTIMIZATION #10: Prefetch host detail page when host is tapped (before navigation)
  const prefetchHost = useCallback((hostId: string) => {
    queryClient.prefetchQuery({
      queryKey: ['host', hostId],
      queryFn: () => API.getHost(hostId),
      staleTime: 30_000,
    });
  }, [queryClient]);

  // Pull-to-refresh invalidates all home screen queries
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['hosts'] });
    await refetchHosts();
    setRefreshing(false);
  }, [queryClient, refetchHosts]);

  // FIX: PRESENCE_UPDATE — host_id (hosts.id) se match karo
  // Backend user_id (users.id) bhi bhejta hai, lekin user app cache mein h.id = hosts.id hota hai
  // Isliye h.id === data.host_id comparison sahi hai, user_id se nahi
  useSocketEvent(
    SocketEvents.PRESENCE_UPDATE,
    (data: any) => {
      const hostId: string = data?.host_id;           // hosts.id (PK) — cache match ke liye
      const hostUserId: string = data?.user_id ?? data?.userId; // users.id — fallback
      const isOnline: boolean = !!(data?.isOnline ?? data?.is_online);

      queryClient.setQueryData<Host[]>(['hosts'], (old) => {
        if (!old) return old;
        // host_id se match karo (hosts.id = h.id in cache)
        const updated = old.map((h) => {
          if (hostId && h.id === hostId) return { ...h, isOnline };
          // Fallback: user_id se bhi try karo agar host_id nahi mila
          // (purane events ke liye backward compatibility)
          return h;
        });
        const found = hostId
          ? old.some((h) => h.id === hostId)
          : false;
        if (!found) {
          // Host cache mein nahi — full refetch karo
          queryClient.invalidateQueries({ queryKey: ['hosts'] });
        }
        return updated;
      });
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
              {user?.name?.split(" ")[0] ?? "Welcome"}
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F4E8FD", borderRadius: 16, padding: 14, marginBottom: 8 }}>
            <Text style={{ fontSize: 28 }}>🎁</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: "Poppins_700Bold", color: "#6A00B8" }}>
                {freeMinutes} free call minute{freeMinutes === 1 ? "" : "s"} available!
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Poppins_400Regular", color: "#9A74BD", marginTop: 2 }}>
                Your first {freeMinutes} minute{freeMinutes === 1 ? "" : "s"} are on us — start a call with any host.
              </Text>
            </View>
          </View>
        )}

        {/* Recommended for you — personalized rail (see services/api.getRecommendedHosts) */}
        {recommended.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recommended for you</Text>
            </View>
            <FlatList
              data={recommended}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(it) => it.host.id}
              renderItem={({ item }) => (
                <View style={styles.recoItem}>
                  <HostCard
                    host={item.host}
                    compact
                    onPress={() => {
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

        <GrowthFeatureLaunchpad colors={colors} />

        {/* Top Listeners section — OPTIMIZATION #8: skeleton cards while loading */}
        {hostsLoading ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Listeners</Text>
            <View style={{ flexDirection: "row" }}>
              {[1, 2, 3].map((i) => <SkeletonHostCardCompact key={i} />)}
            </View>
          </View>
        ) : topHosts.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Listeners</Text>
              <TouchableOpacity onPress={() => router.push("/user/hosts/all")}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>View All</Text>
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
                  onPress={() => {
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
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Browse by Topic</Text>
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
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {selectedSpecialty === "All" ? "Available Now" : selectedSpecialty}
            </Text>
            {!hostsLoading && (
              <Text style={[styles.countText, { color: colors.mutedForeground }]}>
                {onlineHosts.length} online
              </Text>
            )}
          </View>

          {hostsLoading ? (
            [1, 2, 3, 4].map((i) => <SkeletonHostCard key={i} />)
          ) : onlineHosts.length > 0 ? (
            onlineHosts.map((host) => (
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
          ) : (
            <View style={styles.emptyState}>
              <Image
                source={require("@/assets/images/empty_hosts.png")}
                style={styles.emptyImage}
                resizeMode="contain"
              />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No listeners available right now
              </Text>
            </View>
          )}

          {!hostsLoading && filteredHosts.filter((h) => !h.isOnline).length > 0 && (
            <>
              <Text style={[styles.offlineLabel, { color: colors.mutedForeground }]}>
                Offline Listeners
              </Text>
              {filteredHosts
                .filter((h) => !h.isOnline)
                .map((host) => (
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
  recoItem: { marginRight: 0 },
  recoReason: { fontSize: 10, fontFamily: "Poppins_500Medium", marginTop: 4, marginLeft: 4, maxWidth: 150 },
  featureSubtitle: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 2 },
  featureCard: { width: 210, borderRadius: 18, padding: 14, borderWidth: 1, marginRight: 12, gap: 8 },
  featureTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  featureStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  featureStatusText: { fontSize: 10, fontFamily: "Poppins_700Bold", color: "#6A00B8" },
  featureAudience: { fontSize: 10, fontFamily: "Poppins_500Medium", textTransform: "capitalize" },
  featureTitle: { fontSize: 14, fontFamily: "Poppins_700Bold", minHeight: 38 },
  featureDescription: { fontSize: 11, fontFamily: "Poppins_400Regular", lineHeight: 16, minHeight: 48 },
  featureCta: { fontSize: 12, fontFamily: "Poppins_700Bold" },
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
