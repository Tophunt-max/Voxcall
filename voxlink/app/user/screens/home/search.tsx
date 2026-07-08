import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  ScrollView,
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

const SCREEN_W = Dimensions.get("window").width;
const H_PADDING = 12;
const GRID_GAP = 10;
const CARD_W = (SCREEN_W - H_PADDING * 2 - GRID_GAP) / 2;
// Full-width promo banner (spans both grid columns), embedded between host rows.
const BANNER_W = SCREEN_W - H_PADDING * 2;
const BANNER_AUTO_SLIDE_MS = 3500;
// The banner is injected into the host grid after this many host rows (each row
// = 2 cards). Matches the mid-grid placement in the reference design.
const BANNER_AFTER_ROWS = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Design palette — the reference design uses a specific light-blue / magenta /
// warm-red palette that must stay identical across light/dark themes (the
// screen is intentionally "themed" like the reference, not by the app palette).
// ─────────────────────────────────────────────────────────────────────────────
const DESIGN = {
  bgTop: "#B4D8FA",       // top of the sky-blue gradient
  bgMid: "#CFE4F7",       // mid stop, keeps the blue tint deeper for the cards
  bgBottom: "#EAF3FB",    // bottom of the gradient (near-white)
  categoryActive: "#111329",
  categoryInactive: "#4A5A6A",
  categoryUnderline: "#B02A5B", // dark wine underline under the active tab
  pillInactiveBg: "#DCEAF7",     // light-blue country pill
  pillInactiveText: "#1F2937",
  pillActiveGradient: ["#C64BE8", "#8A2BD8"] as const, // purple "All" gradient
  cardBadgeBg: "rgba(0,0,0,0.42)", // status pill background over card photos
  inviteGradient: ["#E43535", "#F26E3E"] as const,     // Invite Friends banner
  goLiveGradient: ["#FF4B81", "#FE3B6D"] as const,     // floating Go Live btn
  trophyBg: "rgba(255,255,255,0.55)",
  iconDark: "#1B2436",
};

// Category tabs across the top (design-driven; not backed by separate APIs).
// - Explore: default (all hosts)
// - New:     newer / lower-review hosts surfaced first
// - Pk:      hosts flagged as "Pk Battle" mode (deterministic assignment)
// - Follow:  hosts the current user has favorited
const CATEGORY_TABS = [
  { key: "Explore", label: "Explore" },
  { key: "New", label: "New" },
  { key: "Pk", label: "Pk" },
  { key: "Follow", label: "Follow" },
] as const;
type CategoryKey = typeof CATEGORY_TABS[number]["key"];

// Country filter tabs. `code` is the ISO alpha-2 matched against the host's
// country; `null` means no filter (All). The list is intentionally broad and
// alphabetical so the reference screenshot's "Algeria / Anguilla / Argentina …"
// scroll behaves the same here.
const COUNTRY_TABS: { key: string; label: string; code: string | null }[] = [
  { key: "ALL", label: "All", code: null },
  { key: "DZ", label: "Algeria", code: "DZ" },
  { key: "AI", label: "Anguilla", code: "AI" },
  { key: "AR", label: "Argentina", code: "AR" },
  { key: "AU", label: "Australia", code: "AU" },
  { key: "BD", label: "Bangladesh", code: "BD" },
  { key: "BR", label: "Brazil", code: "BR" },
  { key: "CA", label: "Canada", code: "CA" },
  { key: "CN", label: "China", code: "CN" },
  { key: "EG", label: "Egypt", code: "EG" },
  { key: "FR", label: "France", code: "FR" },
  { key: "DE", label: "Germany", code: "DE" },
  { key: "IN", label: "India", code: "IN" },
  { key: "ID", label: "Indonesia", code: "ID" },
  { key: "IT", label: "Italy", code: "IT" },
  { key: "JP", label: "Japan", code: "JP" },
  { key: "MY", label: "Malaysia", code: "MY" },
  { key: "MX", label: "Mexico", code: "MX" },
  { key: "NP", label: "Nepal", code: "NP" },
  { key: "NG", label: "Nigeria", code: "NG" },
  { key: "PK", label: "Pakistan", code: "PK" },
  { key: "PH", label: "Philippines", code: "PH" },
  { key: "RU", label: "Russia", code: "RU" },
  { key: "SA", label: "Saudi Arabia", code: "SA" },
  { key: "ES", label: "Spain", code: "ES" },
  { key: "LK", label: "Sri Lanka", code: "LK" },
  { key: "TR", label: "Turkey", code: "TR" },
  { key: "AE", label: "UAE", code: "AE" },
  { key: "GB", label: "United Kingdom", code: "GB" },
  { key: "US", label: "United States", code: "US" },
];

// Secondary filters (client-side): host language + what they talk about.
const LANGUAGES = ["All", "English", "Hindi", "Urdu", "Mandarin", "Spanish", "French", "Arabic"];
const TOPICS = ["All", "Life Coaching", "Career", "Wellness", "Relationships", "Meditation", "Finance", "Education"];

