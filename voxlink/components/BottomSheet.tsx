// VoxLink BottomSheet Component
// Smooth slide-up modal sheet for actions, filters, selections

import React, { useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Animated,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  StyleSheet,
  Platform,
  Dimensions,
} from "react-native";
import { useColors } from "@/hooks/useColors";

const { height: SCREEN_H } = Dimensions.get("window");

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxHeight?: number | string;
  showHandle?: boolean;
  closeOnBackdrop?: boolean;
}

export default function BottomSheet({
  visible,
  onClose,
  title,
  children,
  maxHeight = SCREEN_H * 0.85,
  showHandle = true,
  closeOnBackdrop = true,
}: BottomSheetProps) {
  const colors = useColors();
  const slideAnim = useRef(new Animated.Value(300)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 300,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(onClose);
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={closeOnBackdrop ? close : undefined}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                opacity: backdropAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.55],
                }),
              },
            ]}
          />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              maxHeight: maxHeight as number,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {showHandle && (
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          )}

          {title && (
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
              <TouchableOpacity onPress={close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.closeText, { color: colors.mutedForeground }]}>Close</Text>
              </TouchableOpacity>
            </View>
          )}

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Quick Action Sheet ────────────────────────────────────────────────────────

interface ActionItem {
  label: string;
  icon?: string;
  onPress: () => void;
  destructive?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  actions: ActionItem[];
}

export function ActionSheet({ visible, onClose, title, actions }: ActionSheetProps) {
  const colors = useColors();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: 4, paddingBottom: Platform.OS === "ios" ? 24 : 12 }}>
        {actions.map((action, i) => (
          <TouchableOpacity
            key={i}
            style={[
              actionStyles.item,
              { borderBottomColor: colors.borderLight },
              i < actions.length - 1 && actionStyles.bordered,
            ]}
            onPress={() => {
              action.onPress();
              onClose();
            }}
            activeOpacity={0.7}
          >
            <Text
              style={[
                actionStyles.label,
                { color: action.destructive ? colors.destructive : colors.text },
              ]}
            >
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontFamily: "Poppins_600SemiBold",
  },
  closeText: {
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
});

const actionStyles = StyleSheet.create({
  item: {
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  bordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 15,
    fontFamily: "Poppins_500Medium",
    textAlign: "center",
  },
});
