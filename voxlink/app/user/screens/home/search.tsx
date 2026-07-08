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
  Modal,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { useLanguage } from "@/context/LanguageContext";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";
import { InsufficientCoinsPopup } from "@/components/InsufficientCoinsPopup";

type Colors = ReturnType<typeof useColors>;

const SCREEN_W = Dimensions.get("window").width;
const H_PADDING = 14;
const GRID_GAP = 12;
const CARD_W = (SCREEN_W - H_PADDING * 2 - GRID_GAP) / 2;

// Purple accent gradient for the active country tab + video button (brand
// accent; used for accents only, the screen itself follows the app theme).
const ACCENT_GRADIENT = ["#C64BE8", "#8A2BD8"] as const;

// Region filter tabs. `code` is the ISO alpha-2 matched against the host's
// country; GLOBAL means no filter. India-first ordering.
const COUNTRY_TABS: { key: string; label: string; code: string | null }[] = [
  { key: "GLOBAL", label: "Global", code: null },
  { key: "IN", label: "India", code: "IN" },
  { key: "PK", label: "Pakistan", code: "PK" },
  { key: "US", label: "America", code: "US" },
];

// Secondary filters (client-side): host language + what they talk about.
const LANGUAGES = ["All", "English", "Hindi", "Urdu", "Mandarin", "Spanish", "French", "Arabic"];
const TOPICS = ["All", "Life Coaching", "Career", "Wellness", "Relationships", "Meditation", "Finance", "Education"];

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
    languages: Array.isArray(h.languages) ? h.languages : (() => { try { return JSON.parse(h.languages || "[]"); } catch { return []; } })(),
    specialties: Array.isArray(h.specialties) ? h.specialties : (() => { try { return JSON.parse(h.specialties || "[]"); } catch { return []; } })(),
    country: (h.country || "").toString().trim(),
  };
}
type UIHost = ReturnType<typeof mapApiHost>;

// ─── Live / Offline status pill (top-right of each card) ─────────────────────
// Sits over the card image, so it keeps a dark translucent background for
// readability on both light and dark app themes.
function StatusPill({ online, colors }: { online: boolean; colors: Colors }) {
  return (
    <View style={styles.statusPill}>
      {online ? (
        <View style={styles.bars}>
          {[6, 9, 12].map((h, i) => (
            <View key={i} style={[styles.bar, { height: h, backgroundColor: colors.online }]} />
          ))}
        </View>
      ) : (
        <View style={[styles.statusDot, { backgroundColor: colors.red }]} />
      )}
      <Text style={[styles.statusText, { color: online ? colors.online : "rgba(255,255,255,0.9)" }]}>
        {online ? "Live" : "Offline"}
      </Text>
    </View>
  );
}