// Card status modes (top-right badge on each card). Reference design shows
// a mix of "Audio Live", "Pk Battle", "Live", and "Multi Live". Our voice-call
// app does not carry these modes on the backend today, so we derive them
// deterministically from the host id so each card keeps a stable badge but the
// grid looks varied (matches the reference visually).
type CardMode = "audio_live" | "pk_battle" | "live" | "multi_live";
const MODE_BUCKETS: CardMode[] = ["audio_live", "pk_battle", "live", "multi_live"];

// FNV-1a hash → stable 32-bit int for a host id.
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickMode(hostId: string, isOnline: boolean): CardMode {
  if (!isOnline) return "audio_live"; // still needs a base to render offline visually similar
  return MODE_BUCKETS[stableHash(hostId) % MODE_BUCKETS.length];
}

// Deterministic small viewer count so cards don't all show 0. Range 0–99.
function pseudoViewerCount(hostId: string, isOnline: boolean): number {
  if (!isOnline) return 0;
  return stableHash(hostId + "v") % 100;
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
    handle: (h.username || h.handle || (h.display_name || h.name || "host")).toString().replace(/\s+/g, ""),
    avatar: resolveMediaUrl(h.avatar_url) || `https://api.dicebear.com/7.x/avataaars/png?seed=${h.id}`,
    coinsPerMinute: Number(h.audio_coins_per_minute ?? h.coins_per_minute) || 1,
    videoCoinsPerMinute: Number(h.video_coins_per_minute ?? h.coins_per_minute) || 1,
    isOnline: !!h.is_online,
    reviewCount: Number(h.review_count) || 0,
    languages: Array.isArray(h.languages) ? h.languages : (() => { try { return JSON.parse(h.languages || "[]"); } catch { return []; } })(),
    specialties: Array.isArray(h.specialties) ? h.specialties : (() => { try { return JSON.parse(h.specialties || "[]"); } catch { return []; } })(),
    country: (h.country || "").toString().trim(),
  };
}
type UIHost = ReturnType<typeof mapApiHost>;

// ─── Card status badge (top-right) ───────────────────────────────────────────
function ModeBadge({ mode }: { mode: CardMode }) {
  if (mode === "pk_battle") {
    // Pk Battle: dark pill with a small yellow/orange "PK" chip on the left,
    // matching the design's distinctive purple/red PK stream indicator.
    return (
      <View style={styles.modeBadge}>
        <View style={styles.pkChip}>
          <Text style={styles.pkChipText}>PK</Text>
        </View>
        <Text style={styles.modeText}>Pk Battle</Text>
      </View>
    );
  }
  if (mode === "audio_live") {
    return (
      <View style={styles.modeBadge}>
        <Image source={require("@/assets/icons/ic_mic.png")} style={styles.modeIcon} tintColor="#fff" resizeMode="contain" />
        <Text style={styles.modeText}>Audio Live</Text>
      </View>
    );
  }
  if (mode === "multi_live") {
    return (
      <View style={styles.modeBadge}>
        <Image source={require("@/assets/icons/ic_users.png")} style={styles.modeIcon} tintColor="#fff" resizeMode="contain" />
        <Text style={styles.modeText}>Multi Live</Text>
      </View>
    );
  }
  // "live"
  return (
    <View style={styles.modeBadge}>
      <Image source={require("@/assets/icons/ic_speaking.png")} style={styles.modeIcon} tintColor="#fff" resizeMode="contain" />
      <Text style={styles.modeText}>Live</Text>
    </View>
  );
}

