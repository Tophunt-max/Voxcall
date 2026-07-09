import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, TextInput, Alert, Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { appendFileToFormData } from "@/utils/fileUpload";
import { useColors } from "@/hooks/useColors";
import { API, resolveMediaUrl } from "@/services/api";
import { showSuccessToast, showErrorToast } from "@/components/Toast";
import { WEB_INPUT_RESET } from "@workspace/shared-ui/utils";

const MAX_ITEMS = 6;

export default function HostGalleryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [introUrl, setIntroUrl] = useState("");
  const [savingIntro, setSavingIntro] = useState(false);

  const load = useCallback(async () => {
    const [gallery, me] = await Promise.all([
      API.getMyGallery().catch(() => [] as any[]),
      API.getHostMe().catch(() => null),
    ]);
    setItems(gallery ?? []);
    setIntroUrl((me?.intro_video_url as string) || "");
  }, []);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const pickAndUpload = useCallback(async () => {
    if (items.length >= MAX_ITEMS) { showErrorToast(`Maximum ${MAX_ITEMS} highlights allowed.`); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") { showErrorToast("Media library permission is needed to add highlights."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.85 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const isVideo = asset.type === "video" || /\.(mp4|mov|m4v|webm)$/i.test(asset.uri);
    try {
      setUploading(true);
      const fd = new FormData();
      const ext = asset.uri.split(".").pop()?.split("?")[0] || (isVideo ? "mp4" : "jpg");
      const fileName = `gallery_${Date.now()}.${ext}`;
      await appendFileToFormData(fd, "file", asset.uri, fileName, `${isVideo ? "video" : "image"}/${ext}`);
      fd.append("path", `gallery/${fileName}`);
      const up = await API.uploadFile(fd);
      if (up?.url) {
        await API.addGalleryItem({ media_url: up.url, media_type: isVideo ? "video" : "image" });
        await load();
        showSuccessToast("Added to your highlights.");
      }
    } catch (e: any) {
      showErrorToast(e?.message || "Upload failed. Please try again.");
    } finally { setUploading(false); }
  }, [items.length, load]);


  const removeItem = useCallback((id: string) => {
    const doDelete = async () => {
      try { await API.deleteGalleryItem(id); await load(); }
      catch { showErrorToast("Couldn't remove that item."); }
    };
    // Alert.alert confirm works on native (the primary host-app surface). On
    // web it's a no-op, so fall back to window.confirm there.
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm("Remove this from your highlights?")) doDelete();
    } else {
      Alert.alert("Remove highlight", "Remove this from your highlights?", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: doDelete },
      ]);
    }
  }, [load]);

  const saveIntro = useCallback(async () => {
    setSavingIntro(true);
    try {
      await API.setIntroVideo(introUrl.trim() || null);
      showSuccessToast(introUrl.trim() ? "Intro video saved." : "Intro video removed.");
    } catch {
      showErrorToast("Couldn't save the intro video.");
    } finally { setSavingIntro(false); }
  }, [introUrl]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[st.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[st.backBtn, { backgroundColor: colors.surface }]} accessibilityRole="button" accessibilityLabel="Go back">
          <Image source={require("@/assets/icons/ic_back.png")} style={st.backIco} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[st.title, { color: colors.text }]}>Highlights</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 22 }} showsVerticalScrollIndicator={false}>
          <Text style={[st.subtle, { color: colors.mutedForeground }]}>
            Add up to {MAX_ITEMS} photos or videos. These appear on your public profile so callers can see your vibe before calling.
          </Text>

          <View style={st.grid}>
            {items.map((g) => (
              <View key={g.id} style={[st.tile, { backgroundColor: colors.surface }]}>
                {g.media_type === "video" ? (
                  <View style={[st.tileMedia, { backgroundColor: "#111329", alignItems: "center", justifyContent: "center" }]}>
                    <Text style={st.playGlyph}>▶</Text>
                  </View>
                ) : (
                  <Image source={{ uri: resolveMediaUrl(g.media_url) || g.media_url }} style={st.tileMedia} resizeMode="cover" />
                )}
                <TouchableOpacity onPress={() => removeItem(g.id)} style={st.removeBtn} accessibilityRole="button" accessibilityLabel="Remove highlight">
                  <Text style={st.removeGlyph}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}

            {items.length < MAX_ITEMS && (
              <TouchableOpacity onPress={pickAndUpload} disabled={uploading} style={[st.tile, st.addTile, { borderColor: colors.primary }]} activeOpacity={0.8}>
                {uploading ? <ActivityIndicator color={colors.primary} /> : (
                  <>
                    <Text style={[st.addPlus, { color: colors.primary }]}>＋</Text>
                    <Text style={[st.addLabel, { color: colors.primary }]}>Add photo / video</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>


          {/* Intro video URL */}
          <View style={{ gap: 8 }}>
            <Text style={[st.sectionLabel, { color: colors.text }]}>Intro video</Text>
            <Text style={[st.subtle, { color: colors.mutedForeground }]}>
              Paste a link to a short intro video (YouTube, etc.). It shows first in your Highlights.
            </Text>
            <TextInput
              value={introUrl}
              onChangeText={setIntroUrl}
              placeholder="https://…"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[st.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            />
            <TouchableOpacity onPress={saveIntro} disabled={savingIntro} style={[st.saveBtn, { backgroundColor: colors.primary }]} activeOpacity={0.85}>
              {savingIntro ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.saveTxt}>Save intro video</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  backIco: { width: 18, height: 18 },
  title: { flex: 1, fontSize: 18, fontFamily: "Poppins_600SemiBold", textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  subtle: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 19 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "30%", aspectRatio: 0.75, borderRadius: 14, overflow: "hidden" },
  tileMedia: { width: "100%", height: "100%" },
  playGlyph: { fontSize: 22, color: "#fff" },
  removeBtn: { position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  removeGlyph: { color: "#fff", fontSize: 12, fontFamily: "Poppins_700Bold" },
  addTile: { borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4 },
  addPlus: { fontSize: 26, fontFamily: "Poppins_700Bold" },
  addLabel: { fontSize: 10, fontFamily: "Poppins_500Medium", textAlign: "center" },
  sectionLabel: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Poppins_400Regular", ...(WEB_INPUT_RESET as any) },
  saveBtn: { paddingVertical: 13, borderRadius: 12, alignItems: "center", marginTop: 2 },
  saveTxt: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});


// Per-screen error boundary — a render crash stays contained (retry / go back).
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
