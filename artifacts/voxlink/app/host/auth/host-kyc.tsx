// Host Registration — Step 4: KYC Documents (Aadhar + Verification Video)
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Image, ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";
import { API } from "@/services/api";

const DARK = "#111329";
const ACCENT = "#A00EE7";
const STEPS = ["Account", "Profile", "Host Info", "KYC Docs"];

type DocItem = {
  key: "aadhar_front" | "aadhar_back" | "verification_video";
  label: string;
  sublabel: string;
  icon: string;
  accept: "image" | "video";
};

const DOCS: DocItem[] = [
  { key: "aadhar_front", label: "Aadhar Front", sublabel: "Photo of front side of Aadhar card", icon: "credit-card", accept: "image" },
  { key: "aadhar_back", label: "Aadhar Back", sublabel: "Photo of back side of Aadhar card", icon: "credit-card", accept: "image" },
  { key: "verification_video", label: "Verification Video", sublabel: "Short video (5–15 sec) of yourself holding the Aadhar", icon: "video", accept: "video" },
];

export default function HostKYCScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    specialties: string; languages: string; bio: string;
    audioRate: string; videoRate: string; experience: string;
  }>();

  const [files, setFiles] = useState<Record<string, { uri: string; uploaded?: string }>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickMedia = async (doc: DocItem) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow media library access in Settings.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: doc.accept === "image" ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      quality: 0.8,
      allowsEditing: doc.accept === "image",
    });

    if (result.canceled) return;
    const asset = result.assets[0];

    setUploading(doc.key);
    try {
      const formData = new FormData();
      const ext = asset.uri.split(".").pop() || (doc.accept === "image" ? "jpg" : "mp4");
      formData.append("file", { uri: asset.uri, name: `kyc_${doc.key}.${ext}`, type: doc.accept === "image" ? `image/${ext}` : `video/${ext}` } as any);
      formData.append("path", `kyc/${user?.id ?? "unknown"}/${doc.key}.${ext}`);

      const uploadData = await API.uploadFile(formData);
      setFiles((prev) => ({ ...prev, [doc.key]: { uri: asset.uri, uploaded: uploadData.url } }));
    } catch (err) {
      Alert.alert("Upload Failed", "Could not upload file. Please try again.");
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async () => {
    const aadharFront = files["aadhar_front"]?.uploaded;
    const aadharBack = files["aadhar_back"]?.uploaded;

    if (!aadharFront || !aadharBack) {
      Alert.alert("Missing Documents", "Please upload both Aadhar front and back photos.");
      return;
    }

    setSubmitting(true);
    try {
      await API.submitHostApp({
        display_name: user?.name,
        date_of_birth: undefined,
        gender: user?.gender,
        phone: user?.phone,
        bio: params.bio,
        specialties: JSON.parse(params.specialties || "[]"),
        languages: JSON.parse(params.languages || '["Hindi"]'),
        experience: params.experience,
        audio_rate: parseInt(params.audioRate) || 5,
        video_rate: parseInt(params.videoRate) || 8,
        aadhar_front_url: aadharFront,
        aadhar_back_url: aadharBack,
        verification_video_url: files["verification_video"]?.uploaded ?? null,
      });
      router.replace("/host/auth/host-status");
    } catch (err: any) {
      Alert.alert("Submission Failed", err?.message || "Could not submit your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <LinearGradient colors={[DARK, "#2D3057"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Become a Host</Text>
        <Text style={s.headerSub}>Step 4 of 4 — KYC Documents</Text>
        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
              <View style={[s.stepDot, s.stepDotActive]}>
                {i < 3 ? (
                  <Feather name="check" size={14} color="#fff" />
                ) : (
                  <Text style={s.stepNumActive}>4</Text>
                )}
              </View>
              <Text style={s.stepLabelActive}>{step}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.form, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.sectionTitle}>Identity Verification</Text>
        <Text style={s.sectionSub}>Required to start hosting. Your documents are securely stored.</Text>

        <View style={s.noticeBanner}>
          <Feather name="shield" size={16} color={ACCENT} />
          <Text style={s.noticeTxt}>
            KYC is mandatory per Indian regulations. Documents are reviewed only by admin and never shared with users.
          </Text>
        </View>

        {DOCS.map((doc) => {
          const picked = files[doc.key];
          const isUploading = uploading === doc.key;

          return (
            <TouchableOpacity
              key={doc.key}
              onPress={() => pickMedia(doc)}
              style={[s.docCard, picked?.uploaded && s.docCardDone]}
              activeOpacity={0.8}
              disabled={!!isUploading || submitting}
            >
              <View style={[s.docIconBg, picked?.uploaded && s.docIconBgDone]}>
                {isUploading ? (
                  <ActivityIndicator color={picked?.uploaded ? "#fff" : ACCENT} size="small" />
                ) : picked?.uploaded ? (
                  <Feather name="check-circle" size={22} color="#fff" />
                ) : (
                  <Feather name={doc.icon as any} size={22} color={ACCENT} />
                )}
              </View>
              <View style={s.docInfo}>
                <Text style={s.docLabel}>{doc.label}</Text>
                <Text style={s.docSub}>
                  {isUploading ? "Uploading..." : picked?.uploaded ? "Uploaded ✓" : doc.sublabel}
                </Text>
              </View>
              {picked?.uri && doc.accept === "image" && (
                <Image source={{ uri: picked.uri }} style={s.docThumb} />
              )}
              {!picked && !isUploading && (
                <View style={s.uploadBadge}>
                  <Feather name="upload" size={14} color={ACCENT} />
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        <View style={s.tipsBanner}>
          <Text style={s.tipsTitle}>Tips for Approval</Text>
          {[
            "Ensure Aadhar photos are clear and not blurry",
            "Hold your Aadhar card clearly in the verification video",
            "Look into the camera while recording",
          ].map((tip, i) => (
            <View key={i} style={s.tipRow}>
              <Text style={s.tipBullet}>•</Text>
              <Text style={s.tipTxt}>{tip}</Text>
            </View>
          ))}
        </View>

        <PrimaryButton
          title={submitting ? "Submitting..." : "Submit Application"}
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting || !!uploading}
        />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 24 },
  backBtn: { marginBottom: 12, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff", marginBottom: 4 },
  headerSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.7)", marginBottom: 20 },
  steps: { flexDirection: "row" },
  stepItem: { flex: 1, alignItems: "center", gap: 4 },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotActive: { backgroundColor: "#A00EE7" },
  stepNumActive: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  stepLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", textAlign: "center" },
  stepLabelActive: { color: "#fff", fontSize: 10, fontFamily: "Poppins_400Regular", textAlign: "center" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 16 },
  sectionTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: "#111329" },
  sectionSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: -8 },
  noticeBanner: { flexDirection: "row", gap: 10, backgroundColor: "#F4E8FD", borderRadius: 12, padding: 14 },
  noticeTxt: { flex: 1, fontSize: 12, fontFamily: "Poppins_400Regular", color: "#111329", lineHeight: 18 },
  docCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, borderColor: "#E8EAF0", padding: 16, backgroundColor: "#F8F9FC" },
  docCardDone: { borderColor: "#22C55E", backgroundColor: "#F0FDF4" },
  docIconBg: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#F0E6FC", alignItems: "center", justifyContent: "center" },
  docIconBgDone: { backgroundColor: "#22C55E" },
  docInfo: { flex: 1 },
  docLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#111329" },
  docSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: 2 },
  docThumb: { width: 44, height: 44, borderRadius: 8 },
  uploadBadge: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: "#A00EE7", alignItems: "center", justifyContent: "center" },
  tipsBanner: { backgroundColor: "#F8F9FC", borderRadius: 14, padding: 16, gap: 6 },
  tipsTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#111329", marginBottom: 4 },
  tipRow: { flexDirection: "row", gap: 8 },
  tipBullet: { fontSize: 13, color: "#84889F" },
  tipTxt: { flex: 1, fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", lineHeight: 20 },
});
