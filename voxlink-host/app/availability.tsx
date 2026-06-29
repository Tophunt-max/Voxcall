// Availability Schedule screen — lets a host set the daily time window during
// which they're shown as available, plus their timezone. Replaces the old
// "Coming soon" stub in Settings.
//
// Persists to the hosts row via PATCH /api/host/schedule
// (available_from / available_to / timezone — see api-server migration 0039).
// Times are stored as 24-hour "HH:MM" strings; "Always available" clears both
// times (sends null) so the host is never gated by a window.
//
// Built with a self-contained time/timezone picker (BottomSheet of presets) so
// it works identically on web (the app deploys to Cloudflare Pages) and native
// — no dependency on the platform date/time dialog.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, Switch,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import BottomSheet from "@/components/BottomSheet";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

// 48 half-hour slots: "00:00", "00:30", … "23:30".
const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

// Common timezones — kept short and relevant. Falls back to showing whatever
// the server returned even if it isn't in this list.
const TIMEZONES: string[] = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

// "14:30" → "2:30 PM". Defensive: returns the raw value if it's not HH:MM.
function formatTime(hhmm?: string | null): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return "";
  const [hStr, m] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

export default function AvailabilityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [alwaysAvailable, setAlwaysAvailable] = useState(true);
  const [fromTime, setFromTime] = useState<string>("09:00");
  const [toTime, setToTime] = useState<string>("21:00");
  const [timezone, setTimezone] = useState<string>("Asia/Kolkata");

  // Which picker sheet is open.
  const [picker, setPicker] = useState<null | "from" | "to" | "tz">(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me: any = await API.getHostMe();
        if (cancelled) return;
        const from = (me?.available_from as string) || "";
        const to = (me?.available_to as string) || "";
        if (from && to) {
          setAlwaysAvailable(false);
          setFromTime(from);
          setToTime(to);
        } else {
          setAlwaysAvailable(true);
        }
        if (me?.timezone) setTimezone(me.timezone);
      } catch (e) {
        console.warn("[Availability] getHostMe failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Overnight windows (e.g. 22:00 → 06:00) are valid, so we only block the
  // case where both ends are identical (a zero-length window).
  const sameTime = !alwaysAvailable && fromTime === toTime;

  const summary = useMemo(() => {
    if (alwaysAvailable) return "Available 24/7";
    return `${formatTime(fromTime)} – ${formatTime(toTime)}`;
  }, [alwaysAvailable, fromTime, toTime]);

  const handleSave = useCallback(async () => {
    if (sameTime) {
      showErrorToast("Start and end time can't be the same.", "Invalid Window");
      return;
    }
    setSaving(true);
    try {
      await API.setHostSchedule({
        available_from: alwaysAvailable ? null : fromTime,
        available_to: alwaysAvailable ? null : toTime,
        timezone,
      });
      showSuccessToast("Availability schedule saved.", "Saved");
      router.back();
    } catch (e: any) {
      const msg = e?.message || "";
      if (/not yet available|503/i.test(msg)) {
        showErrorToast("This feature isn't enabled on the server yet. Please try again later.", "Unavailable");
      } else {
        showErrorToast(msg || "Failed to save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }, [alwaysAvailable, fromTime, toTime, timezone, sameTime]);

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={[styles.backBtn, { backgroundColor: colors.surface }]}>
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIconImg} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Availability Schedule</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          Set the hours you're usually available. Callers see this on your profile. It's a display hint — it doesn't force you offline.
        </Text>

        {/* Always available toggle */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.toggleRow}>
            <View style={[styles.rowIcon, { backgroundColor: colors.surface }]}>
              <Image source={require("@/assets/icons/ic_calendar.png")} style={styles.rowIconImg} tintColor={colors.primary} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Always Available (24/7)</Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>No fixed hours — available any time</Text>
            </View>
            <Switch
              value={alwaysAvailable}
              onValueChange={setAlwaysAvailable}
              trackColor={{ false: colors.border, true: "#0BAF23" }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Time window — only when not always available */}
        {!alwaysAvailable && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Available Hours</Text>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <TouchableOpacity style={[styles.pickRow, { borderBottomColor: colors.border }]} onPress={() => setPicker("from")} activeOpacity={0.75}>
                <Text style={[styles.pickLabel, { color: colors.text }]}>Available From</Text>
                <Text style={[styles.pickValue, { color: colors.primary }]}>{formatTime(fromTime)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickRow} onPress={() => setPicker("to")} activeOpacity={0.75}>
                <Text style={[styles.pickLabel, { color: colors.text }]}>Available To</Text>
                <Text style={[styles.pickValue, { color: colors.primary }]}>{formatTime(toTime)}</Text>
              </TouchableOpacity>
            </View>
            {sameTime && (
              <Text style={[styles.warn, { color: colors.destructive }]}>Start and end time can't be the same.</Text>
            )}
            {!sameTime && (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                {fromTime > toTime ? "Overnight window — spans past midnight." : ""}
              </Text>
            )}
          </>
        )}

        {/* Timezone */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Timezone</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <TouchableOpacity style={styles.pickRow} onPress={() => setPicker("tz")} activeOpacity={0.75}>
            <Text style={[styles.pickLabel, { color: colors.text }]}>Timezone</Text>
            <Text style={[styles.pickValue, { color: colors.primary }]}>{timezone}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.coinGoldBg }]}>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Callers will see</Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>{summary}</Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: saving ? colors.mutedForeground : colors.primary }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Schedule</Text>}
        </TouchableOpacity>
      </View>

      {/* Time picker sheet */}
      <BottomSheet
        visible={picker === "from" || picker === "to"}
        onClose={() => setPicker(null)}
        title={picker === "from" ? "Available From" : "Available To"}
      >
        <View style={styles.optionWrap}>
          {TIME_SLOTS.map((slot) => {
            const active = (picker === "from" ? fromTime : toTime) === slot;
            return (
              <TouchableOpacity
                key={slot}
                style={[styles.optionChip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface }]}
                onPress={() => {
                  if (picker === "from") setFromTime(slot);
                  else setToTime(slot);
                  setPicker(null);
                }}
              >
                <Text style={[styles.optionText, { color: active ? "#fff" : colors.text }]}>{formatTime(slot)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomSheet>

      {/* Timezone picker sheet */}
      <BottomSheet visible={picker === "tz"} onClose={() => setPicker(null)} title="Select Timezone">
        <View style={{ gap: 4 }}>
          {(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map((tz) => {
            const active = tz === timezone;
            return (
              <TouchableOpacity
                key={tz}
                style={[styles.tzRow, { borderBottomColor: colors.border }]}
                onPress={() => { setTimezone(tz); setPicker(null); }}
              >
                <Text style={[styles.tzText, { color: active ? colors.primary : colors.text, fontFamily: active ? "Poppins_600SemiBold" : "Poppins_400Regular" }]}>{tz}</Text>
                {active && (
                  <Image source={require("@/assets/icons/ic_check.png")} style={styles.tzCheck} tintColor={colors.primary} resizeMode="contain" />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomSheet>
    </View>
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
  sectionLabel: {
    fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase",
    letterSpacing: 0.5, marginHorizontal: 16, marginTop: 20, marginBottom: 6,
  },
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 12, overflow: "hidden" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowIconImg: { width: 18, height: 18 },
  rowLabel: { fontSize: 14, fontFamily: "Poppins_500Medium" },
  rowSub: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  pickRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1,
  },
  pickLabel: { fontSize: 14, fontFamily: "Poppins_500Medium" },
  pickValue: { fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  warn: { fontSize: 12, fontFamily: "Poppins_500Medium", marginHorizontal: 16, marginTop: 6 },
  hint: { fontSize: 12, fontFamily: "Poppins_400Regular", marginHorizontal: 16, marginTop: 6 },
  summaryCard: { marginHorizontal: 16, marginTop: 24, borderRadius: 14, padding: 16, gap: 4 },
  summaryLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  summaryValue: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1,
  },
  saveBtn: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 },
  optionChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },
  optionText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  tzRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  tzText: { fontSize: 15 },
  tzCheck: { width: 16, height: 16 },
});
