import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  FlatList,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const REVIEWS = [
  { id: "r1", user: "Sarah M.", avatar: "sarah", rating: 5, text: "Amazing listener! Very understanding and gave great advice. Will definitely call again.", date: "2 days ago" },
  { id: "r2", user: "John D.", avatar: "john", rating: 5, text: "Really helped me through a tough time. Professional and empathetic.", date: "1 week ago" },
  { id: "r3", user: "Priya K.", avatar: "priya", rating: 4, text: "Good session, very knowledgeable about the topic. Slightly rushed at the end.", date: "1 week ago" },
  { id: "r4", user: "Marcus L.", avatar: "marcus", rating: 5, text: "Best listener on the platform! Always available and incredibly supportive.", date: "2 weeks ago" },
  { id: "r5", user: "Emma T.", avatar: "emma", rating: 5, text: "I felt heard and understood. Thank you for the wonderful session.", date: "3 weeks ago" },
  { id: "r6", user: "Alex R.", avatar: "alex", rating: 4, text: "Very good overall. Knowledgeable and easy to talk to.", date: "1 month ago" },
  { id: "r7", user: "Nina P.", avatar: "nina", rating: 5, text: "Life-changing conversation! Helped me see things from a new perspective.", date: "1 month ago" },
  { id: "r8", user: "Raj S.", avatar: "raj", rating: 4, text: "Great experience. Would recommend to anyone looking for genuine support.", date: "2 months ago" },
];

function Stars({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1,2,3,4,5].map(i => (
        <Text key={i} style={{ color: i <= count ? "#FFA100" : "#E0E0E0", fontSize: 14 }}>★</Text>
      ))}
    </View>
  );
}

export default function AllReviewsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ hostId: string; hostRating: string; hostReviewCount: string }>();

  const rating = parseFloat(params.hostRating ?? "4.8");
  const reviewCount = parseInt(params.hostReviewCount ?? "0", 10);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Reviews</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.summaryCard, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
        <View style={styles.ratingBig}>
          <Text style={[styles.ratingNum, { color: colors.text }]}>{rating.toFixed(1)}</Text>
          <Stars count={Math.round(rating)} />
          <Text style={[styles.ratingTotal, { color: colors.mutedForeground }]}>{reviewCount} reviews</Text>
        </View>
        <View style={styles.ratingBars}>
          {[5,4,3,2,1].map(star => {
            const pct = star === 5 ? 0.7 : star === 4 ? 0.2 : star === 3 ? 0.06 : star === 2 ? 0.03 : 0.01;
            return (
              <View key={star} style={styles.barRow}>
                <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>{star}</Text>
                <Text style={{ color: "#FFA100", fontSize: 11 }}>★</Text>
                <View style={[styles.barBg, { backgroundColor: colors.border }]}>
                  <View style={[styles.barFill, { width: `${pct * 100}%` as any, backgroundColor: "#FFA100" }]} />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <FlatList
        data={REVIEWS}
        keyExtractor={r => r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={[styles.reviewCard, { backgroundColor: colors.card }]}>
            <View style={styles.reviewTop}>
              <Image source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.avatar}` }} style={styles.reviewAvatar} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.reviewUser, { color: colors.text }]}>{item.user}</Text>
                <Stars count={item.rating} />
              </View>
              <Text style={[styles.reviewDate, { color: colors.mutedForeground }]}>{item.date}</Text>
            </View>
            <Text style={[styles.reviewText, { color: colors.mutedForeground }]}>{item.text}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  summaryCard: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 20, marginBottom: 8 },
  ratingBig: { alignItems: "center", gap: 6 },
  ratingNum: { fontSize: 40, fontFamily: "Poppins_700Bold" },
  ratingTotal: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  ratingBars: { flex: 1, gap: 6 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  barLabel: { width: 12, fontSize: 11, fontFamily: "Poppins_500Medium", textAlign: "right" },
  barBg: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  reviewCard: { borderRadius: 14, padding: 14, gap: 10 },
  reviewTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  reviewAvatar: { width: 40, height: 40, borderRadius: 20 },
  reviewUser: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  reviewDate: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 2 },
  reviewText: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 20 },
});
