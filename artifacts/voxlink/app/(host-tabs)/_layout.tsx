import { Tabs } from "expo-router";
import { Image, Platform, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function TabIcon({ source, focused, color }: { source: any; focused: boolean; color: string }) {
  return (
    <Image
      source={source}
      style={{ width: 24, height: 24 }}
      tintColor={color}
      resizeMode="contain"
    />
  );
}

export default function HostTabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 0.5,
          borderTopColor: colors.border,
          height: (Platform.OS === "web" ? 60 : 60 + insets.bottom),
          paddingBottom: Platform.OS === "web" ? 8 : insets.bottom,
          paddingTop: 8,
          ...(Platform.OS === "web"
            ? { boxShadow: "0 -1px 10px rgba(0,0,0,0.08)" }
            : { elevation: 8, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: -2 } }),
        },
        tabBarLabelStyle: { fontSize: 10, fontFamily: "Poppins_500Medium", marginTop: -2 },
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_home.png")} focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_chat.png")} focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notify",
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_notify.png")} focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_wallet.png")} focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_profile.png")} focused={focused} color={color} />,
        }}
      />
    </Tabs>
  );
}