// ─── Country tab pill ────────────────────────────────────────────────────────
function CountryTab({ tab, active, colors, onPress }: { tab: typeof COUNTRY_TABS[number]; active: boolean; colors: Colors; onPress: () => void }) {
  const inner = (
    <View style={styles.tabInner}>
      {tab.code ? (
        <Image source={{ uri: flagUrl(tab.code, 80) }} style={styles.tabFlag} resizeMode="cover" />
      ) : (
        <Text style={styles.tabGlobe}>🌐</Text>
      )}
      <Text style={[styles.tabLabel, { color: active ? "#fff" : colors.mutedForeground }, active && styles.tabLabelActive]}>
        {tab.label}
      </Text>
    </View>
  );
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.tabTouch}>
      {active ? (
        <LinearGradient colors={ACCENT_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.tabPill}>
          {inner}
        </LinearGradient>
      ) : (
        <View style={[styles.tabPill, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>
          {inner}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Host grid card ──────────────────────────────────────────────────────────
function HostGridCard({ host, colors, onPress, onVideoCall }: { host: UIHost; colors: Colors; onPress: () => void; onVideoCall: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.muted, borderColor: colors.border }]}
      activeOpacity={0.9}
      onPress={onPress}
    >
      <Image source={{ uri: host.avatar }} style={styles.cardAvatar} resizeMode="cover" />
      {/* Dark bottom gradient keeps the name/country legible over any photo,
          independent of the app (light/dark) theme. */}
      <LinearGradient
        colors={["transparent", "rgba(10,6,24,0.15)", "rgba(10,6,24,0.92)"]}
        style={styles.cardOverlay}
        pointerEvents="none"
      />

      <StatusPill online={host.isOnline} colors={colors} />

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
          style={[styles.videoBtn, { backgroundColor: colors.accent }]}
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

// ─── Language / Talk-about filter chip ───────────────────────────────────────
function FilterChip({ icon, iconTint, label, active, colors, onPress }: { icon: any; iconTint: string; label: string; active: boolean; colors: Colors; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.filterChip,
        { backgroundColor: active ? colors.accentLight : colors.card, borderColor: active ? colors.accentBorder : colors.border },
      ]}
    >
      <Image source={icon} style={styles.filterChipIcon} tintColor={active ? colors.accent : iconTint} resizeMode="contain" />
      <Text style={[styles.filterChipText, { color: active ? colors.accent : colors.text }]} numberOfLines={1}>{label}</Text>
      <Image source={require("@/assets/icons/ic_back.png")} style={styles.filterChipArrow} tintColor={colors.mutedForeground} resizeMode="contain" />
    </TouchableOpacity>
  );
}

// ─── Bottom-sheet option picker (themed) ─────────────────────────────────────
function FilterModal({ visible, title, options, selected, colors, onSelect, onClose }: { visible: boolean; title: string; options: string[]; selected: string; colors: Colors; onSelect: (v: string) => void; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
          <Text style={[styles.modalTitle, { color: colors.text }]}>{title}</Text>
          {options.map((opt) => {
            const isSel = selected === opt;
            return (
              <TouchableOpacity key={opt} onPress={() => { onSelect(opt); onClose(); }} style={[styles.modalOpt, { borderBottomColor: colors.border }]}>
                <Text style={[styles.modalOptText, { color: isSel ? colors.accent : colors.text, fontFamily: isSel ? "Poppins_600SemiBold" : "Poppins_400Regular" }]}>{opt}</Text>
                {isSel && <View style={[styles.modalCheck, { backgroundColor: colors.accent }]} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { initiateCall } = useCall();

  const [activeTab, setActiveTab] = useState("GLOBAL");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedLang, setSelectedLang] = useState("All");
  const [selectedTopic, setSelectedTopic] = useState("All");
  const [showLangModal, setShowLangModal] = useState(false);
  const [showTopicModal, setShowTopicModal] = useState(false);
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
    const lang = selectedLang.toLowerCase();
    const topic = selectedTopic.toLowerCase();
    return hosts.filter((h) => {
      if (tab?.code && h.country.toUpperCase() !== tab.code) return false;
      if (q && !h.name.toLowerCase().includes(q)) return false;
      if (selectedLang !== "All" && !h.languages.some((l: string) => l.toLowerCase() === lang)) return false;
      if (selectedTopic !== "All" && !h.specialties.some((s: string) => s.toLowerCase().includes(topic))) return false;
      return true;
    });
  }, [hosts, activeTab, searchText, selectedLang, selectedTopic]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top bar: country tabs + search button */}
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <FlatList
          data={COUNTRY_TABS}
          horizontal
          keyExtractor={(t) => t.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
          renderItem={({ item }) => (
            <CountryTab tab={item} active={activeTab === item.key} colors={colors} onPress={() => setActiveTab(item.key)} />
          )}
        />
        <TouchableOpacity
          onPress={() => setSearchOpen((s) => !s)}
          style={[styles.globeBtn, { backgroundColor: colors.card, borderColor: colors.accentBorder }]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Search hosts"
        >
          <Image source={require("@/assets/icons/ic_search.png")} style={styles.globeIcon} tintColor={colors.accent} resizeMode="contain" />
        </TouchableOpacity>
      </View>

      {searchOpen && (
        <View style={[styles.searchWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Image source={require("@/assets/icons/ic_search.png")} style={styles.searchInputIcon} tintColor={colors.mutedForeground} resizeMode="contain" />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search by name…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.text }]}
            autoFocus
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.searchClear, { color: colors.mutedForeground }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Language + Talk-about filters */}
      <View style={styles.filterRow}>
        <FilterChip
          icon={require("@/assets/icons/ic_language.png")}
          iconTint="#FF8C00"
          label={selectedLang === "All" ? t.listener.language : selectedLang}
          active={selectedLang !== "All"}
          colors={colors}
          onPress={() => setShowLangModal(true)}
        />
        <FilterChip
          icon={require("@/assets/icons/ic_chat.png")}
          iconTint="#1499F1"
          label={selectedTopic === "All" ? t.listener.talkAbout : selectedTopic}
          active={selectedTopic !== "All"}
          colors={colors}
          onPress={() => setShowTopicModal(true)}
        />
      </View>

      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerWrap}>
          <Text style={styles.emptyEmoji}>🔍</Text>
          <Text style={[styles.emptyText, { color: colors.text }]}>No hosts found</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Try a different region or search.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(h) => h.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: H_PADDING }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          renderItem={({ item }) => (
            <HostGridCard
              host={item}
              colors={colors}
              onPress={() => router.push(`/user/hosts/${item.id}`)}
              onVideoCall={() => startVideoCall(item)}
            />
          )}
        />
      )}

      <FilterModal
        visible={showLangModal}
        title={t.listener.selectLanguage}
        options={LANGUAGES}
        selected={selectedLang}
        colors={colors}
        onSelect={setSelectedLang}
        onClose={() => setShowLangModal(false)}
      />
      <FilterModal
        visible={showTopicModal}
        title={t.listener.talkAbout}
        options={TOPICS}
        selected={selectedTopic}
        colors={colors}
        onSelect={setSelectedTopic}
        onClose={() => setShowTopicModal(false)}
      />

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

  // Top bar
  topBar: { flexDirection: "row", alignItems: "center", paddingRight: 12, paddingBottom: 12, gap: 8 },
  tabsRow: { paddingHorizontal: 12, gap: 10, alignItems: "center" },
  tabTouch: { borderRadius: 24 },
  tabPill: { borderRadius: 24, paddingHorizontal: 4, paddingVertical: 4 },
  tabInner: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 14 },
  tabFlag: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.06)" },
  tabGlobe: { fontSize: 22, width: 30, height: 30, textAlign: "center", lineHeight: 30 },
  tabLabel: { fontSize: 14, fontFamily: "Poppins_500Medium" },
  tabLabelActive: { fontFamily: "Poppins_700Bold" },

  globeBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1,
    alignItems: "center", justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
      web: { boxShadow: "0 2px 6px rgba(0,0,0,0.08)" } as any,
    }),
  },
  globeIcon: { width: 20, height: 20 },

  // Search input
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: H_PADDING, marginBottom: 10,
    borderRadius: 14, paddingHorizontal: 12, height: 46,
    borderWidth: 1,
  },
  searchInputIcon: { width: 18, height: 18 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular", padding: 0 },
  searchClear: { fontSize: 16, paddingHorizontal: 4 },

  // Language / Talk-about filter row
  filterRow: { flexDirection: "row", gap: 10, paddingHorizontal: H_PADDING, paddingBottom: 10 },
  filterChip: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1,
  },
  filterChipIcon: { width: 18, height: 18 },
  filterChipText: { flex: 1, fontSize: 13, fontFamily: "Poppins_500Medium" },
  filterChipArrow: { width: 11, height: 11, transform: [{ rotate: "-90deg" }] },

  // Filter bottom sheet
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  modalTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", marginBottom: 8 },
  modalOpt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1 },
  modalOptText: { fontSize: 15 },
  modalCheck: { width: 10, height: 10, borderRadius: 5 },

  // Grid card
  card: {
    width: CARD_W,
    aspectRatio: 0.86,
    borderRadius: 18,
    marginBottom: GRID_GAP,
    overflow: "hidden",
    borderWidth: 1,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 3 },
      web: { boxShadow: "0 3px 12px rgba(0,0,0,0.10)" } as any,
    }),
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
    color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  cardCountryRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardFlag: { width: 18, height: 13, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)" },
  cardCountry: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Poppins_400Regular", textTransform: "lowercase" },

  videoBtn: {
    width: 46, height: 46, borderRadius: 23,
    borderWidth: 2, borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  videoIcon: { width: 22, height: 22 },

  // States
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 80 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Poppins_400Regular" },
});

// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
