import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  rating: number;
  maxRating?: number;
  size?: number;
  interactive?: boolean;
  onRate?: (r: number) => void;
}

export function StarRating({ rating, maxRating = 5, size = 20, interactive = false, onRate }: Props) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      {Array.from({ length: maxRating }).map((_, i) => (
        <TouchableOpacity key={i} onPress={() => interactive && onRate && onRate(i + 1)} disabled={!interactive}>
          <MaterialIcons
            name={i < Math.floor(rating) ? "star" : i < rating ? "star-half" : "star-border"}
            size={size}
            color={i < Math.ceil(rating) ? colors.coinGold : colors.border}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row" } });
