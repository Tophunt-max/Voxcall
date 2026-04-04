// Host Registration — Step 2: Profile Info
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Platform, Modal, FlatList, ActivityIndicator,
} from "react-native";
import { showErrorToast } from "@/components/Toast";
import AppInput from "@/components/AppInput";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SvgIcon } from "@/components/SvgIcon";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { appendFileToFormData } from "@/utils/fileUpload";
import { API } from "@/services/api";

const BG     = "#0A0B1E";
const DARK   = "#111329";
const ACCENT = "#A00EE7";
const STEPS  = ["Account", "Profile", "Host Info", "KYC Docs"];
const GENDERS: Array<{ label: string; value: string }> = [
  { label: "Male", value: "male" },
  { label: "Female", value: "female" },
  { label: "Other", value: "other" },
];

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const today    = new Date();
const MIN_DATE = new Date(today.getFullYear() - 70, 0, 1);
const MAX_DATE = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());

function formatDob(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function ScrollColumn({ items, selectedIndex, onSelect }: { items: string[]; selectedIndex: number; onSelect: (i: number) => void }) {
  const ITEM_H = 48;
  const ref = React.useRef<FlatList<string>>(null);
  React.useEffect(() => {
    setTimeout(() => { ref.current?.scrollToIndex({ index: selectedIndex, animated: false, viewPosition: 0.5 }); }, 100);
  }, []);
  return (
    <FlatList
      ref={ref}
      data={items}
      keyExtractor={(_, i) => String(i)}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      style={{ height: ITEM_H * 5, width: "100%" }}
      contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
      getItemLayout={(_, i) => ({ length: ITEM_H, offset: ITEM_H * i, index: i })}
      onMomentumScrollEnd={(e) => {
        const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
        onSelect(Math.max(0, Math.min(i, items.length - 1)));
      }}
      renderItem={({ item, index }) => (
        <TouchableOpacity onPress={() => { onSelect(index); ref.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }); }} activeOpacity={0.7} style={[p.colItem, index === selectedIndex && p.colItemActive]}>
          <Text style={[p.colItemTxt, index === selectedIndex && p.colItemTxtActive]}>{item}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

function WebDatePicker({ visible, initial, onDone, onCancel }: { visible: boolean; initial: Date; onDone: (d: Date) => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const years: string[] = [];
  for (let y = today.getFullYear() - 18; y >= today.getFullYear() - 70; y--) years.push(String(y));
  const days: string[] = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
  const [dayIdx, setDayIdx] = useState(initial.getDate() - 1);
  const [monIdx, setMonIdx] = useState(initial.getMonth());
  const [yearIdx, setYearIdx] = useState(years.indexOf(String(initial.getFullYear())) === -1 ? 0 : years.indexOf(String(initial.getFullYear())));
  const handleDone = () => {
    const y = parseInt(years[yearIdx], 10);
    const m = monIdx;
    const dMax = new Date(y, m + 1, 0).getDate();
    onDone(new Date(y, m, Math.min(dayIdx + 1, dMax)));
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <TouchableOpacity style={p.overlay} activeOpacity={1} onPress={onCancel} />
      <View style={[p.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={p.sheetHandle} />
        <View style={p.sheetHeader}>
          <TouchableOpacity onPress={onCancel}><Text style={p.sheetCancel}>Cancel</Text></TouchableOpacity>
          <Text style={p.sheetTitle}>Date of Birth</Text>
          <TouchableOpacity onPress={handleDone}><Text style={p.sheetDone}>Done</Text></TouchableOpacity>
        </View>
        <View style={p.pickerRow}>
          <View style={p.colWrap}><Text style={p.colLabel}>Day</Text><View style={p.colBox}><View style={p.selHighlight} /><ScrollColumn items={days} selectedIndex={dayIdx} onSelect={setDayIdx} /></View></View>
          <View style={[p.colWrap, { flex: 2 }]}><Text style={p.colLabel}>Month</Text><View style={p.colBox}><View style={p.selHighlight} /><ScrollColumn items={MONTHS} selectedIndex={monIdx} onSelect={setMonIdx} /></View></View>
          <View style={p.colWrap}><Text style={p.colLabel}>Year</Text><View style={p.colBox}><View style={p.selHighlight} /><ScrollColumn items={years} selectedIndex={yearIdx} onSelect={setYearIdx} /></View></View>
        </View>
      </View>
    </Modal>
  );
}

export default function HostProfileSetupScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [dob, setDob]                 = useState("");
  const [dobDate, setDobDate]         = useState<Date>(MAX_DATE);
  const [gender, setGender]           = useState(user?.gender ?? "");
  const [phone, setPhone]             = useState(user?.phone ?? "");
  const [loading, setLoading]         = useState(false);
  const [avatarUri, setAvatarUri]     = useState<string | null>(user?.avatar ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl]     = useState<string | null>(null);
  const [showNativePicker, setShowNativePicker] = useState(false);
  const [showWebPicker, setShowWebPicker]       = useState(false);
  const isWeb = Platform.OS === "web";

  const openPicker = () => { if (isWeb) setShowWebPicker(true); else setShowNativePicker(true); };

  const onNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowNativePicker(false);
    if (event.type === "dismissed") return;
    if (selected) { setDobDate(selected); setDob(formatDob(selected)); }
  };

  const handlePickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setAvatarUri(asset.uri);
    setAvatarUploading(true);
    try {
      const ext = asset.uri.split(".").pop()?.split("?")[0] || "jpg";
      const formData = new FormData();
      await appendFileToFormData(formData, "file", asset.uri, `avatar_${user?.id ?? "host"}.${ext}`, `image/${ext}`);
      formData.append("path", `avatars/${user?.id ?? "host"}.${ext}`);
      const uploaded = await API.uploadFile(formData);
      setAvatarUrl(uploaded.url);
    } catch {
      showErrorToast("Could not upload photo. Please try again.", "Upload Failed");
      setAvatarUri(null);
    } finally { setAvatarUploading(false); }
  };

  const handleNext = async () => {
    if (!displayName.trim() || !dob.trim() || !gender || !phone.trim()) {
      showErrorToast("Please fill in all required fields.", "Missing Fields"); return;
    }
    if (!/^\d{10,15}$/.test(phone.replace(/[\s\-\+]/g, ""))) {
      showErrorToast("Please enter a valid mobile number.", "Invalid Phone"); return;
    }
    setLoading(true);
    await updateProfile({ name: displayName.trim(), gender: gender as any, phone: phone.trim(), ...(avatarUrl ? { avatar: avatarUrl } : {}) });
    setLoading(false);
    router.push({ pathname: "/auth/become", params: { dob: dob.trim() } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* ── Dark gradient header ── */}
      <LinearGradient colors={[BG, "#1A1C3A"]} style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.8}>
          <Image source={require("@/assets/icons/ic_back.png")} style={s.backIcon} tintColor="#fff" resizeMode="contain" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Image source={require("@/assets/images/app_logo.png")} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>Become a Host</Text>
          <Text style={s.headerSub}>Step 2 of 4 — Your Profile</Text>
        </View>

        <View style={s.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={s.stepItem}>
              <LinearGradient
                colors={i <= 1 ? [ACCENT, "#6A00B8"] : ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.12)"]}
                style={s.stepCircle}
              >
                {i < 1 ? (
                  <Image source={require("@/assets/icons/ic_check.png")} style={s.stepCheck} tintColor="#fff" resizeMode="contain" />
                ) : (
                  <Text style={[s.stepNum, i <= 1 && s.stepNumActive]}>{i + 1}</Text>
                )}
              </LinearGradient>
              <Text style={[s.stepLabel, i <= 1 && s.stepLabelActive]}>{step}</Text>
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
        <Text style={s.sectionTitle}>Your Profile Info</Text>
        <Text style={s.sectionSub}>This will be visible to users calling you</Text>

        {/* ── Profile Photo ── */}
        <View style={s.avatarSection}>
          <TouchableOpacity onPress={handlePickAvatar} style={s.avatarWrap} activeOpacity={0.8} disabled={avatarUploading}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={s.avatarImg} />
            ) : (
              <View style={s.avatarPlaceholder}>
                <Image source={require("@/assets/icons/ic_profile.png")} style={s.avatarIcon} tintColor="#B0B3C7" resizeMode="contain" />
              </View>
            )}
            <View style={s.cameraBtn}>
              {avatarUploading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <SvgIcon name="camera" size={14} color="#fff" />
              )}
            </View>
          </TouchableOpacity>
          <Text style={s.avatarHint}>{avatarUploading ? "Uploading..." : "Tap to add profile photo"}</Text>
        </View>

        <AppInput
          icon={<Image source={require("@/assets/icons/ic_profile.png")} style={s.inputIcon} tintColor="#84889F" resizeMode="contain" />}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Display name"
          autoCapitalize="words"
        />

        {/* ── Date of Birth ── */}
        <TouchableOpacity onPress={openPicker} activeOpacity={0.8} style={s.dobField}>
          <Image source={require("@/assets/icons/ic_calendar.png")} style={s.inputIcon} tintColor={dob ? ACCENT : "#84889F"} resizeMode="contain" />
          <Text style={[s.dobText, !dob && s.dobPlaceholder]}>{dob || "Date of birth (tap to pick)"}</Text>
          <SvgIcon name="chevron-down" size={16} color="#84889F" />
        </TouchableOpacity>

        {!isWeb && showNativePicker && (
          <View style={Platform.OS === "ios" ? s.iosPickerWrap : undefined}>
            <DateTimePicker
              value={dobDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={onNativeChange}
              maximumDate={MAX_DATE}
              minimumDate={MIN_DATE}
              textColor={DARK}
              accentColor={ACCENT}
            />
            {Platform.OS === "ios" && (
              <TouchableOpacity style={s.iosDoneBtn} onPress={() => setShowNativePicker(false)}>
                <Text style={s.iosDoneTxt}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {isWeb && (
          <WebDatePicker
            visible={showWebPicker}
            initial={dobDate}
            onDone={(d) => { setDobDate(d); setDob(formatDob(d)); setShowWebPicker(false); }}
            onCancel={() => setShowWebPicker(false)}
          />
        )}

        <AppInput
          icon={<SvgIcon name="phone" size={18} color="#84889F" />}
          value={phone}
          onChangeText={setPhone}
          placeholder="Mobile number"
          keyboardType="phone-pad"
        />

        <Text style={s.fieldLabel}>Gender</Text>
        <View style={s.genderRow}>
          {GENDERS.map((g) => (
            <TouchableOpacity
              key={g.value}
              onPress={() => setGender(g.value)}
              style={[s.genderBtn, gender === g.value && s.genderBtnActive]}
              activeOpacity={0.75}
            >
              <Text style={[s.genderTxt, gender === g.value && s.genderTxtActive]}>{g.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <PrimaryButton title="Continue → Host Info" onPress={handleNext} loading={loading || avatarUploading} />
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
  stepNum: { fontSize: 13, fontFamily: "Poppins_700Bold", color: "rgba(255,255,255,0.5)" },
  stepNumActive: { color: "#fff" },
  stepLabel: { fontSize: 10, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.45)" },
  stepLabelActive: { color: "rgba(200,140,255,0.9)", fontFamily: "Poppins_600SemiBold" },
  form: { paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  sectionTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: DARK },
  sectionSub: { fontSize: 13, fontFamily: "Poppins_400Regular", color: "#84889F", marginTop: -8, marginBottom: 4 },
  avatarSection: { alignItems: "center", gap: 10, marginBottom: 8 },
  avatarWrap: { position: "relative", width: 96, height: 96 },
  avatarImg: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: ACCENT },
  avatarPlaceholder: { width: 96, height: 96, borderRadius: 48, backgroundColor: "#F0E9FD", borderWidth: 2, borderColor: "#E0CDFB", alignItems: "center", justifyContent: "center" },
  avatarIcon: { width: 36, height: 36 },
  cameraBtn: { position: "absolute", bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  avatarHint: { fontSize: 12, fontFamily: "Poppins_400Regular", color: "#84889F" },
  inputIcon: { width: 18, height: 18 },
  dobField: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14 },
  dobText: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", color: DARK },
  dobPlaceholder: { color: "#84889F" },
  iosPickerWrap: { backgroundColor: "#F8F9FC", borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0", overflow: "hidden" },
  iosDoneBtn: { alignItems: "flex-end", paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#E8EAF0" },
  iosDoneTxt: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: ACCENT },
  fieldLabel: { fontSize: 14, fontFamily: "Poppins_500Medium", color: DARK, marginBottom: -6 },
  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#E8EAF0", alignItems: "center", backgroundColor: "#F8F9FC" },
  genderBtnActive: { borderColor: ACCENT, backgroundColor: "#F4E8FD" },
  genderTxt: { fontSize: 14, fontFamily: "Poppins_500Medium", color: "#84889F" },
  genderTxtActive: { color: ACCENT },
});

const p = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingHorizontal: 16 },
  sheetHandle: { width: 40, height: 4, backgroundColor: "#E0E0E0", borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sheetCancel: { fontSize: 15, fontFamily: "Poppins_400Regular", color: "#84889F" },
  sheetTitle: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: DARK },
  sheetDone: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: ACCENT },
  pickerRow: { flexDirection: "row", gap: 8 },
  colWrap: { flex: 1, alignItems: "center" },
  colLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "#84889F", marginBottom: 6 },
  colBox: { width: "100%", overflow: "hidden", position: "relative" },
  selHighlight: { position: "absolute", top: "50%", left: 0, right: 0, height: 48, marginTop: -24, backgroundColor: "#F4E8FD", borderRadius: 10, zIndex: 0 },
  colItem: { height: 48, justifyContent: "center", alignItems: "center" },
  colItemActive: {},
  colItemTxt: { fontSize: 15, fontFamily: "Poppins_400Regular", color: "#84889F" },
  colItemTxtActive: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
