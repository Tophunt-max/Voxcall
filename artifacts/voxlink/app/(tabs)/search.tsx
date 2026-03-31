import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { HostCard } from "@/components/HostCard";
import { SearchBar } from "@/components/SearchBar";
import { MOCK_HOSTS, LANGUAGES } from "@/data/mockData";

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [selectedLang, setSelectedLang] = useState("All");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const results = useMemo(() => {
    return MOCK_HOSTS.filter((h) => {
      const matchQuery = !query || h.name.toLowerCase().includes(query.toLowerCase()) ||
        h.bio.toLowerCase().includes(query.toLowerCase()) ||
        h.specialties.some((s) => s.toLowerCase().includes(query.toLowerCase()));
      const matchLang = selectedLang === "All" || h.languages.includes(selectedLang);
      return matchQuery && matchLang;
    });
  }, [query, selectedLang]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Find a Host</Text>
        <SearchBar value={query} onChange={setQuery} placeholder="Search by name, topic, or language..." />
      </View>

      <FlatList
        data={LANGUAGES}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(l) => l}
        renderItem={({ item }) => (
          <View
            style={[styles.langChip, {
              backgroundColor: selectedLang === item ? colors.primary : colors.muted,
              marginLeft: item === "All" ? 20 : 0,
            }]}
          >
            <Text
              style={[styles.langChipText, { color: selectedLang === item ? colors.primaryForeground : colors.mutedForeground }]}
              onPress={() => setSelectedLang(item)}
            >
              {item}
            </Text>
          </View>
        )}
        contentContainerStyle={{ gap: 8, paddingRight: 20, paddingVertical: 12 }}
      />

      {results.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="search" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No hosts found</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Try adjusting your search or filters</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(h) => h.id}
          renderItem={({ item }) => <HostCard host={item} onPress={() => router.push(`/hosts/${item.id}`)} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 90 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<Text style={[styles.resultCount, { color: colors.mutedForeground }]}>{results.length} host{results.length !== 1 ? "s" : ""} found</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 4, gap: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  langChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  langChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 80 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular" },
  resultCount: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
});
