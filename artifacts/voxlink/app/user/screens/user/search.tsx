import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { API } from "@/services/api";

function mapApiHost(h: any) {
  return {
    id: h.id,
    name: h.display_name || h.name || "Host",
    avatar: h.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${h.id}`,
    bio: h.bio || "",
    rating: Number(h.rating) || 0,
    reviewCount: Number(h.review_count) || 0,
    languages: Array.isArray(h.languages) ? h.languages : (() => { try { return JSON.parse(h.languages || "[]"); } catch { return []; } })(),
    specialties: Array.isArray(h.specialties) ? h.specialties : (() => { try { return JSON.parse(h.specialties || "[]"); } catch { return []; } })(),
    coinsPerMinute: Number(h.coins_per_minute) || 1,
    totalMinutes: Number(h.total_minutes) || 0,
    isOnline: !!h.is_online,
    isTopRated: !!h.is_top_rated,
    gender: h.gender || "male",
    country: h.country || "",
  };
}

const LIGHT_PURPLE = "#F3E4FF";
const ACCENT = "#A00EE7";
const DARK = "#111329";
const GREY = "#757396";

const LANGUAGES = ["All", "English", "Mandarin", "Hindi", "Spanish", "French", "Arabic"];
const TOPICS = ["All", "Life Coaching", "Career", "Wellness", "Relationships", "Meditation", "Finance", "Education"];

function StatusBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <View style={[styles.statusBadge, { backgroundColor: isOnline ? "#E6F9EA" : "#F2F2F2" }]}>
      <View style={[styles.statusDot, { backgroundColor: isOnline ? "#0BAF23" : "#A9A9A9" }]} />
      <Text style={[styles.statusText, { color: isOnline ? "#0BAF23" : "#A9A9A9" }]}>
        {isOnline ? "Available" : "Offline"}
      </Text>
    </View>
  );
}

function ListenerCard({ host, onPress }: { host: ReturnType<typeof mapApiHost>; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.cardContent}>
        <View style={styles.avatarWrap}>
          <Image
            source={{ uri: host.avatar }}
            style={styles.avatar}
            resizeMode="cover"
          />
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{host.name}</Text>
            <StatusBadge isOnline={host.isOnline} />
          </View>
          <View style={styles.langRow}>
            <Image source={require("@/assets/icons/ic_language.png")} style={styles.smallIcon} tintColor={GREY} resizeMode="contain" />
            <Text style={styles.langText}>{host.languages.join(", ")}</Text>
          </View>
          <View style={styles.topicsRow}>
            {host.specialties.slice(0, 2).map((t) => (
              <View key={t} style={styles.topicChip}>
                <Text style={styles.topicChipText} numberOfLines={1}>{t}</Text>
              </View>
            ))}
          </View>
          <View style={styles.statsRow}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
            <Text style={styles.coinText}>{host.coinsPerMinute}/min</Text>
            <View style={styles.callCountWrap}>
              <Image source={require("@/assets/icons/ic_call.png")} style={styles.smallIcon} tintColor={GREY} resizeMode="contain" />
              <Text style={styles.callCountText}>{(host.totalMinutes / 60).toFixed(0)} hrs</Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity onPress={onPress} style={styles.viewProfileBtn}>
          <Text style={styles.viewProfileText}>View Profile</Text>
        </TouchableOpacity>
        {host.isOnline && (
          <TouchableOpacity onPress={() => router.push(`/shared/call/outgoing?hostId=${host.id}`)} style={styles.talkNowBtn}>
            <Image source={require("@/assets/icons/ic_call_gradient.png")} style={styles.talkNowIcon} resizeMode="contain" />
            <Text style={styles.talkNowText}>Talk Now</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

function FilterModal({ title, options, selected, onSelect, onClose, visible }: { title: string; options: string[]; selected: string; onSelect: (v: string) => void; onClose: () => void; visible: boolean }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>{title}</Text>
          {options.map((opt) => (
            <TouchableOpacity key={opt} onPress={() => { onSelect(opt); onClose(); }} style={styles.modalOpt}>
              <Text style={[styles.modalOptText, selected === opt && { color: ACCENT, fontFamily: "Poppins_600SemiBold" }]}>{opt}</Text>
              {selected === opt && <View style={styles.modalCheck} />}
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

export default function ListenerScreen() {
  const insets = useSafeAreaInsets();
  const [selectedLang, setSelectedLang] = useState("All");
  const [selectedTopic, setSelectedTopic] = useState("All");
  const [showLangModal, setShowLangModal] = useState(false);
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hosts, setHosts] = useState<ReturnType<typeof mapApiHost>[]>([]);

  const loadHosts = useCallback(async () => {
    try {
      const params: any = {};
      if (selectedTopic !== "All") params.topic = selectedTopic;
      const data = await API.getHosts(params);
      setHosts(data.map(mapApiHost));
    } catch {
      setHosts([]);
    }
  }, [selectedTopic]);

  useEffect(() => { loadHosts(); }, [selectedTopic]);

  const filtered = hosts.filter((h) => {
    return selectedLang === "All" || h.languages.includes(selectedLang);
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHosts();
    setRefreshing(false);
  }, [loadHosts]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>All Listeners</Text>
      </View>

      <View style={styles.filterRow}>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setShowLangModal(true)} activeOpacity={0.8}>
          <Image source={require("@/assets/icons/ic_language.png")} style={styles.filterIcon} tintColor="#FF8C00" resizeMode="contain" />
          <Text style={styles.filterBtnText}>{selectedLang === "All" ? "Language" : selectedLang}</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.filterArrow} tintColor="#999" resizeMode="contain" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setShowTopicModal(true)} activeOpacity={0.8}>
          <Image source={require("@/assets/icons/ic_chat.png")} style={styles.filterIcon} tintColor="#1499F1" resizeMode="contain" />
          <Text style={styles.filterBtnText}>{selectedTopic === "All" ? "Talk About" : selectedTopic}</Text>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.filterArrow} tintColor="#999" resizeMode="contain" />
        </TouchableOpacity>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Image source={require("@/assets/images/empty_hosts.png")} style={styles.emptyImg} resizeMode="contain" />
          <Text style={styles.emptyText}>No listeners found</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        >
          {filtered.map((host) => (
            <ListenerCard key={host.id} host={host} onPress={() => router.push(`/user/hosts/${host.id}`)} />
          ))}
          <View style={{ height: insets.bottom + 100 }} />
        </ScrollView>
      )}

      <FilterModal title="Select Language" options={LANGUAGES} selected={selectedLang} onSelect={setSelectedLang} onClose={() => setShowLangModal(false)} visible={showLangModal} />
      <FilterModal title="Talk About" options={TOPICS} selected={selectedTopic} onSelect={setSelectedTopic} onClose={() => setShowTopicModal(false)} visible={showTopicModal} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: LIGHT_PURPLE },
  header: { backgroundColor: LIGHT_PURPLE, paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: DARK, textAlign: "center" },

  filterRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: LIGHT_PURPLE },
  filterBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  filterIcon: { width: 20, height: 20 },
  filterBtnText: { flex: 1, fontSize: 13, fontFamily: "Poppins_500Medium", color: DARK, marginHorizontal: 8 },
  filterArrow: { width: 12, height: 12, transform: [{ rotate: "-90deg" }] },

  list: { paddingHorizontal: 14, paddingTop: 4 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    marginBottom: 12,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
      web: { boxShadow: "0 2px 12px rgba(0,0,0,0.08)" } as any,
    }),
  },
  cardContent: { flexDirection: "row", padding: 10, gap: 10 },
  avatarWrap: { width: 88, height: 88, borderRadius: 10, overflow: "hidden", backgroundColor: "#F0F0F0" },
  avatar: { width: "100%", height: "100%" },
  info: { flex: 1, gap: 4, justifyContent: "center" },
  nameRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 14, fontFamily: "Poppins_700Bold", color: DARK, flex: 1, marginRight: 6 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 10, fontFamily: "Poppins_500Medium" },
  langRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  smallIcon: { width: 14, height: 14 },
  langText: { fontSize: 11, fontFamily: "Poppins_400Regular", color: GREY },
  topicsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  topicChip: { backgroundColor: "#F3E4FF", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  topicChipText: { fontSize: 10, fontFamily: "Poppins_500Medium", color: ACCENT },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  coinIcon: { width: 14, height: 14 },
  coinText: { fontSize: 11, fontFamily: "Poppins_600SemiBold", color: "#FFA100" },
  callCountWrap: { flexDirection: "row", alignItems: "center", gap: 3 },
  callCountText: { fontSize: 11, fontFamily: "Poppins_400Regular", color: GREY },
  cardActions: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#F0F0F0" },
  viewProfileBtn: { flex: 1, paddingVertical: 12, alignItems: "center" },
  viewProfileText: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: GREY },
  talkNowBtn: {
    flex: 1, paddingVertical: 12, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 6, backgroundColor: "#F8F0FF",
    borderLeftWidth: 1, borderLeftColor: "#F0F0F0",
  },
  talkNowIcon: { width: 16, height: 16 },
  talkNowText: { fontSize: 13, fontFamily: "Poppins_700Bold", color: ACCENT },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyImg: { width: 180, height: 140 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular", color: GREY, marginTop: 10 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: DARK, marginBottom: 16 },
  modalOpt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  modalOptText: { fontSize: 15, fontFamily: "Poppins_500Medium", color: DARK },
  modalCheck: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT },
});
