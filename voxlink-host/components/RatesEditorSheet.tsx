// RatesEditorSheet — the host "coin edit system" surfaced inline on the
// dashboard. Lets a host adjust how many coins users pay per minute for audio
// and video calls without leaving the home screen. Saves via PATCH /api/host/me
// (API.updateHostProfile), keeping the legacy coins_per_minute column in sync.
//
// Rates are clamped to 1–500 (matching the backend cap in host.ts).

import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import BottomSheet from "@/components/BottomSheet";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import { WEB_INPUT_RESET } from "@workspace/shared-ui/utils";

const MIN_RATE = 1;
const ABS_MAX_RATE = 500;

function clamp(n: number, max: number = ABS_MAX_RATE): number {
  if (isNaN(n)) return MIN_RATE;
  return Math.min(max, Math.max(MIN_RATE, Math.round(n)));
}

interface RatesEditorSheetProps {
  visible: boolean;
  onClose: () => void;
  initialAudio: number;
  initialVideo: number;
  /**
   * Effective AUDIO cap (coins/min) — usually the host's level audio cap +5
   * bonus headroom from the admin config. Defaults to the global ceiling.
   */
  maxAudioRate?: number;
  /**
   * Effective VIDEO cap (coins/min) — usually the host's level video cap +5
   * bonus headroom from the admin config. Defaults to the global ceiling.
   */
  maxVideoRate?: number;
  /**
   * @deprecated Pass `maxAudioRate` and `maxVideoRate` instead. When provided
   * (and the channel-specific props are not), this single value is used for
   * BOTH channels — kept so callers using the old prop don't break.
   */
  maxRate?: number;
  /** Called with the saved (clamped) rates after a successful update. */
  onSaved?: (rates: { audio: number; video: number }) => void;
}

function RateStepper({
  emoji,
  label,
  sublabel,
  value,
  max,
  onChange,
  onStep,
  onCommit,
}: {
  emoji: string;
  label: string;
  sublabel: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  onStep: (delta: number) => void;
  onCommit: () => void;
}) {
  const colors = useColors();
  const over = (parseInt(value, 10) || 0) > max;
  return (
    <View style={[styles.rateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.rateHead}>
        <Text style={styles.rateEmoji}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rateLabel, { color: colors.text }]}>{label}</Text>
          <Text style={[styles.rateSub, { color: colors.mutedForeground }]}>{sublabel}</Text>
        </View>
      </View>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={() => onStep(-1)}
          activeOpacity={0.7}
        >
          <Text style={[styles.stepBtnText, { color: colors.text }]}>−</Text>
        </TouchableOpacity>
        <View style={[styles.valueBox, { borderColor: over ? "#E84855" : colors.border, backgroundColor: colors.card }]}>
          <TextInput
            style={[styles.valueInput, { color: colors.text }]}
            value={value}
            onChangeText={onChange}
            onEndEditing={onCommit}
            onBlur={onCommit}
            keyboardType="number-pad"
            maxLength={3}
            textAlign="center"
            underlineColorAndroid="transparent"
          />
          <Text style={[styles.valueUnit, { color: colors.mutedForeground }]}>coins / min</Text>
        </View>
        <TouchableOpacity
          style={[styles.stepBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={() => onStep(1)}
          activeOpacity={0.7}
        >
          <Text style={[styles.stepBtnText, { color: colors.text }]}>+</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.capHint, { color: over ? "#E84855" : colors.mutedForeground }]}>
        {over ? `Max ${max} coins/min at your level` : `Up to ${max} coins/min at your level`}
      </Text>
    </View>
  );
}

