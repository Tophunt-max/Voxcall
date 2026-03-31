import { Tabs } from "expo-router";
import React from "react";
import { Image, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useChat } from "@/context/ChatContext";
import { NotificationBadge } from "@/components/NotificationBadge";

const TAB_ICONS = {
  home: require("@/assets/icons/ic_home.png"),
  listener: require("@/assets/icons/ic_listener.png"),
  random: require("@/assets/icons/ic_shuffle.png"),
  chat: require("@/assets/icons/ic_chat.png"),
  calling: require("@/assets/icons/ic_calling.png"),
};

interface TabIconProps {
  source: any;
  color: string;
  focused: boolean;
  badge?: number;
}

function TabIcon({ source, color, focused, badge }: TabIconProps) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Image
        source={source}
        style={styles.tabIcon}
        tintColor={color}
        resizeMode="contain"
      />
      {badge ? <NotificationBadge count={badge} /> : null}
    </View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { totalUnread } = useChat();
  const isWeb = Platform.OS === "web";

  const tabBarHeight = isWeb ? 70 : 60 + (insets.bottom > 0 ? insets.bottom - 8 : 10);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#A00EE7",
        tabBarInactiveTintColor: "#AAAACC",
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: "#E9E9E9",
          elevation: 12,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          height: tabBarHeight,
          paddingBottom: isWeb ? 10 : insets.bottom > 0 ? insets.bottom - 8 : 8,
          paddingTop: 8,
        },
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: "Poppins_500Medium",
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon source={TAB_ICONS.home} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Listener",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon source={TAB_ICONS.listener} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="random"
        options={{
          title: "Random",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon source={TAB_ICONS.random} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon source={TAB_ICONS.chat} color={color} focused={focused} badge={totalUnread} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Calling",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon source={TAB_ICONS.calling} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabIcon: { width: 22, height: 22 },
});
