import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { View, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";

export default function Index() {
  const { isLoggedIn, isLoading, user } = useAuth();
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isLoggedIn) {
    if (user?.role === "host") {
      return <Redirect href="/(host-tabs)" />;
    }
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/auth/onboarding" />;
}
