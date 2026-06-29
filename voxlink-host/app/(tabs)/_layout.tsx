import { Tabs } from "expo-router";
import { Image, Platform, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "@/context/LanguageContext";
import LevelUpCelebration from "@/components/LevelUpCelebration";

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
  const { t } = useLanguage();

  return (
    <>
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
          elevation: 12,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: -2 },
        },
        tabBarLabelStyle: { fontSize: 11, fontFamily: "Poppins_500Medium", marginTop: 2 },
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.tabs.home,
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_home.png")} focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t.tabs.chat,
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_chat.png")} focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: t.tabs.calls,
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_calling.png")} focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: t.tabs.wallet,
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_coin.png")} focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.tabs.profile,
          tabBarIcon: ({ color, focused }) => <TabIcon source={require("@/assets/icons/ic_profile.png")} focused={focused} color={color} />,
        }}
      />
    </Tabs>
      <LevelUpCelebration />
    </>
  );
}
