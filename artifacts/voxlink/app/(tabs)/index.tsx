import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, FlatList, TouchableOpacity, Image, Platform, RefreshControl } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { HostCard } from "@/components/HostCard";
import { CoinBalance } from "@/components/CoinBalance";
import { MOCK_HOSTS, SPECIALTIES } from "@/data/mockData";

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [selectedSpecialty, setSelectedSpecialty] = useState("All");
  const [refreshing, setRefreshing] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const topHosts = MOCK_HOSTS.filter((h) => h.isTopRated && h.isOnline);
  const filteredHosts = selectedSpecialty === "All"
    ? MOCK_HOSTS
    : MOCK_HOSTS.filter((h) => h.specialties.some((s) => s.toLowerCase().includes(selectedSpecialty.toLowerCase())));
  const onlineHosts = filteredHosts.filter((h) => h.isOnline);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good {getTimeGreeting()}</Text>
          <Text style={[styles.userName, { color: colors.foreground }]}>{user?.name?.split(" ")[0] ?? "Friend"}</Text>
        </View>
        <View style={styles.headerRight}>
          <CoinBalance balance={user?.coins ?? 0} onPress={() => router.push("/(tabs)/wallet")} />
          <TouchableOpacity onPress={() => router.push("/notifications")} style={[styles.iconBtn, { backgroundColor: colors.muted }]}>
            <Feather name="bell" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {topHosts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Top Hosts Online</Text>
              <TouchableOpacity onPress={() => router.push("/hosts/all")}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={topHosts}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(h) => h.id}
              renderItem={({ item }) => (
                <HostCard host={item} compact onPress={() => router.push(`/hosts/${item.id}`)} />
              )}
              contentContainerStyle={{ paddingRight: 20 }}
            />
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Browse by Topic</Text>
          <FlatList
            data={SPECIALTIES}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(s) => s}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedSpecialty(item)}
                style={[styles.chip, { backgroundColor: selectedSpecialty === item ? colors.primary : colors.muted }]}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipText, { color: selectedSpecialty === item ? colors.primaryForeground : colors.mutedForeground }]}>{item}</Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingRight: 20, gap: 8 }}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {selectedSpecialty === "All" ? "Available Now" : selectedSpecialty}
            </Text>
            <Text style={[styles.count, { color: colors.mutedForeground }]}>{onlineHosts.length} online</Text>
          </View>
          {onlineHosts.map((host) => (
            <HostCard key={host.id} host={host} onPress={() => router.push(`/hosts/${host.id}`)} />
          ))}
          {filteredHosts.filter((h) => !h.isOnline).length > 0 && (
            <>
              <Text style={[styles.offlineLabel, { color: colors.mutedForeground }]}>Currently Offline</Text>
              {filteredHosts.filter((h) => !h.isOnline).map((host) => (
                <HostCard key={host.id} host={host} onPress={() => router.push(`/hosts/${host.id}`)} />
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  userName: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 16 },
  section: { marginBottom: 24, gap: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  count: { fontSize: 13, fontFamily: "Inter_400Regular" },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  offlineLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4 },
});
