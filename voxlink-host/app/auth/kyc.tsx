// Host Registration — Step 4: KYC Documents (Aadhar + Verification Video)
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image, ActivityIndicator, TextInput,
} from "react-native";
import { showErrorToast } from "@/components/Toast";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { appendFileToFormData } from "@/utils/fileUpload";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SvgIcon } from "@/components/SvgIcon";
import { API } from "@/services/api";

const BG     = "#0A0B1E";
const DARK   = "#111329";
const ACCENT = "#A00EE7";
const STEPS  = ["Account", "Profile", "Host Info", "KYC Docs"];

type DocItem = {
  key: "aadhar_front" | "aadhar_back" | "verification_video";
  label: string;
  sublabel: string;
  icon: "credit-card" | "video";
  accept: "image" | "video";
};

const DOCS: DocItem[] = [
  { key: "aadhar_front",       label: "Aadhar Front",       sublabel: "Photo of front side of Aadhar card",                          icon: "credit-card", accept: "image" },
  { key: "aadhar_back",        label: "Aadhar Back",        sublabel: "Photo of back side of Aadhar card",                           icon: "credit-card", accept: "image" },
  { key: "verification_video", label: "Verification Video", sublabel: "Short video (5–15 sec) of yourself holding the Aadhar", icon: "video",        accept: "video" },
];

function DocIcon({ icon, size }: { icon: "credit-card" | "video"; size: number }) {
  if (icon === "video") {
    return <Image source={require("@/assets/icons/ic_video.png")} style={{ width: size, height: size }} tintColor={ACCENT} resizeMode="contain" />;
  }
  return <SvgIcon name="credit-card" size={size} color={ACCENT} />;
}

