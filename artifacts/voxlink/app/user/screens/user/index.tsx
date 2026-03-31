import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Image,
  Platform,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { HostCard } from "@/components/HostCard";
import { Host } from "@/data/mockData";
import { API } from "@/services/api";

function mapApiHost(h: any): Host {
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

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [selectedSpecialty, setSelectedSpecialty] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [specialties, setSpecialties] = useState<string[]>(["All"]);
  const [loading, setLoading] = useState(true);

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const loadHosts = useCallback(async () => {
    try {
      const data = await API.getHosts();
      setHosts(data.map(mapApiHost));
    } catch {
      setHosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTopics = useCallback(async () => {
    try {
      const topics = await API.getTalkTopics();
      setSpecialties(["All", ...topics.map((t: any) => t.name)]);
    } catch {
      setSpecialties(["All", "Life Coaching", "Relationships", "Career", "Wellness", "Mental Health", "Music", "Travel"]);
    }
  }, []);

  useEffect(() => {
    loadHosts();
    loadTopics();
  }, []);

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
          {/* Dotted-border profile circle */}
          <TouchableOpacity
            onPress={() => router.push("/user/screens/user/profile")}
            style={styles.avatarBorderWrapper}
          >
            <View style={[styles.avatarBorder, { borderColor: colors.primary }]}>
              <Image
                source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id ?? "me"}` }}
                style={styles.headerAvatar}
              />
            </View>
          </TouchableOpacity>

          {/* Name + unique ID */}
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
          {/* Coin balance */}
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

          {/* Search icon */}
          <TouchableOpacity
            onPress={() => router.push("/shared/search-hosts")}
            style={[styles.bellBtn, { backgroundColor: colors.muted }]}
          >
            <Image source={require("@/assets/icons/ic_search.png")} style={{ width: 18, height: 18 }} tintColor={colors.text} resizeMode="contain" />
          </TouchableOpacity>

          {/* Notification bell */}
          <TouchableOpacity
            onPress={() => router.push("/shared/notifications")}
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
        {/* Find More / Featured Banner */}
        <TouchableOpacity
          onPress={() => router.push("/user/screens/user/random")}
          activeOpacity={0.9}
          style={[styles.findMoreBanner, { backgroundColor: "#A00EE7" }]}
        >
          <View style={styles.findMoreLeft}>
            <Text style={styles.findMoreTitle}>Find More</Text>
            <Text style={styles.findMoreSub}>Connect with a random listener now</Text>
            <View style={[styles.findMoreBtn, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
              <Text style={styles.findMoreBtnText}>Start Random Call</Text>
            </View>
          </View>
          <Image
            source={require("@/assets/images/home_call_person.png")}
            style={styles.findMoreImage}
            resizeMode="contain"
          />
        </TouchableOpacity>

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
                onTalkNow={() => router.push(`/user/hosts/${host.id}`)}
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
  findMoreBanner: {
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    overflow: "hidden",
  },
  findMoreLeft: { flex: 1, gap: 6 },
  findMoreTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#fff" },
  findMoreSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.8)" },
  findMoreBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    marginTop: 4,
  },
  findMoreBtnText: { fontSize: 12, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  findMoreImage: { width: 90, height: 90, marginLeft: 12 },

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