export default function RatesEditorSheet({
  visible,
  onClose,
  initialAudio,
  initialVideo,
  maxAudioRate,
  maxVideoRate,
  maxRate,
  onSaved,
}: RatesEditorSheetProps) {
  const colors = useColors();
  // Resolve effective channel caps. Prefer the new channel-specific props;
  // fall back to the legacy combined `maxRate` for older callers.
  const audioCap = Math.min(ABS_MAX_RATE, Math.max(MIN_RATE, maxAudioRate ?? maxRate ?? ABS_MAX_RATE));
  const videoCap = Math.min(ABS_MAX_RATE, Math.max(MIN_RATE, maxVideoRate ?? maxRate ?? ABS_MAX_RATE));
  const [audio, setAudio] = useState(String(clamp(initialAudio, audioCap)));
  const [video, setVideo] = useState(String(clamp(initialVideo, videoCap)));
  const [saving, setSaving] = useState(false);

  // Re-sync inputs whenever the sheet is (re)opened with new values.
  useEffect(() => {
    if (visible) {
      setAudio(String(clamp(initialAudio, audioCap)));
      setVideo(String(clamp(initialVideo, videoCap)));
    }
  }, [visible, initialAudio, initialVideo, audioCap, videoCap]);

  const step = useCallback((which: "audio" | "video", delta: number) => {
    const setter = which === "audio" ? setAudio : setVideo;
    const cap = which === "audio" ? audioCap : videoCap;
    setter((prev) => String(clamp((parseInt(prev, 10) || 0) + delta, cap)));
  }, [audioCap, videoCap]);

  const onChangeRate = useCallback((which: "audio" | "video", raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 3);
    (which === "audio" ? setAudio : setVideo)(digits);
  }, []);

  const handleSave = useCallback(async () => {
    const a = clamp(parseInt(audio, 10), audioCap);
    const v = clamp(parseInt(video, 10), videoCap);
    setSaving(true);
    try {
      await API.updateHostProfile({
        audio_coins_per_minute: a,
        video_coins_per_minute: v,
        // Keep the legacy single-rate column in sync (billing fallback).
        coins_per_minute: a,
      });
      showSuccessToast("Your call rates have been updated.", "Rates Saved");
      onSaved?.({ audio: a, video: v });
      onClose();
    } catch (e: any) {
      showErrorToast(e?.message || "Failed to save rates. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [audio, video, audioCap, videoCap, onSaved, onClose]);

  const audioNum = clamp(parseInt(audio, 10) || 0, audioCap);
  const videoNum = clamp(parseInt(video, 10) || 0, videoCap);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Edit Call Rates">
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <Text style={[styles.help, { color: colors.mutedForeground }]}>
          Set how many coins users pay you per minute. Video usually earns more
          than audio. At your current level you can charge up to{" "}
          <Text style={{ fontFamily: "Poppins_600SemiBold", color: colors.text }}>
            {audioCap} coins/min for audio
          </Text>{" "}
          and{" "}
          <Text style={{ fontFamily: "Poppins_600SemiBold", color: colors.text }}>
            {videoCap} coins/min for video
          </Text>{" "}
          (admin level cap +5 bonus). Reach higher levels to raise these caps.
        </Text>

        <RateStepper
          emoji="🎙️"
          label="Audio Call"
          sublabel="Per minute for voice calls"
          value={audio}
          max={audioCap}
          onChange={(t) => onChangeRate("audio", t)}
          onStep={(d) => step("audio", d)}
          onCommit={() => setAudio((prev) => String(clamp(parseInt(prev, 10) || 0, audioCap)))}
        />
        <RateStepper
          emoji="📹"
          label="Video Call"
          sublabel="Per minute for video calls"
          value={video}
          max={videoCap}
          onChange={(t) => onChangeRate("video", t)}
          onStep={(d) => step("video", d)}
          onCommit={() => setVideo((prev) => String(clamp(parseInt(prev, 10) || 0, videoCap)))}
        />

        <View style={[styles.estBox, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.estTitle, { color: colors.text }]}>Earnings estimate</Text>
          <Text style={[styles.estRow, { color: colors.text }]}>
            10-min audio call ≈ {audioNum * 10} coins
          </Text>
          <Text style={[styles.estRow, { color: colors.text }]}>
            10-min video call ≈ {videoNum * 10} coins
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: saving ? colors.mutedForeground : colors.primary }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Rates</Text>}
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 13, fontFamily: "Poppins_400Regular", lineHeight: 19 },
  rateCard: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 12 },
  rateHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  rateEmoji: { fontSize: 22 },
  rateLabel: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  rateSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 1 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepBtnText: { fontSize: 22, fontFamily: "Poppins_600SemiBold", lineHeight: 26 },
  valueBox: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  valueInput: { fontSize: 18, fontFamily: "Poppins_700Bold", minWidth: 36, padding: 0, ...(WEB_INPUT_RESET as any) },
  valueUnit: { fontSize: 12, fontFamily: "Poppins_400Regular" },
  capHint: { fontSize: 11, fontFamily: "Poppins_500Medium", marginTop: 4 },
  estBox: { borderRadius: 14, padding: 14, gap: 4 },
  estTitle: { fontSize: 14, fontFamily: "Poppins_700Bold", marginBottom: 2 },
  estRow: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  saveBtn: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
