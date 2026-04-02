import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen doesn&apos;t exist.</Text>
        <Link href="/dashboard" style={styles.link}>
          <Text style={styles.linkText}>Go to Dashboard!</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "#111329" },
  title: { fontSize: 20, fontWeight: "bold", color: "#fff", marginBottom: 20 },
  link: { marginTop: 15, paddingVertical: 15 },
  linkText: { fontSize: 14, color: "#A00EE7" },
});
