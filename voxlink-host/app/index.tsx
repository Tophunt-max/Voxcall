import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { View, ActivityIndicator } from "react-native";

export default function Index() {
  const { isLoggedIn, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#111329" }}>
        <ActivityIndicator color="#A00EE7" size="large" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/auth/login" />;
  }

  if (user?.role !== "host") {
    return <Redirect href="/auth/status" />;
  }

  return <Redirect href="/dashboard" />;
}
