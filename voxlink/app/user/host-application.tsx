import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  TextInput, ActivityIndicator, Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { API, resolveMediaUrl } from "@/services/api";
import { appendFileToFormData } from "@/utils/fileUpload";
import { alertDialog } from "@/utils/dialog";
import { showSuccessToast, showErrorToast } from "@/components/Toast";

type AppType = "audio" | "video" | "both";

export default function HostApplicationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form fields
  const [displayName, setDisplayName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("female");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [experience, setExperience] = useState("");
  const [appType, setAppType] = useState<AppType>("both");
  const [audioRate, setAudioRate] = useState("25");
  const [videoRate, setVideoRate] = useState("40");
  const [specialties, setSpecialties] = useState("");
  const [languages, setLanguages] = useState("English");
  const [aadharFront, setAadharFront] = useState<string | null>(null);
  const [aadharBack, setAadharBack] = useState<string | null>(null);
  const [uploadingFront, setUploadingFront] = useState(false);
  const [uploadingBack, setUploadingBack] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await API.getHostAppStatus();
      if (res?.applied) {
        setStatus(res.status);
        setRejectionReason(res.rejection_reason ?? null);
        setShowForm(res.status === "rejected");
      } else {
        setStatus(null);
        setShowForm(true);
      }
    } catch {
      setStatus(null);
      setShowForm(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);


  const pickImage = useCallback(async (which: "front" | "back") => {
    const setUploading = which === "front" ? setUploadingFront : setUploadingBack;
    const setUrl = which === "front" ? setAadharFront : setAadharBack;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        alertDialog("Permission Required", "Please allow photo library access to upload your ID.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const fd = new FormData();
      const rawExt = (asset.uri.split(".").pop() || "jpg").toLowerCase();
      const ext = rawExt === "jpg" ? "jpeg" : rawExt;
      await appendFileToFormData(fd, "file", asset.uri, `kyc_${which}.${rawExt}`, `image/${ext}`);
      const res = await API.uploadFile(fd);
      if (res?.url) setUrl(resolveMediaUrl(res.url) || res.url);
      else showErrorToast("Upload failed. Please try again.");
    } catch {
      showErrorToast("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!aadharFront || !aadharBack) {
      alertDialog("ID Required", "Please upload both the front and back of your Aadhaar card.");
      return;
    }
    if (!dob.trim()) {
      alertDialog("Date of Birth Required", "Please enter your date of birth (you must be 18+).");
      return;
    }
    setSubmitting(true);
    try {
      const data = {
        display_name: displayName.trim() || undefined,
        date_of_birth: dob.trim(),
        gender,
        phone: phone.trim() || undefined,
        bio: bio.trim() || undefined,
        experience: experience.trim() || undefined,
        application_type: appType,
        audio_rate: Number(audioRate) || 25,
        video_rate: Number(videoRate) || 40,
        specialties: specialties.split(",").map((s) => s.trim()).filter(Boolean),
        languages: languages.split(",").map((s) => s.trim()).filter(Boolean),
        aadhar_front_url: aadharFront,
        aadhar_back_url: aadharBack,
      };
      const res: any = await API.submitHostApp(data);
      if (res?.success) {
        showSuccessToast("Application submitted! We'll review it shortly.", "Submitted");
        setStatus("pending");
        setShowForm(false);
      } else {
        alertDialog("Submission Failed", res?.error || "Please check your details and try again.");
      }
    } catch (err: any) {
      alertDialog("Submission Failed", err?.message || "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [aadharFront, aadharBack, dob, displayName, gender, phone, bio, experience, appType, audioRate, videoRate, specialties, languages]);


  const Header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.background }]}>
      <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]} accessibilityRole="button" accessibilityLabel="Go back">
        <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
      </TouchableOpacity>
      <Text style={[styles.title, { color: colors.text }]}>Become a Host</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {Header}
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  // Status card (pending / under_review / approved) — no form.
  if (status && status !== "rejected" && !showForm) {
    const isApproved = status === "approved";
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {Header}
        <View style={styles.center}>
          <Text style={{ fontSize: 54 }}>{isApproved ? "🎉" : "⏳"}</Text>
          <Text style={[styles.statusTitle, { color: colors.text }]}>
            {isApproved ? "You're approved!" : "Application under review"}
          </Text>
          <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>
            {isApproved
              ? "Reopen the app to access Host mode and start earning."
              : "We're reviewing your KYC details. You'll be notified once it's approved — usually within 24–48 hours."}
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.primaryBtnText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }


  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {Header}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {status === "rejected" && (
          <View style={styles.rejectBanner}>
            <Text style={styles.rejectTitle}>Application rejected</Text>
            {rejectionReason ? <Text style={styles.rejectReason}>{rejectionReason}</Text> : null}
            <Text style={styles.rejectReason}>Please correct the details below and re-submit.</Text>
          </View>
        )}
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Apply to become a host and earn coins on calls. We need a few details + ID for verification (18+ only).
        </Text>

        <LabeledInput c={colors} label="Display name" value={displayName} onChange={setDisplayName} placeholder="Your public name" />
        <LabeledInput c={colors} label="Date of birth" value={dob} onChange={setDob} placeholder="DD/MM/YYYY" />

        <Text style={[styles.label, { color: colors.text }]}>Gender</Text>
        <Seg c={colors} options={["female", "male", "other"]} value={gender} onChange={setGender} />

        <LabeledInput c={colors} label="Phone" value={phone} onChange={setPhone} placeholder="Contact number" keyboardType="phone-pad" />
        <LabeledInput c={colors} label="Bio" value={bio} onChange={setBio} placeholder="Tell users about yourself" multiline />
        <LabeledInput c={colors} label="Experience (optional)" value={experience} onChange={setExperience} placeholder="Relevant experience" multiline />

        <Text style={[styles.label, { color: colors.text }]}>Call type</Text>
        <Seg c={colors} options={["both", "audio", "video"]} value={appType} onChange={(v: string) => setAppType(v as AppType)} />

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <LabeledInput c={colors} label="Audio rate (coins/min)" value={audioRate} onChange={setAudioRate} placeholder="25" keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <LabeledInput c={colors} label="Video rate (coins/min)" value={videoRate} onChange={setVideoRate} placeholder="40" keyboardType="number-pad" />
          </View>
        </View>

        <LabeledInput c={colors} label="Specialties (comma separated)" value={specialties} onChange={setSpecialties} placeholder="e.g. Relationships, Career" />
        <LabeledInput c={colors} label="Languages (comma separated)" value={languages} onChange={setLanguages} placeholder="English, Hindi" />


        <Text style={[styles.label, { color: colors.text }]}>Aadhaar card (front & back)</Text>
        <View style={styles.row2}>
          <UploadTile c={colors} label="Front" url={aadharFront} uploading={uploadingFront} onPress={() => pickImage("front")} />
          <UploadTile c={colors} label="Back" url={aadharBack} uploading={uploadingBack} onPress={() => pickImage("back")} />
        </View>

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={submitting}
          style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1, marginTop: 20 }]}
          accessibilityRole="button"
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Submit Application</Text>}
        </TouchableOpacity>
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          By submitting you confirm you are 18+ and the details are accurate. Your ID is used only for verification.
        </Text>
      </ScrollView>
    </View>
  );
}

