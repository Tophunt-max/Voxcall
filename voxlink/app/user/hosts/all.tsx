import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { HostCard } from "@/components/HostCard";
import { SearchBar } from "@/components/SearchBar";
import { API, resolveMediaUrl } from "@/services/api";
import { showErrorToast } from "@/components/Toast";

export default function AllHostsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [hosts, setHosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // FIX: API.getHosts now returns { hosts, nextCursor } — read .hosts before mapping.
    // Explicit limit so the full roster loads (no infinite scroll on this screen).
    API.getHosts({ limit: 100 }).then((res) => {
      const list = res?.hosts ?? [];
      const mapped = list.map((h: any) => ({
        ...h,
        avatar: resolveMediaUrl(h.avatar_url || h.avatar) || `https://api.dicebear.com/7.x/avataaars/png?seed=${h.id}`,
      }));
      setHosts(mapped);
    }).catch(() => { setHosts([]); showErrorToast("Failed to load hosts."); }).finally(() => setLoading(false));
  }, []);

  const filtered = hosts.filter((h) =>
    !query || (h.display_name ?? h.name ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22 }} tintColor={colors.foreground} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>All Hosts</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <SearchBar value={query} onChange={setQuery} />
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(h) => h.id}
          renderItem={({ item }) => <HostCard host={item} onPress={() => router.push(`/user/hosts/${item.id}`)} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 20 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Poppins_400Regular" }}>No hosts found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
