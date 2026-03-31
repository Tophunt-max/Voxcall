import React, { useState, useMemo } from "react";
import {
  View, Text, StyleSheet, TextInput, FlatList,
  TouchableOpacity, Image, Platform
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { MOCK_HOSTS, SPECIALTIES } from "@/data/mockData";

const LANGUAGES = ["All", "English", "Hindi", "Chinese", "Arabic", "Spanish"];
const STATUS_FILTERS = ["All", "Online", "On Call", "Offline"];

export default function SearchHostsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("All");
  const [selectedLang, setSelectedLang] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [showFilters, setShowFilters] = useState(false);

  const topPad = insets.top;

  const filtered = useMemo(() => {
    return MOCK_HOSTS.filter((h) => {
      const q = query.toLowerCase();
      const matchName = h.name.toLowerCase().includes(q);
      const matchTopic = selectedTopic === "All" || h.specialties.some(s => s.toLowerCase().includes(selectedTopic.toLowerCase()));
      const matchLang = selectedLang === "All" || h.languages.some(l => l.toLowerCase().includes(selectedLang.toLowerCase()));
      const matchStatus = selectedStatus === "All" ||
        (selectedStatus === "Online" && h.isOnline && !h.isOnCall) ||
        (selectedStatus === "On Call" && h.isOnCall) ||
        (selectedStatus === "Offline" && !h.isOnline);
      return matchName && matchTopic && matchLang && matchStatus;
    });
  }, [query, selectedTopic, selectedLang, selectedStatus]);

  const statusLabel = (h: any) => h.isOnCall ? "On Call" : h.isOnline ? "Online" : "Offline";
  const statusColor = (h: any) => h.isOnCall ? "#FF9800" : h.isOnline ? "#0BAF23" : "#9E9E9E";

  const renderHost = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.hostItem, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
      onPress={() => router.push(`/hosts/${item.id}`)}
      activeOpacity={0.8}
    >
      <View style={styles.avatarWrap}>
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        <View style={[styles.onlineDot, { backgroundColor: statusColor(item), borderColor: colors.card }]} />
      </View>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
          <View style={styles.ratingRow}>
            <Feather name="star" size={11} color="#FFA100" />
            <Text style={[styles.rating, { color: colors.mutedForeground }]}>{item.rating.toFixed(1)}</Text>
          </View>
        </View>
        <Text style={[styles.topics, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.specialties.slice(0, 3).join(" • ")}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(item) + "20" }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor(item) }]} />
            <Text style={[styles.statusText, { color: statusColor(item) }]}>{statusLabel(item)}</Text>
          </View>
          <View style={[styles.dot, { backgroundColor: colors.border }]} />
          <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
          <Text style={[styles.coinRate, { color: colors.coinGoldText }]}>{item.coinsPerMinute}/min</Text>
        </View>
      </View>
      <TouchableOpacity
        style={[styles.talkBtn, { backgroundColor: colors.primary }]}
        onPress={() => router.push(`/call/outgoing?hostId=${item.id}`)}
      >
        <Feather name="phone" size={13} color="#fff" />
        <Text style={styles.talkTxt}>Talk</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Search header */}
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22, tintColor: colors.text }} resizeMode="contain" />
        </TouchableOpacity>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search hosts by name..."
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, { backgroundColor: showFilters ? colors.primary : colors.surface }]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Feather name="sliders" size={16} color={showFilters ? "#fff" : colors.text} />
        </TouchableOpacity>
      </View>

      {/* Filters panel */}
      {showFilters && (
        <View style={[styles.filtersPanel, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Text style={[styles.filterGroupLabel, { color: colors.mutedForeground }]}>Topic</Text>
          <View style={styles.chipRow}>
            {["All", ...SPECIALTIES].map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, { backgroundColor: selectedTopic === t ? colors.primary : colors.surface, borderColor: selectedTopic === t ? colors.primary : colors.border }]}
                onPress={() => setSelectedTopic(t)}
              >
                <Text style={[styles.chipText, { color: selectedTopic === t ? "#fff" : colors.text }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.filterGroupLabel, { color: colors.mutedForeground }]}>Language</Text>
          <View style={styles.chipRow}>
            {LANGUAGES.map((l) => (
              <TouchableOpacity
                key={l}
                style={[styles.chip, { backgroundColor: selectedLang === l ? colors.primary : colors.surface, borderColor: selectedLang === l ? colors.primary : colors.border }]}
                onPress={() => setSelectedLang(l)}
              >
                <Text style={[styles.chipText, { color: selectedLang === l ? "#fff" : colors.text }]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.filterGroupLabel, { color: colors.mutedForeground }]}>Status</Text>
          <View style={styles.chipRow}>
            {STATUS_FILTERS.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, { backgroundColor: selectedStatus === s ? colors.primary : colors.surface, borderColor: selectedStatus === s ? colors.primary : colors.border }]}
                onPress={() => setSelectedStatus(s)}
              >
                <Text style={[styles.chipText, { color: selectedStatus === s ? "#fff" : colors.text }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Results count */}
      <View style={[styles.resultsBar, { backgroundColor: colors.background }]}>
        <Text style={[styles.resultsText, { color: colors.mutedForeground }]}>
          {filtered.length} host{filtered.length !== 1 ? "s" : ""} found
        </Text>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Image source={require("@/assets/images/empty_hosts.png")} style={styles.emptyImg} resizeMode="contain" />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No hosts found matching your search</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(h) => h.id}
          renderItem={renderHost}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 10, gap: 8, borderBottomWidth: 1 },
  backBtn: { padding: 6 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 42, borderRadius: 21, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Poppins_400Regular", height: 42 },
  filterBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  filtersPanel: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 6 },
  filterGroupLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  resultsBar: { paddingHorizontal: 16, paddingVertical: 8 },
  resultsText: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  hostItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  avatarWrap: { position: "relative" },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#eee" },
  onlineDot: { width: 12, height: 12, borderRadius: 6, position: "absolute", bottom: 1, right: 1, borderWidth: 2 },
  info: { flex: 1 },
  nameRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  name: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  rating: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  topics: { fontSize: 12, fontFamily: "Poppins_400Regular", marginBottom: 5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusText: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  dot: { width: 3, height: 3, borderRadius: 1.5 },
  coinIcon: { width: 12, height: 12 },
  coinRate: { fontSize: 11, fontFamily: "Poppins_500Medium" },
  talkBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  talkTxt: { color: "#fff", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyImg: { width: 180, height: 180 },
  emptyText: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center" },
});