function LabeledInput({ c, label, value, onChange, placeholder, multiline, keyboardType }: any) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && { height: 84, textAlignVertical: "top" }, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
      />
    </View>
  );
}

function Seg({ c, options, value, onChange }: any) {
  return (
    <View style={[styles.segRow, { backgroundColor: c.surface, borderColor: c.border }]}>
      {options.map((opt: string) => {
        const active = value === opt;
        return (
          <TouchableOpacity key={opt} onPress={() => onChange(opt)} style={[styles.segItem, active && { backgroundColor: c.primary }]}>
            <Text style={[styles.segText, { color: active ? "#fff" : c.text }]}>{opt[0].toUpperCase() + opt.slice(1)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}


function UploadTile({ c, label, url, uploading, onPress }: any) {
  return (
    <TouchableOpacity onPress={onPress} disabled={uploading} style={[styles.uploadTile, { backgroundColor: c.surface, borderColor: url ? c.primary : c.border }]} accessibilityRole="button" accessibilityLabel={`Upload Aadhaar ${label}`}>
      {uploading ? (
        <ActivityIndicator color={c.primary} />
      ) : url ? (
        <Image source={{ uri: url }} style={styles.uploadImg} resizeMode="cover" />
      ) : (
        <>
          <Text style={{ fontSize: 26 }}>📷</Text>
          <Text style={[styles.uploadLabel, { color: c.mutedForeground }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 18, height: 18 },
  title: { fontSize: 18, fontFamily: "Poppins_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  statusTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", textAlign: "center" },
  statusSub: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 20 },
  intro: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 19, marginBottom: 16 },
  label: { fontSize: 13, fontFamily: "Poppins_600SemiBold", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 12 : 9, fontSize: 14, fontFamily: "Poppins_400Regular" },
  row2: { flexDirection: "row", gap: 12 },
  segRow: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 4, marginBottom: 12, gap: 4 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  segText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  uploadTile: { flex: 1, height: 110, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", overflow: "hidden", gap: 4 },
  uploadImg: { width: "100%", height: "100%" },
  uploadLabel: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  primaryBtnText: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: "#fff" },
  disclaimer: { fontSize: 11, fontFamily: "Poppins_400Regular", textAlign: "center", marginTop: 12, lineHeight: 16 },
  rejectBanner: { backgroundColor: "#FDECEC", borderRadius: 12, padding: 12, marginBottom: 14 },
  rejectTitle: { fontSize: 14, fontFamily: "Poppins_600SemiBold", color: "#C0392B" },
  rejectReason: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#C0392B", marginTop: 2 },
});

export { ErrorBoundary } from "@/components/RouteErrorBoundary";
