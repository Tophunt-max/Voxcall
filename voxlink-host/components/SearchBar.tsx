import React from "react";
import { View, TextInput, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onFocus?: () => void;
}

export function SearchBar({ value, onChange, placeholder = "Search hosts...", onFocus }: Props) {
  const colors = useColors();
  return (
    <View style={[styles.wrapper, { backgroundColor: colors.muted, borderRadius: 14 }]}>
      <Feather name="search" size={18} color={colors.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { color: colors.foreground }]}
        onFocus={onFocus}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChange("")}>
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", padding: 0 },
});