export default function HostKYCScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { permissions, requestMediaLibrary, openSettings } = usePermissions();
  const params = useLocalSearchParams<{
    specialties: string; languages: string; bio: string;
    audioRate: string; videoRate: string; experience: string;
    dob: string;
  }>();

  const [dob, setDob]           = useState(params.dob ?? "");
  const [files, setFiles]       = useState<Record<string, { uri: string; uploaded?: string }>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDoc, setPendingDoc] = useState<DocItem | null>(null);
  const [showMediaDialog, setShowMediaDialog] = useState(false);

  const mediaBlocked =
    permissions.mediaLibrary.status === "blocked" ||
    (permissions.mediaLibrary.status === "denied" && !permissions.mediaLibrary.canAskAgain);

  const pickMedia = async (doc: DocItem) => {
    if (permissions.mediaLibrary.status !== "granted") {
      setPendingDoc(doc); setShowMediaDialog(true); return;
    }
    await launchPicker(doc);
  };

  const launchPicker = async (doc: DocItem) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: doc.accept === "image" ? ["images"] : ["videos"],
      quality: 0.8,
      allowsEditing: doc.accept === "image",
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(doc.key);
    try {
      const formData = new FormData();
      const ext = asset.uri.split(".").pop()?.split("?")[0] || (doc.accept === "image" ? "jpg" : "mp4");
      const mimeType = doc.accept === "image" ? `image/${ext}` : `video/${ext}`;
      await appendFileToFormData(formData, "file", asset.uri, `kyc_${doc.key}.${ext}`, mimeType);
      formData.append("path", `kyc/${user?.id ?? "unknown"}/${doc.key}.${ext}`);
      const uploadData = await API.uploadFile(formData);
      setFiles((prev) => ({ ...prev, [doc.key]: { uri: asset.uri, uploaded: uploadData.url } }));
    } catch {
      showErrorToast("Could not upload file. Please try again.", "Upload Failed");
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async () => {
    const aadharFront = files["aadhar_front"]?.uploaded;
    const aadharBack  = files["aadhar_back"]?.uploaded;
    if (!aadharFront || !aadharBack) {
      showErrorToast("Please upload both Aadhar front and back photos.", "Missing Documents"); return;
    }
    if (!dob.trim()) {
      showErrorToast("Date of birth is missing. Please go back to Step 2 and select your DOB.", "Missing DOB"); return;
    }
    setSubmitting(true);
    try {
      await API.submitHostApp({
        display_name: user?.name,
        date_of_birth: dob.trim(),
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
      router.replace("/auth/status");
    } catch (err: any) {
      showErrorToast(err?.message || "Could not submit your application. Please try again.", "Submission Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <PermissionDialog
        visible={showMediaDialog}
        config={{ ...PERMISSION_CONFIGS.mediaLibrary, isBlocked: mediaBlocked }}
        onAllow={async () => {
          if (mediaBlocked) {
            openSettings(); setShowMediaDialog(false);
          } else {
            const granted = await requestMediaLibrary();
            setShowMediaDialog(false);
            if (granted && pendingDoc) { await launchPicker(pendingDoc); setPendingDoc(null); }
          }
        }}
        onDeny={() => { setShowMediaDialog(false); setPendingDoc(null); }}
      />

      {/* ── Dark gradient header ── */}
      <LinearGradient colors={[BG, "#1A1C3A"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Image source={require("@/assets/icons/ic_back.png")} style={s.backIcon} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Image source={require("@/assets/images/app_logo.png")} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Become a Host</Text>
          <Text style={s.headerSub}>Step 4 of 4 — KYC Documents</Text>
        </View>

        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
              <LinearGradient colors={[ACCENT, "#6A00B8"]} style={s.stepCircle}>
                {i < 3 ? (
                  <Image source={require("@/assets/icons/ic_check.png")} style={s.stepCheck} tintColor="#fff" resizeMode="contain" />
                ) : (
                  <Text style={s.stepNumActive}>4</Text>
                )}
              </LinearGradient>
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
          <Image source={require("@/assets/icons/ic_secure.png")} style={s.noticeIcon} tintColor={ACCENT} resizeMode="contain" />
          <Text style={s.noticeTxt}>
            KYC is mandatory per Indian regulations. Documents are reviewed only by admin and never shared with users.
          </Text>
        </View>

        <Text style={s.fieldLabel}>Date of Birth</Text>
        {dob ? (
          <View style={s.dobReview}>
            <Image source={require("@/assets/icons/ic_calendar.png")} style={s.dobIcon} tintColor={ACCENT} resizeMode="contain" />
            <Text style={s.dobReviewTxt}>{dob}</Text>
            <View style={s.dobBadge}><Text style={s.dobBadgeTxt}>From Step 2</Text></View>
          </View>
        ) : (
          <TextInput
            style={s.dobInput}
            placeholder="DD/MM/YYYY (e.g. 22/05/1998)"
            placeholderTextColor="#aaa"
            value={dob}
            onChangeText={setDob}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            autoCorrect={false}
          />
        )}

        {DOCS.map((doc) => {
          const picked     = files[doc.key];
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
                  <SvgIcon name="check-circle" size={22} color="#fff" />
                ) : (
                  <DocIcon icon={doc.icon} size={22} />
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
                  <SvgIcon name="upload" size={14} color={ACCENT} />
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
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  backIcon: { width: 20, height: 20 },
  headerCenter: { alignItems: "center", gap: 6, marginBottom: 20 },
  headerLogo: { width: 52, height: 52, borderRadius: 14, marginBottom: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Poppins_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.6)" },
  steps: { flexDirection: "row", justifyContent: "space-between" },
  stepItem: { alignItems: "center", gap: 5 },
  stepCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  stepCheck: { width: 14, height: 14 },
  stepNumActive: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "#fff" },
  stepLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", textAlign: "center" },
  stepLabelActive: { color: "rgba(200,140,255,0.9)", fontSize: 10, fontFamily: "Poppins_600SemiBold", textAlign: "center" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 16 },
  sectionTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: DARK },
  sectionSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: -8 },
  noticeBanner: { flexDirection: "row", gap: 10, backgroundColor: "#F4E8FD", borderRadius: 12, padding: 14, alignItems: "flex-start" },
  noticeIcon: { width: 18, height: 18, marginTop: 1 },
  noticeTxt: { flex: 1, fontSize: 12, fontFamily: "Poppins_400Regular", color: DARK, lineHeight: 18 },
  fieldLabel: { fontSize: 13, fontFamily: "Poppins_600SemiBold", color: DARK, marginBottom: 6 },
  dobInput: { borderWidth: 1, borderColor: "#E8EAF0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Poppins_400Regular", color: DARK, backgroundColor: "#F8F9FC" },
  dobReview: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "#D1F0DA", backgroundColor: "#F0FDF4", paddingHorizontal: 14, paddingVertical: 12 },
  dobIcon: { width: 18, height: 18 },
  dobReviewTxt: { flex: 1, fontSize: 14, fontFamily: "Poppins_500Medium", color: DARK },
  dobBadge: { backgroundColor: "#22C55E", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  dobBadgeTxt: { fontSize: 10, fontFamily: "Poppins_500Medium", color: "#fff" },
  docCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, borderColor: "#E8EAF0", padding: 16, backgroundColor: "#F8F9FC" },
  docCardDone: { borderColor: "#22C55E", backgroundColor: "#F0FDF4" },
  docIconBg: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#F0E6FC", alignItems: "center", justifyContent: "center" },
  docIconBgDone: { backgroundColor: "#22C55E" },
  docInfo: { flex: 1 },
  docLabel: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: DARK },
  docSub: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: 2 },
  docThumb: { width: 44, height: 44, borderRadius: 8 },
  uploadBadge: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: ACCENT, alignItems: "center", justifyContent: "center" },
  tipsBanner: { backgroundColor: "#F8F9FC", borderRadius: 14, padding: 16, gap: 6 },
  tipsTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: DARK, marginBottom: 4 },
  tipRow: { flexDirection: "row", gap: 8 },
  tipBullet: { fontSize: 13, color: "#84889F" },
  tipTxt: { flex: 1, fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", lineHeight: 20 },
});
