import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
  onGoOnline?: () => void;
}

export function InsufficientCoinsPopup({ visible, onClose, onGoOnline }: Props) {
  const colors = useColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={[st.overlay]} activeOpacity={1} onPress={onClose}>
        <View
          style={[st.popup, { backgroundColor: colors.card }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[st.handle, { backgroundColor: colors.border }]} />

          <View style={[st.iconBg, { backgroundColor: colors.accentLight }]}>
            <Feather name="wifi-off" size={28} color={colors.accent} />
          </View>

          <Text style={[st.title, { color: colors.text }]}>You're Offline</Text>
          <Text style={[st.subtitle, { color: colors.mutedForeground }]}>
            Go online to start receiving calls and earning coins.
          </Text>

          {onGoOnline && (
            <TouchableOpacity
              onPress={() => { onGoOnline(); onClose(); }}
              style={[st.primaryBtn, { backgroundColor: colors.accent }]}
              activeOpacity={0.85}
            >
              <Feather name="radio" size={16} color="#fff" />
              <Text style={st.primaryBtnTxt}>Go Online Now</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={onClose} style={st.cancelBtn} activeOpacity={0.85}>
            <Text style={[st.cancelBtnTxt, { color: colors.mutedForeground }]}>Later</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  popup: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 12,
    marginBottom: 20,
  },
  iconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: "Poppins_700Bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    justifyContent: "center",
    marginBottom: 8,
  },
  primaryBtnTxt: {
    fontSize: 15,
    fontFamily: "Poppins_700Bold",
    color: "#fff",
  },
  cancelBtn: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtnTxt: {
    fontSize: 14,
    fontFamily: "Poppins_500Medium",
  },
});
