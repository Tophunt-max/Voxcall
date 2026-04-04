import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { HostCard } from "@/components/HostCard";
import { InsufficientCoinsPopup } from "@/components/InsufficientCoinsPopup";
import { Host } from "@/data/mockData";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";
import { RefreshControl } from "react-native";

const SCREEN_W = Dimensions.get("window").width;
const BANNER_W = SCREEN_W - 32;
const AUTO_SLIDE_INTERVAL = 3500;

function mapApiHost(h: any): Host {
  return {
    id: h.id,
    name: h.display_name || h.name || "Host",
    avatar: resolveMediaUrl(h.avatar_url) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${h.id}`,
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

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const [selectedSpecialty, setSelectedSpecialty] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [specialties, setSpecialties] = useState<string[]>(["All"]);
  const [loading, setLoading] = useState(true);
  const [banners, setBanners] = useState<any[]>([]);
  const [coinPopup, setCoinPopup] = useState(false);
  const [coinPopupRequired, setCoinPopupRequired] = useState(0);

  const startCall = useCallback((host: Host, type: "audio" | "video") => {
    const rate = host.coinsPerMinute || 1;
    const required = rate * 2;
    if ((user?.coins ?? 0) < required) {
      setCoinPopupRequired(required);
      setCoinPopup(true);
      return;
    }
    const avatar = host.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${host.id}`;
    initiateCall({ id: host.id, name: host.name, avatar, role: "host" }, type, rate);
    router.push({ pathname: "/user/call/outgoing", params: { hostId: host.id, callType: type, hostName: host.name, hostAvatar: avatar, specialty: host.specialties?.[0] ?? "" } });
  }, [user?.coins, initiateCall]);

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const loadHosts = useCallback(async () => {
    try {
      const data = await API.getHosts();
      setHosts(data.map(mapApiHost));
    } catch {
      setHosts([]);
      showErrorToast("Failed to load hosts. Pull down to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTopics = useCallback(async () => {
    try {
      const topics = await API.getTalkTopics();
      const unique = Array.from(new Map(topics.map((t: any) => [t.name.toLowerCase(), t.name])).values());
      setSpecialties(["All", ...unique]);
    } catch {
      setSpecialties(["All", "Life Coaching", "Relationships", "Career", "Wellness", "Mental Health", "Music", "Travel"]);
      showErrorToast("Failed to load topics. Using defaults.");
    }
  }, []);

  useEffect(() => {
    loadHosts();
    loadTopics();
    API.getBanners('home').then(setBanners).catch(() => {});
  }, []);

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHosts();
    setRefreshing(false);
  }, [loadHosts]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header bar */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => router.push("/user/screens/home/profile")}
            style={styles.avatarBorderWrapper}
          >
            <View style={[styles.avatarBorder, { borderColor: colors.primary }]}>
              <Image
                source={{ uri: resolveMediaUrl(user?.avatar) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "me"}` }}
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
          >
            <Image source={require("@/assets/icons/ic_search.png")} style={{ width: 18, height: 18 }} tintColor={colors.text} resizeMode="contain" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push("/user/notifications")}
            style={[styles.bellBtn, { backgroundColor: colors.muted }]}
          >
            <Feather name="bell" size={18} color={colors.text} />
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

        {/* Top Listeners section */}
        {topHosts.length > 0 && (
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
                  onPress={() => router.push(`/user/hosts/${item.id}`)}
                />
              )}
              contentContainerStyle={{ paddingRight: 16, paddingLeft: 2 }}
            />
          </View>
        )}

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

        {/* Listener list */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {selectedSpecialty === "All" ? "Available Now" : selectedSpecialty}
            </Text>
            <Text style={[styles.countText, { color: colors.mutedForeground }]}>
              {onlineHosts.length} online
            </Text>
          </View>

          {onlineHosts.length > 0 ? (
            onlineHosts.map((host) => (
              <HostCard
                key={host.id}
                host={host}
                onPress={() => router.push(`/user/hosts/${host.id}`)}
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

          {filteredHosts.filter((h) => !h.isOnline).length > 0 && (
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
                    onPress={() => router.push(`/user/hosts/${host.id}`)}
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
  seeAll: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  countText: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  chipText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  offlineLabel: { fontSize: 13, fontFamily: "Poppins_500Medium", marginTop: 4, marginBottom: 4 },
  emptyState: { alignItems: "center", gap: 12, paddingVertical: 40 },
  emptyImage: { width: 160, height: 120 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular" },
});
