import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, Platform, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { HostCard } from "@/components/HostCard";
import { SearchBar } from "@/components/SearchBar";
import { MOCK_HOSTS } from "@/data/mockData";
import { TouchableOpacity } from "react-native";

export default function AllHostsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");

  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const hosts = MOCK_HOSTS.filter((h) => !query || h.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Image source={require("@/assets/icons/ic_back.png")} style={{ width: 22, height: 22 }} tintColor={colors.foreground} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>All Hosts</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <SearchBar value={query} onChange={setQuery} />
      </View>
      <FlatList
        data={hosts}
        keyExtractor={(h) => h.id}
        renderItem={({ item }) => <HostCard host={item} onPress={() => router.push(`/hosts/${item.id}`)} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 20 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Poppins_700Bold" },
});
