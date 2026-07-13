import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, Modal, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";

export interface GiftCatalogItem {
  id: string;
  name: string;
  icon: string;
  price_coins: number;
}

// Reusable bottom-sheet gift picker — used both in chat and during a call.
// Presentational: the parent owns the catalog, the balance, which gift is
// currently sending, and what "pick" does.
export function GiftPickerSheet({
  visible,
  onClose,
  gifts,
  coins,
  sendingId,
  onPick,
  title = "Send a gift",
}: {
  visible: boolean;
  onClose: () => void;
  gifts: GiftCatalogItem[];
  coins: number;
  sendingId: string | null;
  onPick: (gift: GiftCatalogItem) => void;
  title?: string;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            <View style={styles.balanceChip}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 14, height: 14 }} resizeMode="contain" />
              <Text style={[styles.balanceText, { color: colors.foreground }]}>{(coins ?? 0).toLocaleString()}</Text>
            </View>
          </View>
          {gifts.length === 0 ? (
            <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>No gifts available right now.</Text>
          ) : (
            <View style={styles.grid}>
              {gifts.map((g) => {
                const affordable = (coins ?? 0) >= (g.price_coins ?? 0);
                const busy = sendingId === g.id;
                return (
                  <TouchableOpacity
                    key={g.id}
                    activeOpacity={0.85}
                    disabled={!!sendingId}
                    onPress={() => onPick(g)}
                    style={[styles.cell, { borderColor: colors.border, opacity: affordable || busy ? 1 : 0.5 }]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ height: 34 }} />
                    ) : (
                      <Text style={styles.cellEmoji}>{g.icon}</Text>
                    )}
                    <Text style={[styles.cellName, { color: colors.foreground }]} numberOfLines={1}>{g.name}</Text>
                    <View style={styles.coinRow}>
                      <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 11, height: 11 }} resizeMode="contain" />
                      <Text style={[styles.cellPrice, { color: colors.mutedForeground }]}>{(g.price_coins ?? 0).toLocaleString()}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  balanceChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(160,14,231,0.10)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  balanceText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  emptyHint: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center", paddingVertical: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
  cell: { width: "31%", borderWidth: 1, borderRadius: 16, paddingVertical: 12, alignItems: "center", gap: 4 },
  cellEmoji: { fontSize: 30, lineHeight: 34 },
  cellName: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  coinRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  cellPrice: { fontSize: 11, fontFamily: "Poppins_500Medium" },
});
