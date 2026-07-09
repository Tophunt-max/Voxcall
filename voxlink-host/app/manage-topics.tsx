// Manage Topics screen — a host picks the talk topics / specialties they want
// to appear under, so they surface for users browsing by topic. Backed by
// PATCH /api/host/me (specialties: string[], max 10). Topic options come from
// the public /api/talk-topics list, and the host's current picks from
// /api/host/me.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, TextInput, Platform, KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLanguage } from "@/context/LanguageContext";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import { WEB_INPUT_RESET } from "@workspace/shared-ui/utils";

const MAX_TOPICS = 10;

interface Topic { id: string; name: string; icon?: string; }

export default function ManageTopicsScreen() {
  const colors = useColors();
  const { t: tr } = useLanguage();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  // Selected topic names (specialties are stored as names, not ids).
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [topicList, me] = await Promise.all([
          API.getTalkTopics().catch(() => []),
          API.getHostMe().catch(() => ({} as any)),
        ]);
        if (cancelled) return;
        const list: Topic[] = Array.isArray(topicList)
          ? topicList.map((t: any) => ({ id: String(t.id), name: String(t.name ?? ""), icon: t.icon }))
              .filter((t) => t.name)
          : [];
        setTopics(list);
        const mine: string[] = Array.isArray((me as any)?.specialties) ? (me as any).specialties : [];
        setSelected(mine.map((s) => String(s)).slice(0, MAX_TOPICS));
      } catch (e) {
        console.warn("[ManageTopics] load failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Merge predefined topics with any custom specialties the host already had,
  // so previously-saved custom names still render as removable chips.
  const allChips = useMemo(() => {
    const names = new Set(topics.map((t) => t.name.toLowerCase()));
    const extras = selected
      .filter((s) => !names.has(s.toLowerCase()))
      .map((s) => ({ id: `custom:${s}`, name: s, icon: "✏️" }));
    return [...topics, ...extras];
  }, [topics, selected]);

  const isSelected = useCallback(
    (name: string) => selected.some((s) => s.toLowerCase() === name.toLowerCase()),
    [selected]
  );

  const toggle = useCallback((name: string) => {
    setSelected((prev) => {
      const exists = prev.some((s) => s.toLowerCase() === name.toLowerCase());
      if (exists) return prev.filter((s) => s.toLowerCase() !== name.toLowerCase());
      if (prev.length >= MAX_TOPICS) {
        showErrorToast(`${tr.manageTopicsScreen.maxPrefix}${MAX_TOPICS}${tr.manageTopicsScreen.maxSuffix}`);
        return prev;
      }
      return [...prev, name];
    });
  }, []);

  const addCustom = useCallback(() => {
    const name = custom.trim().slice(0, 50);
    if (!name) return;
    if (isSelected(name)) { setCustom(""); return; }
    if (selected.length >= MAX_TOPICS) {
      showErrorToast(`${tr.manageTopicsScreen.maxPrefix}${MAX_TOPICS}${tr.manageTopicsScreen.maxSuffix}`);
      return;
    }
    setSelected((prev) => [...prev, name]);
    setCustom("");
  }, [custom, isSelected, selected.length]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await API.updateHostProfile({ specialties: selected.slice(0, MAX_TOPICS) });
      showSuccessToast(tr.manageTopicsScreen.topicsSaved, tr.manageTopicsScreen.topicsSavedTitle);
      router.back();
    } catch (e: any) {
      showErrorToast(e?.message || tr.manageTopicsScreen.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [selected]);

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
        <Text style={[styles.title, { color: colors.text }]}>{tr.manageTopicsScreen.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          {tr.manageTopicsScreen.helpPrefix}{MAX_TOPICS}{tr.manageTopicsScreen.helpSuffix}
        </Text>

        <View style={styles.counterRow}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{tr.manageTopicsScreen.topics}</Text>
          <Text style={[styles.counter, { color: selected.length >= MAX_TOPICS ? "#E84855" : colors.mutedForeground }]}>
            {selected.length}/{MAX_TOPICS}
          </Text>
        </View>

        <View style={styles.chipWrap}>
          {allChips.map((t) => {
            const sel = isSelected(t.name);
            return (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.chip,
                  {
                    backgroundColor: sel ? colors.primary : colors.card,
                    borderColor: sel ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => toggle(t.name)}
                activeOpacity={0.8}
              >
                {t.icon ? <Text style={styles.chipIcon}>{t.icon}</Text> : null}
                <Text style={[styles.chipText, { color: sel ? "#fff" : colors.text }]}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
          {allChips.length === 0 && (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {tr.manageTopicsScreen.noTopics}
            </Text>
          )}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>{tr.manageTopicsScreen.addYourOwn}</Text>
        <View style={[styles.customRow, { marginHorizontal: 16 }]}>
          <TextInput
            style={[styles.customInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            placeholder={tr.manageTopicsScreen.customPlaceholder}
            placeholderTextColor={colors.mutedForeground}
            value={custom}
            onChangeText={setCustom}
            onSubmitEditing={addCustom}
            returnKeyType="done"
            maxLength={50}
          />
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary, opacity: custom.trim() ? 1 : 0.5 }]}
            onPress={addCustom}
            disabled={!custom.trim()}
            activeOpacity={0.85}
          >
            <Text style={styles.addBtnText}>{tr.manageTopicsScreen.add}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: saving ? colors.mutedForeground : colors.primary }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{tr.manageTopicsScreen.saveTopics}</Text>}
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
  counterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 16, marginTop: 18 },
  sectionLabel: { fontSize: 11, fontFamily: "Poppins_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  counter: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, marginTop: 10 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22, borderWidth: 1,
  },
  chipIcon: { fontSize: 14 },
  chipText: { fontSize: 13, fontFamily: "Poppins_500Medium" },
  emptyText: { fontSize: 13, fontFamily: "Poppins_400Regular", marginHorizontal: 0 },
  customRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  customInput: {
    flex: 1, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 14, fontFamily: "Poppins_400Regular",
    ...(WEB_INPUT_RESET as any),
  },
  addBtn: { paddingHorizontal: 20, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1,
  },
  saveBtn: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