// ─── Country tab pill ────────────────────────────────────────────────────────
function CountryTab({ tab, active, onPress }: { tab: typeof COUNTRY_TABS[number]; active: boolean; onPress: () => void }) {
  const inner = (
    <View style={styles.tabInner}>
      {tab.code ? (
        <Image source={{ uri: flagUrl(tab.code, 80) }} style={styles.tabFlag} resizeMode="cover" />
      ) : null}
      <Text style={[styles.tabLabel, { color: active ? "#fff" : DESIGN.pillInactiveText }, active && styles.tabLabelActive]}>
        {tab.label}
      </Text>
    </View>
  );
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.tabTouch}>
      {active ? (
        <LinearGradient colors={DESIGN.pillActiveGradient as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.tabPill}>
          {inner}
        </LinearGradient>
      ) : (
        <View style={[styles.tabPill, { backgroundColor: DESIGN.pillInactiveBg }]}>
          {inner}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Host grid card (photo-background style) ─────────────────────────────────
function HostGridCard({ host, mode, viewers, onPress, onAudioCall }: {
  host: UIHost;
  mode: CardMode;
  viewers: number;
  onPress: () => void;
  onAudioCall: () => void;
  /** Reserved for a future secondary gesture — the reference design shows no
   *  video button on the card itself, so this hook is intentionally not wired
   *  here. Kept in the parent's startCall path only. */
  onVideoCall?: () => void;
}) {
  // Tap card = open profile; long-press = start audio call. We keep the
  // audio/video call handlers wired so parent screen can trigger them from
  // any long-press / secondary gesture (existing behavior preserved).
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.92}
      onPress={onPress}
      onLongPress={host.isOnline ? onAudioCall : undefined}
      accessibilityLabel={`${host.name} — ${host.isOnline ? "online" : "offline"}`}
    >
      <Image source={{ uri: host.avatar }} style={styles.cardAvatar} resizeMode="cover" />

      {/* Offline hosts get a subtle desaturation overlay so online cards pop. */}
      {!host.isOnline && <View style={styles.offlineDim} pointerEvents="none" />}

      {/* Bottom-to-top dark gradient keeps the name / handle / flag legible over
          any photo, independent of theme. */}
      <LinearGradient
        colors={["transparent", "rgba(10,6,24,0.15)", "rgba(10,6,24,0.85)"]}
        style={styles.cardOverlay}
        pointerEvents="none"
      />

      {/* Top-left: viewer/listener count pill with sound-wave icon. */}
      <View style={styles.viewersPill}>
        <Image source={require("@/assets/icons/ic_speaking.png")} style={styles.viewersIcon} tintColor="#fff" resizeMode="contain" />
        <Text style={styles.viewersText}>{viewers}</Text>
      </View>

      {/* Top-right: mode/status badge (Audio Live / Pk Battle / …). */}
      <View style={styles.modeBadgeWrap}>
        <ModeBadge mode={mode} />
      </View>

      {/* Bottom: small round avatar + name/handle, and country flag on the right. */}
      <View style={styles.cardBottom} pointerEvents="none">
        <View style={styles.cardBottomLeft}>
          <View style={styles.smallAvatarRing}>
            <Image source={{ uri: host.avatar }} style={styles.smallAvatar} resizeMode="cover" />
          </View>
          <View style={styles.cardNameCol}>
            <Text style={styles.cardName} numberOfLines={1}>{host.name}</Text>
            <Text style={styles.cardHandle} numberOfLines={1}>@{host.handle}</Text>
          </View>
        </View>
        {host.country ? (
          <Image source={{ uri: flagUrl(host.country, 40) }} style={styles.cardFlag} resizeMode="cover" />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Combined filters bottom-sheet (Language + Talk About) ───────────────────
// Opened by tapping the "three-line" list icon on the right of the country row.
// Shows BOTH filters in one sheet so the user can pick a language and a topic
// in a single interaction, then apply or reset from the footer.
function FiltersSheet({
  visible,
  lang, topic,
  languagesLabel, talkAboutLabel,
  onApply, onClose,
}: {
  visible: boolean;
  lang: string;
  topic: string;
  languagesLabel: string;
  talkAboutLabel: string;
  onApply: (nextLang: string, nextTopic: string) => void;
  onClose: () => void;
}) {
  // Draft state so the parent's filters don't update until the user hits Apply.
  const [draftLang, setDraftLang] = useState(lang);
  const [draftTopic, setDraftTopic] = useState(topic);

  // Reset the draft every time the sheet is (re)opened so it mirrors the
  // parent's currently-applied filters.
  useEffect(() => {
    if (visible) {
      setDraftLang(lang);
      setDraftTopic(topic);
    }
  }, [visible, lang, topic]);

  const renderChip = (value: string, isSelected: boolean, onPress: () => void) => {
    const inner = (
      <Text style={[styles.sheetChipText, { color: isSelected ? "#fff" : DESIGN.pillInactiveText }, isSelected && styles.sheetChipTextActive]} numberOfLines={1}>
        {value}
      </Text>
    );
    return (
      <TouchableOpacity key={value} onPress={onPress} activeOpacity={0.85} style={styles.sheetChipTouch}>
        {isSelected ? (
          <LinearGradient colors={DESIGN.pillActiveGradient as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sheetChip}>
            {inner}
          </LinearGradient>
        ) : (
          <View style={[styles.sheetChip, { backgroundColor: DESIGN.pillInactiveBg }]}>{inner}</View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the backdrop dismisses. `activeOpacity=1` avoids the flash
          on Android when the user just wants to close by tapping outside. */}
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        {/* Inner TouchableOpacity with onPress={undefined} would still swallow
            events; use a View so backdrop taps propagate correctly. */}
        <View style={[styles.modalSheet, { backgroundColor: "#fff" }]} onStartShouldSetResponder={() => true}>
          <View style={[styles.modalHandle, { backgroundColor: "#D6DEE7" }]} />
          <Text style={[styles.modalTitle, { color: DESIGN.categoryActive }]}>Filters</Text>

          {/* ── Language section ─────────────────────────────────────── */}
          <Text style={[styles.sheetSectionTitle, { color: DESIGN.categoryActive }]}>{languagesLabel}</Text>
          <View style={styles.sheetChipsWrap}>
            {LANGUAGES.map((opt) => renderChip(opt, draftLang === opt, () => setDraftLang(opt)))}
          </View>

          {/* ── Talk About section ───────────────────────────────────── */}
          <Text style={[styles.sheetSectionTitle, { color: DESIGN.categoryActive, marginTop: 18 }]}>{talkAboutLabel}</Text>
          <View style={styles.sheetChipsWrap}>
            {TOPICS.map((opt) => renderChip(opt, draftTopic === opt, () => setDraftTopic(opt)))}
          </View>

          {/* ── Footer: Reset + Apply ─────────────────────────────────── */}
          <View style={styles.sheetFooter}>
            <TouchableOpacity
              onPress={() => { setDraftLang("All"); setDraftTopic("All"); }}
              activeOpacity={0.8}
              style={styles.sheetResetBtn}
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
            >
              <Text style={[styles.sheetResetText, { color: DESIGN.categoryActive }]}>Reset</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { onApply(draftLang, draftTopic); onClose(); }}
              activeOpacity={0.9}
              style={styles.sheetApplyWrap}
              accessibilityRole="button"
              accessibilityLabel="Apply filters"
            >
              <LinearGradient
                colors={DESIGN.pillActiveGradient as any}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.sheetApplyBtn}
              >
                <Text style={styles.sheetApplyText}>Apply</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Admin-managed banner shape (from `/api/banners?position=search`) ────────
type Banner = {
  id: string;
  title: string;
  subtitle?: string;
  image_url?: string;
  bg_color?: string;
  cta_text?: string;
  cta_link?: string;
};

// Rows for the vertical grid: a "pair" holds up to 2 host cards (a single card
// on the last odd row); "promo" is the unified admin-managed banner slot
// injected mid-grid (which falls back to the built-in Invite Friends card).
type ListRow =
  | { kind: "pair"; key: string; items: UIHost[] }
  | { kind: "promo"; key: string };

// ─── Built-in "Invite Friends" fallback slide ────────────────────────────────
// Rendered inside the promo slider when no admin banner is configured, so the
// UX always shows a promo and admins can override it any time from the panel.
function InviteFriendsSlide() {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => router.push("/user/referral" as any)}
      accessibilityRole="button"
      accessibilityLabel="Invite friends — earn up to 10k coins per invite"
      style={styles.promoSlide}
    >
      <LinearGradient
        colors={DESIGN.inviteGradient as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.promoGrad}
      >
        <View style={styles.inviteTextCol}>
          <Text style={styles.inviteTitle}>Invite Friends</Text>
          <View style={styles.inviteBadge}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.inviteCoinIcon} resizeMode="contain" />
            <Text style={styles.inviteBadgeText}>Up to 10k per invite</Text>
          </View>
        </View>
        <Image
          source={require("@/assets/images/coin_large.png")}
          style={styles.inviteImage}
          resizeMode="contain"
        />
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Admin-managed banner slide (title / subtitle / CTA / image / bg) ────────
function AdminBannerSlide({ item }: { item: Banner }) {
  const bg = item.bg_color?.trim() || "#8A2BD8";
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => { if (item.cta_link) router.push(item.cta_link as any); }}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      style={[styles.promoSlide, { backgroundColor: bg }]}
    >
      <View style={styles.adminBannerTextCol}>
        <Text style={styles.adminBannerTitle} numberOfLines={2}>{item.title}</Text>
        {item.subtitle ? <Text style={styles.adminBannerSub} numberOfLines={2}>{item.subtitle}</Text> : null}
        {item.cta_text ? (
          <View style={styles.adminBannerCta}>
            <Text style={styles.adminBannerCtaText}>{item.cta_text}</Text>
          </View>
        ) : null}
      </View>
      {item.image_url ? (
        <Image source={{ uri: resolveMediaUrl(item.image_url) }} style={styles.adminBannerImage} resizeMode="contain" />
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Unified promo slot ──────────────────────────────────────────────────────
// One slot, one slider. Admin-managed banners come first (in creation order),
// and the built-in Invite Friends slide is always appended as the last slide
// so users see the referral offer at least once even when the admin panel is
// empty. When there is a single slide (admin OR fallback), the pagination
// dots are hidden and auto-slide disabled.
function PromoSlider({ banners }: { banners: Banner[] }) {
  // Total slide count = admin banners + 1 (built-in fallback / invite slide).
  const total = banners.length + 1;

  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<FlatList<number>>(null);
  const currentIdx = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((idx: number) => {
    if (!listRef.current || total === 0) return;
    const safe = Math.max(0, Math.min(idx, total - 1));
    listRef.current.scrollToIndex({ index: safe, animated: true });
    currentIdx.current = safe;
    setActiveIdx(safe);
  }, [total]);

  const restart = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (total <= 1) return;
    timerRef.current = setInterval(() => {
      goTo((currentIdx.current + 1) % total);
    }, BANNER_AUTO_SLIDE_MS);
  }, [total, goTo]);

  useEffect(() => {
    restart();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [restart]);

  const onMomentumEnd = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / BANNER_W);
    currentIdx.current = idx;
    setActiveIdx(idx);
    restart();
  }, [restart]);

  // `data` is a numeric index array — actual slide content is chosen by
  // `renderItem` (admin banner if it exists at that index, otherwise the
  // built-in Invite Friends fallback on the last index).
  const data = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);

  const renderSlide = ({ item: idx }: { item: number }) => (
    <View style={{ width: BANNER_W }}>
      {idx < banners.length ? <AdminBannerSlide item={banners[idx]} /> : <InviteFriendsSlide />}
    </View>
  );

  return (
    <View style={styles.promoWrap}>
      <FlatList
        ref={listRef}
        data={data}
        horizontal
        pagingEnabled={Platform.OS !== "web"}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(i) => `slide-${i}`}
        renderItem={renderSlide}
        onMomentumScrollEnd={onMomentumEnd}
        snapToInterval={BANNER_W}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: BANNER_W, offset: BANNER_W * index, index })}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true }), 50);
        }}
        style={{ width: BANNER_W }}
      />
      {total > 1 && (
        <View style={styles.bannerDots}>
          {data.map((i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <View style={[styles.bannerDot, activeIdx === i && styles.bannerDotActive]} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { initiateCall } = useCall();

  const [activeCategory, setActiveCategory] = useState<CategoryKey>("Explore");
  const [activeCountry, setActiveCountry] = useState("ALL");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedLang, setSelectedLang] = useState("All");
  const [selectedTopic, setSelectedTopic] = useState("All");
  // Single sheet showing BOTH filters (opened via the list icon).
  const [showFiltersSheet, setShowFiltersSheet] = useState(false);
  const [hosts, setHosts] = useState<UIHost[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [banners, setBanners] = useState<Banner[]>([]);
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

  const loadFavorites = useCallback(async () => {
    try {
      const rows = await (API as any).getFavorites?.();
      if (Array.isArray(rows)) {
        setFavIds(new Set(rows.map((r: any) => (r.host_id ?? r.id) as string)));
      }
    } catch {
      // Older backend or unauthed — Follow tab just shows nothing gracefully.
      setFavIds(new Set());
    }
  }, []);

  // Admin-managed promo banners for the search page (position "search_top" in
  // the admin Banners panel). Best-effort: an error / older backend simply
  // yields no banner and the grid renders with only the built-in Invite banner.
  const loadBanners = useCallback(async () => {
    try {
      const res = await API.getBanners("search");
      setBanners(Array.isArray(res) ? (res as Banner[]) : []);
    } catch {
      setBanners([]);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadHosts(), loadBanners(), loadFavorites()]).finally(() => setLoading(false));
  }, [loadHosts, loadBanners, loadFavorites]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadHosts(), loadBanners(), loadFavorites()]);
    setRefreshing(false);
  }, [loadHosts, loadBanners, loadFavorites]);

  const startCall = useCallback((host: UIHost, type: "audio" | "video") => {
    // Offline hosts can't be called — open their profile instead.
    if (!host.isOnline) {
      router.push(`/user/hosts/${host.id}` as any);
      return;
    }
    const rate = (type === "video" ? host.videoCoinsPerMinute : host.coinsPerMinute) || host.coinsPerMinute || 1;
    const required = rate * 2;
    if ((user?.coins ?? 0) < required) {
      setCoinPopupRequired(required);
      setCoinPopup(true);
      return;
    }
    initiateCall({ id: host.id, name: host.name, avatar: host.avatar, role: "host" }, type, rate);
    router.push({ pathname: "/user/call/outgoing", params: { hostId: host.id, callType: type, hostName: host.name, hostAvatar: host.avatar, specialty: host.specialties?.[0] ?? "" } });
  }, [user?.coins, initiateCall]);

  // Filtered list: apply search text, country, language, topic, then category.
  const filtered = useMemo(() => {
    const country = COUNTRY_TABS.find((c) => c.key === activeCountry);
    const q = searchText.trim().toLowerCase();
    const lang = selectedLang.toLowerCase();
    const topic = selectedTopic.toLowerCase();

    let list = hosts.filter((h) => {
      if (country?.code && h.country.toUpperCase() !== country.code) return false;
      if (q && !h.name.toLowerCase().includes(q) && !h.handle.toLowerCase().includes(q)) return false;
      if (selectedLang !== "All" && !h.languages.some((l: string) => l.toLowerCase() === lang)) return false;
      if (selectedTopic !== "All" && !h.specialties.some((s: string) => s.toLowerCase().includes(topic))) return false;
      return true;
    });

    // Category tabs (design-driven filters over the same host list).
    switch (activeCategory) {
      case "New":
        // Newer hosts surface first: proxy for "new" = fewer reviews.
        list = [...list].sort((a, b) => a.reviewCount - b.reviewCount);
        break;
      case "Pk":
        // Only hosts whose deterministic mode is Pk Battle.
        list = list.filter((h) => pickMode(h.id, h.isOnline) === "pk_battle");
        break;
      case "Follow":
        list = list.filter((h) => favIds.has(h.id));
        break;
      case "Explore":
      default:
        break;
    }
    return list;
  }, [hosts, activeCountry, searchText, selectedLang, selectedTopic, activeCategory, favIds]);

  // Build the vertical list rows: hosts are chunked into pairs (2 columns) and
  // a SINGLE unified promo row (admin banners + built-in Invite fallback) is
  // injected mid-grid. The admin panel controls what plays in that slot;
  // if nothing is configured, the Invite Friends slide is shown by default.
  const rows = useMemo(() => {
    const out: ListRow[] = [];
    for (let i = 0; i < filtered.length; i += 2) {
      out.push({ kind: "pair", key: `pair-${filtered[i].id}`, items: filtered.slice(i, i + 2) });
    }
    if (out.length > 0) {
      const insertAt = Math.min(BANNER_AFTER_ROWS, out.length);
      out.splice(insertAt, 0, { kind: "promo", key: "promo-row" });
    }
    return out;
  }, [filtered]);

  return (
    <LinearGradient
      colors={[DESIGN.bgTop, DESIGN.bgMid, DESIGN.bgBottom]}
      locations={[0, 0.35, 1]}
      style={styles.container}
    >
      {/* ── Category tabs + search + trophy (top row) ───────────────────── */}
      <View style={[styles.headerRow, { paddingTop: insets.top + 10 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesRow}
        >
          {CATEGORY_TABS.map((c) => {
            const active = activeCategory === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => setActiveCategory(c.key)}
                activeOpacity={0.8}
                style={styles.categoryTab}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[
                  styles.categoryText,
                  { color: active ? DESIGN.categoryActive : DESIGN.categoryInactive },
                  active && styles.categoryTextActive,
                ]}>
                  {c.label}
                </Text>
                {active && <View style={styles.categoryUnderline} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity
          onPress={() => setSearchOpen((s) => !s)}
          style={styles.headerIconBtn}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Search hosts"
        >
          <Image source={require("@/assets/icons/ic_search.png")} style={styles.headerIcon} tintColor={DESIGN.iconDark} resizeMode="contain" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push("/user/hosts/all" as any)}
          style={[styles.trophyBtn, { backgroundColor: DESIGN.trophyBg }]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Leaderboard"
        >
          {/* Emoji trophy is safe in the header — it isn't the flag emoji case
              that breaks on Android; the trophy renders cross-platform. */}
          <Text style={styles.trophyEmoji}>🏆</Text>
        </TouchableOpacity>
      </View>

      {/* ── Country pill row + list icon ────────────────────────────────── */}
      <View style={styles.countryRow}>
        <FlatList
          data={COUNTRY_TABS}
          horizontal
          keyExtractor={(c) => c.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.countryList}
          renderItem={({ item }) => (
            <CountryTab tab={item} active={activeCountry === item.key} onPress={() => setActiveCountry(item.key)} />
          )}
        />
        <TouchableOpacity
          onPress={() => setShowFiltersSheet(true)}
          style={styles.listIconBtn}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Open language and topic filters"
        >
          <View style={styles.listIconLine} />
          <View style={[styles.listIconLine, { width: 14 }]} />
          <View style={[styles.listIconLine, { width: 10 }]} />
          {/* Small dot indicates one or more filters are active. */}
          {(selectedLang !== "All" || selectedTopic !== "All") && (
            <View style={styles.listIconDot} pointerEvents="none" />
          )}
        </TouchableOpacity>
      </View>

      {/* ── Search field (revealed when the search icon is tapped) ──────── */}
      {searchOpen && (
        <View style={styles.searchWrap}>
          <Image source={require("@/assets/icons/ic_search.png")} style={styles.searchInputIcon} tintColor={DESIGN.categoryInactive} resizeMode="contain" />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search by name or @handle…"
            placeholderTextColor={DESIGN.categoryInactive}
            style={[styles.searchInput, { color: DESIGN.categoryActive }]}
            autoFocus
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.searchClear, { color: DESIGN.categoryInactive }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Optional secondary filters (kept, but hidden by default under the
          list-icon in the country row — shown only when the language sheet is
          triggered via the list icon). The Language/Topic chips row itself is
          intentionally removed to match the reference exactly. */}

      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerWrap}>
          <Text style={styles.emptyEmoji}>🔍</Text>
          <Text style={[styles.emptyText, { color: DESIGN.categoryActive }]}>No hosts found</Text>
          <Text style={[styles.emptySub, { color: DESIGN.categoryInactive }]}>Try another category, country, or search.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: insets.bottom + 130, paddingHorizontal: H_PADDING }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          renderItem={({ item }) => {
            if (item.kind === "promo") return <PromoSlider banners={banners} />;
            return (
              <View style={styles.gridRow}>
                {item.items.map((h) => (
                  <HostGridCard
                    key={h.id}
                    host={h}
                    mode={pickMode(h.id, h.isOnline)}
                    viewers={pseudoViewerCount(h.id, h.isOnline)}
                    onPress={() => router.push(`/user/hosts/${h.id}` as any)}
                    onAudioCall={() => startCall(h, "audio")}
                    onVideoCall={() => startCall(h, "video")}
                  />
                ))}
                {/* Keep the last odd card left-aligned instead of stretched. */}
                {item.items.length === 1 && <View style={{ width: CARD_W }} />}
              </View>
            );
          }}
        />
      )}

      {/* ── Floating Go Live button (bottom-right) ──────────────────────── */}
      <TouchableOpacity
        onPress={() => router.push("/user/screens/home/random" as any)}
        activeOpacity={0.9}
        style={[styles.goLiveWrap, { bottom: insets.bottom + 20 }]}
        accessibilityRole="button"
        accessibilityLabel="Go live"
      >
        <LinearGradient
          colors={DESIGN.goLiveGradient as any}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.goLiveBtn}
        >
          <Image source={require("@/assets/icons/ic_video.png")} style={styles.goLiveIcon} tintColor="#fff" resizeMode="contain" />
          <Text style={styles.goLiveText}>Go Live</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Combined Language + Talk About sheet, opened via the list icon in
          the country row. Both filters live in one sheet with a shared
          Reset / Apply footer. */}
      <FiltersSheet
        visible={showFiltersSheet}
        lang={selectedLang}
        topic={selectedTopic}
        languagesLabel={t.listener.selectLanguage}
        talkAboutLabel={t.listener.talkAbout}
        onApply={(nextLang, nextTopic) => {
          setSelectedLang(nextLang);
          setSelectedTopic(nextTopic);
        }}
        onClose={() => setShowFiltersSheet(false)}
      />

      <InsufficientCoinsPopup
        visible={coinPopup}
        onClose={() => setCoinPopup(false)}
        requiredCoins={coinPopupRequired}
        currentCoins={user?.coins ?? 0}
      />
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },

  // Top header row (category tabs + search + trophy)
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 8,
    gap: 8,
  },
  categoriesRow: { alignItems: "center", gap: 16, paddingRight: 8 },
  categoryTab: { alignItems: "center", paddingVertical: 6 },
  categoryText: { fontSize: 17, fontFamily: "Poppins_500Medium" },
  categoryTextActive: { fontFamily: "Poppins_700Bold" },
  categoryUnderline: {
    marginTop: 3,
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: DESIGN.categoryUnderline,
  },

  headerIconBtn: {
    width: 34, height: 34,
    alignItems: "center", justifyContent: "center",
  },
  headerIcon: { width: 22, height: 22 },
  trophyBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
  },
  trophyEmoji: { fontSize: 20 },

  // Country pill row
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: H_PADDING,
    paddingRight: 8,
    paddingBottom: 10,
    gap: 6,
  },
  countryList: { alignItems: "center", gap: 8, paddingRight: 4 },
  tabTouch: { borderRadius: 22 },
  tabPill: {
    borderRadius: 22,
    paddingLeft: 4,
    paddingRight: 14,
    paddingVertical: 4,
    minHeight: 34,
    justifyContent: "center",
  },
  tabInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  tabFlag: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.5)" },
  tabLabel: { fontSize: 13.5, fontFamily: "Poppins_500Medium" },
  tabLabelActive: { fontFamily: "Poppins_700Bold" },
  listIconBtn: {
    width: 34, height: 34, borderRadius: 8,
    alignItems: "flex-end", justifyContent: "center",
    paddingHorizontal: 6,
    gap: 3,
  },
  listIconLine: {
    height: 2, width: 18, backgroundColor: DESIGN.iconDark, borderRadius: 1,
  },
  listIconDot: {
    position: "absolute",
    top: 4,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: DESIGN.pillActiveGradient[0],
    borderWidth: 1.5,
    borderColor: "#fff",
  },

  // Search input (revealed on tap)
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: H_PADDING, marginBottom: 10,
    borderRadius: 14, paddingHorizontal: 12, height: 44,
    backgroundColor: "rgba(255,255,255,0.75)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.9)",
  },
  searchInputIcon: { width: 18, height: 18 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular", padding: 0 },
  searchClear: { fontSize: 16, paddingHorizontal: 4 },

  // Grid row (2 columns of host cards)
  gridRow: { flexDirection: "row", gap: GRID_GAP, marginBottom: GRID_GAP },

  // ── Host card ────────────────────────────────────────────────────────────
  card: {
    width: CARD_W,
    // Taller card grid — lower aspect ratio = taller cards. Bumped from 0.78
    // → 0.72 so photos have more vertical breathing room and the bottom name
    // overlay is more prominent (closer to the reference proportions).
    aspectRatio: 0.72,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#DDE6EF",
    ...Platform.select({
      ios: { shadowColor: "#0B1A2B", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
      web: { boxShadow: "0 4px 14px rgba(11,26,43,0.15)" } as any,
    }),
  },
  cardAvatar: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  cardOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },
  offlineDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,6,24,0.38)" },

  // Viewer/listener pill (top-left)
  viewersPill: {
    position: "absolute", top: 10, left: 10,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: DESIGN.cardBadgeBg,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
  },
  viewersIcon: { width: 12, height: 12 },
  viewersText: { color: "#fff", fontSize: 11, fontFamily: "Poppins_600SemiBold" },

  // Mode/status badge (top-right)
  modeBadgeWrap: { position: "absolute", top: 10, right: 10 },
  modeBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: DESIGN.cardBadgeBg,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
  },
  modeIcon: { width: 12, height: 12 },
  modeText: { color: "#fff", fontSize: 10.5, fontFamily: "Poppins_600SemiBold" },
  pkChip: {
    backgroundColor: "#FFB800",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 8,
  },
  pkChipText: { color: "#7A2A08", fontSize: 9, fontFamily: "Poppins_700Bold", letterSpacing: 0.3 },

  // Bottom row (avatar + name/handle + flag)
  cardBottom: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: 10,
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
  },
  cardBottomLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  smallAvatarRing: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: "rgba(255,255,255,0.9)",
    overflow: "hidden", backgroundColor: "rgba(255,255,255,0.2)",
  },
  smallAvatar: { width: "100%", height: "100%" },
  cardNameCol: { flex: 1, minWidth: 0 },
  cardName: {
    color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  cardHandle: {
    color: "rgba(255,255,255,0.85)", fontSize: 10.5, fontFamily: "Poppins_400Regular",
    textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  cardFlag: { width: 22, height: 16, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.15)" },

  // ── Unified promo slot (admin banners + Invite Friends fallback) ─────────
  // The slot is a horizontally-paged slider; each slide is one full-width
  // banner card. Height is intentionally compact so it doesn't push the host
  // grid too far down (~30% shorter than before).
  promoWrap: {
    alignItems: "center",
    marginBottom: GRID_GAP,
  },
  promoSlide: {
    width: BANNER_W,
    minHeight: 108,
    borderRadius: 18,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#0B1A2B", shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
      web: { boxShadow: "0 4px 12px rgba(11,26,43,0.18)" } as any,
    }),
  },
  promoGrad: {
    flex: 1,
    minHeight: 108,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 18,
    paddingRight: 8,
    paddingVertical: 12,
  },

  // Invite Friends (built-in fallback slide) text + image
  inviteTextCol: { flex: 1, gap: 2 },
  inviteTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontFamily: "Poppins_700Bold",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  inviteBadge: {
    marginTop: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  inviteCoinIcon: { width: 14, height: 14 },
  inviteBadgeText: { color: "#fff", fontSize: 11.5, fontFamily: "Poppins_600SemiBold" },
  inviteImage: { width: 88, height: 88, marginLeft: 4 },

  // Admin banner slide text + image
  adminBannerTextCol: {
    flex: 1,
    gap: 4,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 8,
    justifyContent: "center",
  },
  adminBannerTitle: { fontSize: 16, lineHeight: 20, fontFamily: "Poppins_700Bold", color: "#fff" },
  adminBannerSub: { fontSize: 11.5, lineHeight: 15, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.9)" },
  adminBannerCta: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 18,
    marginTop: 4,
  },
  adminBannerCtaText: { fontSize: 11, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  adminBannerImage: { width: 76, height: 76, marginRight: 8 },

  // Pagination dots under the slider
  bannerDots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 8 },
  bannerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(0,0,0,0.15)" },
  bannerDotActive: { width: 20, borderRadius: 3, backgroundColor: DESIGN.categoryUnderline },

  // ── Floating "Go Live" button ────────────────────────────────────────────
  goLiveWrap: {
    position: "absolute",
    right: 16,
    borderRadius: 32,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#FF3D6E", shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 8 },
      web: { boxShadow: "0 6px 16px rgba(255,61,110,0.45)" } as any,
    }),
  },
  goLiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 32,
  },
  goLiveIcon: { width: 20, height: 20 },
  goLiveText: { color: "#fff", fontSize: 14, fontFamily: "Poppins_700Bold" },

  // Bottom-sheet modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 34 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  modalTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", marginBottom: 8 },

  // Filters sheet — section title + chip grid + footer
  sheetSectionTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold", marginBottom: 10, marginTop: 6 },
  sheetChipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sheetChipTouch: { borderRadius: 22 },
  sheetChip: {
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetChipText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  sheetChipTextActive: { fontFamily: "Poppins_700Bold" },

  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 22,
  },
  sheetResetBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DESIGN.pillInactiveBg,
  },
  sheetResetText: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  sheetApplyWrap: {
    flex: 1.4,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#8A2BD8", shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
      web: { boxShadow: "0 4px 12px rgba(138,43,216,0.25)" } as any,
    }),
  },
  sheetApplyBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetApplyText: { color: "#fff", fontSize: 14, fontFamily: "Poppins_700Bold" },

  // Empty / loading states
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 80 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 16, fontFamily: "Poppins_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Poppins_400Regular" },
});

// Per-screen error boundary — a render crash on the search screen stays
// contained (retry / go back) instead of blanking the whole app.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
