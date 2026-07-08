import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  TextInput,
  Dimensions,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";
import { InsufficientCoinsPopup } from "@/components/InsufficientCoinsPopup";

// ─── Dark palette (this screen is intentionally a fixed dark "discover" view,
// independent of the app light theme — mirrors the reference design). ─────────
const BG_TOP = "#3A2A63";
const BG_BOTTOM = "#140F29";
const CARD_BG = "#2A2048";
const CARD_BORDER = "rgba(255,255,255,0.08)";
const TEXT = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.65)";
const LIVE_GREEN = "#22C55E";
const OFFLINE_RED = "#EF4444";

const SCREEN_W = Dimensions.get("window").width;
const H_PADDING = 14;
const GRID_GAP = 12;
const CARD_W = (SCREEN_W - H_PADDING * 2 - GRID_GAP) / 2;

// Region filter tabs. `code` is the ISO alpha-2 matched against the host's
// country; GLOBAL means no filter. India-first ordering.
const COUNTRY_TABS: { key: string; label: string; code: string | null }[] = [
  { key: "GLOBAL", label: "Global", code: null },
  { key: "IN", label: "India", code: "IN" },
  { key: "PK", label: "Pakistan", code: "PK" },
  { key: "US", label: "America", code: "US" },
];

// Compact fallback name map (covers the India-first audience) — used only when
// Intl.DisplayNames is unavailable on the runtime.
const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", PK: "Pakistan", US: "United States", GB: "United Kingdom",
  AE: "UAE", SA: "Saudi Arabia", BD: "Bangladesh", NP: "Nepal", LK: "Sri Lanka",
  RU: "Russia", FR: "France", ES: "Spain", CN: "China", PH: "Philippines",
  ID: "Indonesia", NG: "Nigeria", EG: "Egypt", TR: "Turkey", CA: "Canada",
  AU: "Australia", DE: "Germany", IT: "Italy", BR: "Brazil", MY: "Malaysia",
};

function countryName(code?: string): string {
  if (!code) return "";
  const cc = code.trim().toUpperCase();
  try {
    const dn = new (Intl as any).DisplayNames(["en"], { type: "region" });
    const n = dn?.of?.(cc);
    if (n && n !== cc) return n;
  } catch { /* Intl.DisplayNames unavailable — fall through */ }
  return COUNTRY_NAMES[cc] ?? cc;
}

// flagcdn provides reliable flag IMAGES on every platform. (Emoji flags do NOT
// render on most Android devices, so images are the safe choice.)
function flagUrl(code: string, w: 40 | 80 = 40): string {
  return `https://flagcdn.com/w${w}/${code.trim().toLowerCase()}.png`;
}

function mapApiHost(h: any) {
  return {
    id: h.id,
    name: h.display_name || h.name || "Host",
    avatar: resolveMediaUrl(h.avatar_url) || `https://api.dicebear.com/7.x/avataaars/png?seed=${h.id}`,
    coinsPerMinute: Number(h.audio_coins_per_minute ?? h.coins_per_minute) || 1,
    videoCoinsPerMinute: Number(h.video_coins_per_minute ?? h.coins_per_minute) || 1,
    isOnline: !!h.is_online,
    specialties: Array.isArray(h.specialties) ? h.specialties : (() => { try { return JSON.parse(h.specialties || "[]"); } catch { return []; } })(),
    country: (h.country || "").toString().trim(),
  };
}
type UIHost = ReturnType<typeof mapApiHost>;

// ─── Live / Offline status pill (top-right of each card) ─────────────────────
function StatusPill({ online }: { online: boolean }) {
  return (
    <View style={styles.statusPill}>
      {online ? (
        <View style={styles.bars}>
          {[6, 9, 12].map((h, i) => (
            <View key={i} style={[styles.bar, { height: h, backgroundColor: LIVE_GREEN }]} />
          ))}
        </View>
      ) : (
        <View style={[styles.statusDot, { backgroundColor: OFFLINE_RED }]} />
      )}
      <Text style={[styles.statusText, { color: online ? LIVE_GREEN : "rgba(255,255,255,0.85)" }]}>
        {online ? "Live" : "Offline"}
      </Text>
    </View>
  );
}

