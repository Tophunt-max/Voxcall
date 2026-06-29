import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";

export default function NotFoundScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  return (
    <>
      <Stack.Screen options={{ title: t.notFoundScreen.title }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>{t.notFoundScreen.message}</Text>
        <Link href="/(tabs)" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.accent }]}>{t.notFoundScreen.goHome}</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 20 },
  link: { marginTop: 15, paddingVertical: 15 },
  linkText: { fontSize: 14 },
});
