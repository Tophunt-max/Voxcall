// Call Rates screen — a host sets their own per-minute price (in coins) for
// audio and video calls. Backed by PATCH /api/host/me, which the backend
// already supports (audio_coins_per_minute / video_coins_per_minute, capped
// 1–500). Previously this was hidden behind a "contact host support" note in
// Edit Profile even though the API allowed it.

import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, KeyboardAvoidingView, Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

const MIN_RATE = 1;
const ABS_MAX_RATE = 500;
/**
 * Headroom (coins/min) the host may charge ABOVE the admin-set per-level cap.
 * Mirrors HOST_RATE_BONUS in api-server/src/lib/levels.ts.
 */
const HOST_RATE_BONUS = 5;

// Clamp + sanitize a raw text value into a valid integer rate string.
function clamp(n: number, max: number = ABS_MAX_RATE): number {
  if (isNaN(n)) return MIN_RATE;
  return Math.min(max, Math.max(MIN_RATE, Math.round(n)));
}

interface RateRowProps {
  label: string;
  sublabel: string;
  emoji: string;
  value: string;
  onChange: (v: string) => void;
  onStep: (delta: number) => void;
  colors: ReturnType<typeof useColors>;
}

function RateRow({ label, sublabel, emoji, value, onChange, onStep, colors }: RateRowProps) {
  return (
    <View style={[styles.rateCard, { backgroundColor: colors.card }]}>
      <View style={styles.rateHead}>
        <Text style={styles.rateEmoji}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rateLabel, { color: colors.text }]}>{label}</Text>
          <Text style={[styles.rateSub, { color: colors.mutedForeground }]}>{sublabel}</Text>
        </View>
      </View>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={() => onStep(-1)}
          activeOpacity={0.7}
        >
          <Text style={[styles.stepBtnText, { color: colors.text }]}>−</Text>
        </TouchableOpacity>

        <View style={[styles.valueBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <TextInput
            style={[styles.valueInput, { color: colors.text }]}
            value={value}
            onChangeText={onChange}
            keyboardType="number-pad"
            maxLength={3}
            textAlign="center"
          />
          <Text style={[styles.valueUnit, { color: colors.mutedForeground }]}>coins / min</Text>
        </View>

        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={() => onStep(1)}
          activeOpacity={0.7}
        >
          <Text style={[styles.stepBtnText, { color: colors.text }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function CallRatesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [audio, setAudio] = useState("5");
  const [video, setVideo] = useState("10");
  const [levelLabel, setLevelLabel] = useState<string | null>(null);
  // Per-channel effective ceilings = admin level cap + HOST_RATE_BONUS,
  // clamped to ABS_MAX_RATE. Default to the global cap until the level
  // endpoint resolves.
  const [maxAudio, setMaxAudio] = useState(ABS_MAX_RATE);
  const [maxVideo, setMaxVideo] = useState(ABS_MAX_RATE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, level] = await Promise.all([
          API.getHostMe() as Promise<any>,
          // Level perks carry the admin-set per-channel caps. We tolerate this
          // call failing — the host can still edit, just without a tighter cap.
          API.getHostLevel().catch(() => null) as Promise<any>,
        ]);
        if (cancelled) return;
        const a = Number(me?.audio_coins_per_minute ?? me?.coins_per_minute ?? 5);
        const v = Number(me?.video_coins_per_minute ?? (Number(me?.coins_per_minute ?? 5) + 5));

        // Resolve per-channel caps: prefer the new audio/video fields and fall
        // back to legacy `max_rate` for older configs.
        const perks = level?.perks ?? level?.current?.perks;
        const adminAudio = Number(perks?.max_audio_rate ?? perks?.max_rate);
        const adminVideo = Number(perks?.max_video_rate ?? perks?.max_rate);
        const effAudio = isFinite(adminAudio) && adminAudio > 0
          ? Math.min(ABS_MAX_RATE, adminAudio + HOST_RATE_BONUS)
          : ABS_MAX_RATE;
        const effVideo = isFinite(adminVideo) && adminVideo > 0
          ? Math.min(ABS_MAX_RATE, adminVideo + HOST_RATE_BONUS)
          : ABS_MAX_RATE;
        setMaxAudio(effAudio);
        setMaxVideo(effVideo);

        setAudio(String(clamp(a, effAudio)));
        setVideo(String(clamp(v, effVideo)));
        // /api/host/me returns `level` (number) and optionally `level_info`.
        const li = me?.level_info;
        if (li?.name) setLevelLabel(`${li.badge ?? "⭐"} ${li.name} host`);
        else if (me?.level) setLevelLabel(`Level ${me.level} host`);
      } catch (e) {
        console.warn("[CallRates] getHostMe failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const step = useCallback((which: "audio" | "video", delta: number) => {
    const setter = which === "audio" ? setAudio : setVideo;
    const cap = which === "audio" ? maxAudio : maxVideo;
    setter((prev) => String(clamp((parseInt(prev, 10) || 0) + delta, cap)));
  }, [maxAudio, maxVideo]);

  // Allow free typing (incl. empty while editing); only sanitize digits here.
  const onChangeRate = useCallback((which: "audio" | "video", raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 3);
    (which === "audio" ? setAudio : setVideo)(digits);
  }, []);

  const handleSave = useCallback(async () => {
    const a = clamp(parseInt(audio, 10), maxAudio);
    const v = clamp(parseInt(video, 10), maxVideo);
    setSaving(true);
    try {
      await API.updateHostProfile({
        audio_coins_per_minute: a,
        video_coins_per_minute: v,
        // Keep the legacy single-rate column in sync (used as a fallback in
        // billing) so older code paths price audio calls correctly.
        coins_per_minute: a,
      });
      // Reflect the clamped values back into the inputs.
      setAudio(String(a));
      setVideo(String(v));
      showSuccessToast("Your call rates have been updated.", "Rates Saved");
      router.back();
    } catch (e: any) {
      showErrorToast(e?.message || "Failed to save rates. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [audio, video, maxAudio, maxVideo]);

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIconImg} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Call Rates</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          Set how many coins users pay you per minute. Video calls usually earn
          more than audio. At your current level you can charge up to{" "}
          <Text style={{ fontFamily: "Poppins_600SemiBold", color: colors.text }}>
            {maxAudio} coins/min for audio
          </Text>{" "}
          and{" "}
          <Text style={{ fontFamily: "Poppins_600SemiBold", color: colors.text }}>
            {maxVideo} coins/min for video
          </Text>{" "}
          (admin level cap +{HOST_RATE_BONUS} bonus). Reach higher levels to raise these caps.
        </Text>

        {levelLabel ? (
          <View style={[styles.levelChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.levelText, { color: colors.text }]}>{levelLabel}</Text>
          </View>
        ) : null}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Your Rates</Text>

        <RateRow
          label="Audio Call"
          sublabel="Per minute for voice calls"
          emoji="🎙️"
          value={audio}
          onChange={(t) => onChangeRate("audio", t)}
          onStep={(d) => step("audio", d)}
          colors={colors}
        />

        <RateRow
          label="Video Call"
          sublabel="Per minute for video calls"
          emoji="📹"
          value={video}
          onChange={(t) => onChangeRate("video", t)}
          onStep={(d) => step("video", d)}
          colors={colors}
        />

        <View style={[styles.estBox, { backgroundColor: colors.accentLight }]}>
          <Text style={[styles.estTitle, { color: colors.text }]}>Earnings estimate</Text>
          <Text style={[styles.estRow, { color: colors.text }]}>
            10-min audio call ≈ {clamp(parseInt(audio, 10) || 0, maxAudio) * 10} coins
          </Text>
          <Text style={[styles.estRow, { color: colors.text }]}>
            10-min video call ≈ {clamp(parseInt(video, 10) || 0, maxVideo) * 10} coins
          </Text>
          <Text style={[styles.estNote, { color: colors.mutedForeground }]}>
            Coins are added to your earnings after each completed call.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: saving ? colors.mutedForeground : colors.primary }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Rates</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIconImg: { width: 20, height: 20 },
  title: { fontSize: 17, fontFamily: "Poppins_600SemiBold" },
  helpText: { fontSize: 13, fontFamily: "Poppins_400Regular", marginHorizontal: 16, marginTop: 16, lineHeight: 19 },
  levelChip: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  levelEmoji: { fontSize: 14 },
  levelText: { fontSize: 12, fontFamily: "Poppins_500Medium" },
  sectionLabel: {
    fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase",
    letterSpacing: 0.5, marginHorizontal: 16, marginTop: 20, marginBottom: 8,
  },
  rateCard: { marginHorizontal: 16, borderRadius: 14, padding: 16, marginBottom: 12 },
  rateHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  rateEmoji: { fontSize: 24 },
  rateLabel: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  rateSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 1 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: {
    width: 48, height: 48, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  stepBtnText: { fontSize: 24, fontFamily: "Poppins_600SemiBold", lineHeight: 28 },
  valueBox: {
    flex: 1, height: 48, borderRadius: 12, borderWidth: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  valueInput: { fontSize: 18, fontFamily: "Poppins_700Bold", minWidth: 36, padding: 0 },
  valueUnit: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  estBox: { marginHorizontal: 16, marginTop: 8, borderRadius: 14, padding: 16, gap: 4 },
  estTitle: { fontSize: 14, fontFamily: "Poppins_700Bold", marginBottom: 4 },
  estRow: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  estNote: { fontSize: 11, fontFamily: "Poppins_400Regular", marginTop: 4, lineHeight: 16 },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1,
  },
  saveBtn: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