// ─── Country tab pill ────────────────────────────────────────────────────────
function CountryTab({ tab, active, onPress }: { tab: typeof COUNTRY_TABS[number]; active: boolean; onPress: () => void }) {
  const inner = (
    <View style={styles.tabInner}>
      {tab.code ? (
        <Image source={{ uri: flagUrl(tab.code, 80) }} style={styles.tabFlag} resizeMode="cover" />
      ) : (
        <Text style={styles.tabGlobe}>🌐</Text>
      )}
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
    </View>
  );
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.tabTouch}>
      {active ? (
        <LinearGradient
          colors={["#F250C9", "#8A3FE8"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.tabActive}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View style={styles.tabIdle}>{inner}</View>
      )}
    </TouchableOpacity>
  );
}

// ─── Host grid card ──────────────────────────────────────────────────────────
function HostGridCard({ host, onPress, onVideoCall }: { host: UIHost; onPress: () => void; onVideoCall: () => void }) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={onPress}>
      <Image source={{ uri: host.avatar }} style={styles.cardAvatar} resizeMode="cover" />
      <LinearGradient
        colors={["transparent", "rgba(10,6,24,0.15)", "rgba(10,6,24,0.92)"]}
        style={styles.cardOverlay}
        pointerEvents="none"
      />

      <StatusPill online={host.isOnline} />

      <View style={styles.cardBottom} pointerEvents="box-none">
        <View style={styles.cardTextCol}>
          <Text style={styles.cardName} numberOfLines={1}>{host.name}</Text>
          {host.country ? (
            <View style={styles.cardCountryRow}>
              <Image source={{ uri: flagUrl(host.country, 40) }} style={styles.cardFlag} resizeMode="cover" />
              <Text style={styles.cardCountry} numberOfLines={1}>{countryName(host.country)}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={onVideoCall}
          style={styles.videoBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Video call ${host.name}`}
        >
          <Image source={require("@/assets/icons/ic_video.png")} style={styles.videoIcon} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { initiateCall } = useCall();

  const [activeTab, setActiveTab] = useState("GLOBAL");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [hosts, setHosts] = useState<UIHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [coinPopup, setCoinPopup] = useState(false);
  const [coinPopupRequired, setCoinPopupRequired] = useState(0);

  const loadHosts = useCallback(async () => {
    try {
      const res = await API.getHosts({ limit: 100 });
      setHosts((res?.hosts ?? []).map(mapApiHost));
    } catch {
      setHosts([]);
      showErrorToast("Failed to load hosts");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadHosts().finally(() => setLoading(false));
  }, [loadHosts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHosts();
    setRefreshing(false);
  }, [loadHosts]);

  const startVideoCall = useCallback((host: UIHost) => {
    // Offline hosts can't be called — open their profile instead.
    if (!host.isOnline) {
      router.push(`/user/hosts/${host.id}`);
      return;
    }
    const rate = host.videoCoinsPerMinute || host.coinsPerMinute || 1;
    const required = rate * 2;
    if ((user?.coins ?? 0) < required) {
      setCoinPopupRequired(required);
      setCoinPopup(true);
      return;
    }
    initiateCall({ id: host.id, name: host.name, avatar: host.avatar, role: "host" }, "video", rate);
    router.push({ pathname: "/user/call/outgoing", params: { hostId: host.id, callType: "video", hostName: host.name, hostAvatar: host.avatar, specialty: host.specialties?.[0] ?? "" } });
  }, [user?.coins, initiateCall]);

  const filtered = useMemo(() => {
    const tab = COUNTRY_TABS.find((t) => t.key === activeTab);
    const q = searchText.trim().toLowerCase();
    return hosts.filter((h) => {
      if (tab?.code && h.country.toUpperCase() !== tab.code) return false;
      if (q && !h.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [hosts, activeTab, searchText]);

  return (
    <View style={styles.container}>
      <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />

      {/* Top bar: country tabs + globe-search button */}
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <FlatList
          data={COUNTRY_TABS}
          horizontal
          keyExtractor={(t) => t.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
          renderItem={({ item }) => (
            <CountryTab tab={item} active={activeTab === item.key} onPress={() => setActiveTab(item.key)} />
          )}
        />
        <TouchableOpacity
          onPress={() => setSearchOpen((s) => !s)}
          style={styles.globeBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Search hosts"
        >
          <Image source={require("@/assets/icons/ic_search.png")} style={styles.globeIcon} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>
      </View>

      {searchOpen && (
        <View style={styles.searchWrap}>
          <Image source={require("@/assets/icons/ic_search.png")} style={styles.searchInputIcon} tintColor={MUTED} resizeMode="contain" />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search by name…"
            placeholderTextColor={MUTED}
            style={styles.searchInput}
            autoFocus
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerWrap}>
          <Text style={styles.emptyEmoji}>🔍</Text>
          <Text style={styles.emptyText}>No hosts found</Text>
          <Text style={styles.emptySub}>Try a different region or search.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(h) => h.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: H_PADDING }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
          renderItem={({ item }) => (
            <HostGridCard
              host={item}
              onPress={() => router.push(`/user/hosts/${item.id}`)}
              onVideoCall={() => startVideoCall(item)}
            />
          )}
        />
      )}

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
  container: { flex: 1, backgroundColor: BG_BOTTOM },

  // Top bar
  topBar: { flexDirection: "row", alignItems: "center", paddingRight: 12, paddingBottom: 12, gap: 8 },
  tabsRow: { paddingHorizontal: 12, gap: 10, alignItems: "center" },
  tabTouch: { borderRadius: 24 },
  tabActive: { borderRadius: 24, paddingHorizontal: 4, paddingVertical: 4 },
  tabIdle: {
    borderRadius: 24, paddingHorizontal: 4, paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  tabInner: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 14 },
  tabFlag: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.15)" },
  tabGlobe: { fontSize: 22, width: 30, height: 30, textAlign: "center", lineHeight: 30 },
  tabLabel: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "rgba(255,255,255,0.75)" },
  tabLabelActive: { color: "#fff", fontFamily: "Poppins_700Bold" },

  globeBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center", justifyContent: "center",
  },
  globeIcon: { width: 20, height: 20 },

  // Search input
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: H_PADDING, marginBottom: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderRadius: 14, paddingHorizontal: 12, height: 46,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  searchInputIcon: { width: 18, height: 18 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Poppins_400Regular", padding: 0 },
  searchClear: { color: MUTED, fontSize: 16, paddingHorizontal: 4 },

  // Grid card
  card: {
    width: CARD_W,
    aspectRatio: 0.86,
    borderRadius: 18,
    marginBottom: GRID_GAP,
    overflow: "hidden",
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  cardAvatar: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  cardOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },

  statusPill: {
    position: "absolute", top: 10, right: 10,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(10,6,24,0.55)",
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20,
  },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 12 },
  bar: { width: 3, borderRadius: 1.5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontFamily: "Poppins_600SemiBold" },

  cardBottom: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    padding: 10, gap: 8,
  },
  cardTextCol: { flex: 1, gap: 3 },
  cardName: {
    color: TEXT, fontSize: 16, fontFamily: "Poppins_700Bold",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  cardCountryRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardFlag: { width: 18, height: 13, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)" },
  cardCountry: { flex: 1, color: MUTED, fontSize: 12, fontFamily: "Poppins_400Regular", textTransform: "lowercase" },

  videoBtn: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  videoIcon: { width: 22, height: 22 },

  // States
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 80 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  emptySub: { color: MUTED, fontSize: 13, fontFamily: "Poppins_400Regular" },
});

// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
