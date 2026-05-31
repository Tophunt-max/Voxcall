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
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/auth/login" />;
  }

  if (user?.role !== "host") {
    return <Redirect href="/auth/status" />;
  }

  return <Redirect href="/(tabs)" />;
}
