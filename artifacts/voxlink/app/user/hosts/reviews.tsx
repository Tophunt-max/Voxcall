import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  FlatList, ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";

interface Review {
  id: string;
  user_name?: string;
  user_id?: string;
  rating: number;
  comment?: string;
  created_at?: number;
}

function Stars({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1,2,3,4,5].map(i => (
        <Text key={i} style={{ color: i <= count ? "#FFA100" : "#E0E0E0", fontSize: 14 }}>★</Text>
      ))}
    </View>
  );
}

function formatDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - ts * 1000;
  const day = 86400000;
  if (diff < day) return "Today";
  if (diff < 2 * day) return "Yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))} week${Math.floor(diff / (7 * day)) > 1 ? "s" : ""} ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} month${Math.floor(diff / (30 * day)) > 1 ? "s" : ""} ago`;
  return d.toLocaleDateString();
}

export default function AllReviewsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ hostId: string; hostRating: string; hostReviewCount: string }>();

  const rating = parseFloat(params.hostRating ?? "0");
  const reviewCount = parseInt(params.hostReviewCount ?? "0", 10);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.hostId) { setLoading(false); return; }
    API.getHostReviews(params.hostId)
      .then((data) => setReviews(data ?? []))
      .catch(() => setReviews([]))
      .finally(() => setLoading(false));
  }, [params.hostId]);

  const displayRating = rating || (reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0);

  const totalCount = reviewCount || reviews.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Reviews</Text>
        <View style={{ width: 40 }} />
      </View>

      {displayRating > 0 && (
        <View style={[styles.summaryCard, { backgroundColor: colors.card, marginHorizontal: 16 }]}>
          <View style={styles.ratingBig}>
            <Text style={[styles.ratingNum, { color: colors.text }]}>{displayRating.toFixed(1)}</Text>
            <Stars count={Math.round(displayRating)} />
            <Text style={[styles.ratingTotal, { color: colors.mutedForeground }]}>{totalCount} reviews</Text>
          </View>
          <View style={styles.ratingBars}>
            {[5,4,3,2,1].map(star => {
              const count = reviews.filter(r => Math.round(r.rating) === star).length;
              const pct = reviews.length > 0 ? count / reviews.length : 0;
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
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#A00EE7" />
        </View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10, paddingBottom: insets.bottom + 20 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 60, gap: 8 }}>
              <Text style={{ fontSize: 40 }}>💬</Text>
              <Text style={[styles.emptyText, { color: colors.text }]}>No reviews yet</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Poppins_400Regular" }}>
                Be the first to leave a review!
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.reviewCard, { backgroundColor: colors.card }]}>
              <View style={styles.reviewTop}>
                <Image
                  source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.user_id ?? item.id}` }}
                  style={styles.reviewAvatar}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.reviewUser, { color: colors.text }]}>{item.user_name ?? "User"}</Text>
                  <Stars count={Math.round(item.rating)} />
                </View>
                <Text style={[styles.reviewDate, { color: colors.mutedForeground }]}>{formatDate(item.created_at)}</Text>
              </View>
              {!!item.comment && (
                <Text style={[styles.reviewText, { color: colors.mutedForeground }]}>{item.comment}</Text>
              )}
            </View>
          )}
        />
      )}
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
  emptyText: { fontSize: 16, fontFamily: "Poppins_600SemiBold" },
});
