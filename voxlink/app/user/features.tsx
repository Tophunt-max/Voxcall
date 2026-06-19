import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  FEATURE_STATUS_LABEL,
  FEATURE_STATUS_SUMMARY,
  GROWTH_FEATURES,
  GrowthFeature,
  GrowthFeaturePhase,
  PHASE_TITLES,
} from "@/constants/growthFeatures";
import { showErrorToast } from "@/components/Toast";

const PHASES: GrowthFeaturePhase[] = [1, 2, 3];

export default function GrowthFeaturesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activePhase, setActivePhase] = useState<GrowthFeaturePhase | "all">("all");

  const visibleFeatures = useMemo(() => {
    if (activePhase === "all") return GROWTH_FEATURES;
    return GROWTH_FEATURES.filter((feature) => feature.phase === activePhase);
  }, [activePhase]);

  const openFeature = (feature: GrowthFeature) => {
    if (feature.route) {
      router.push(feature.route as any);
      return;
    }
    showErrorToast(`${feature.title} needs backend/admin work before it can open.`);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}> 
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}> 
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface }]}> 
          <Image source={require("@/assets/icons/ic_back.png")} style={styles.backIcon} tintColor={colors.text} resizeMode="contain" />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>Phase 1, 2 & 3 Features</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>All 20 requested calling-system upgrades in one place</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}> 
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <SummaryPill label="Completed" value={FEATURE_STATUS_SUMMARY.completed} color="#078A35" />
          <SummaryPill label="Ready" value={FEATURE_STATUS_SUMMARY.ready} color="#A86B00" />
          <SummaryPill label="Backlog" value={FEATURE_STATUS_SUMMARY.planned} color="#7B35A8" />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.phaseTabs}> 
          <PhaseTab label="All" active={activePhase === "all"} onPress={() => setActivePhase("all")} />
          {PHASES.map((phase) => (
            <PhaseTab key={phase} label={`Phase ${phase}`} active={activePhase === phase} onPress={() => setActivePhase(phase)} />
          ))}
        </ScrollView>

        {PHASES.map((phase) => {
          const phaseFeatures = visibleFeatures.filter((feature) => feature.phase === phase);
          if (phaseFeatures.length === 0) return null;
          return (
            <View key={phase} style={styles.phaseBlock}>
              <Text style={[styles.phaseTitle, { color: colors.text }]}>{PHASE_TITLES[phase]}</Text>
              {phaseFeatures.map((feature) => (
                <TouchableOpacity
                  key={feature.id}
                  activeOpacity={0.86}
                  onPress={() => openFeature(feature)}
                  style={[styles.featureCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.cardTopRow}>
                    <View style={[styles.statusPill, statusStyle(feature.status)]}>
                      <Text style={styles.statusText}>{FEATURE_STATUS_LABEL[feature.status]}</Text>
                    </View>
                    <Text style={[styles.audience, { color: colors.mutedForeground }]}>{feature.audience}</Text>
                  </View>
                  <Text style={[styles.featureTitle, { color: colors.text }]}>{feature.title}</Text>
                  <Text style={[styles.featureDescription, { color: colors.mutedForeground }]}>{feature.description}</Text>
                  <View style={[styles.deliverableBox, { backgroundColor: colors.surface }]}> 
                    <Text style={[styles.deliverableLabel, { color: colors.primary }]}>Deliverable</Text>
                    <Text style={[styles.deliverableText, { color: colors.text }]}>{feature.deliverable}</Text>
                  </View>
                  <Text style={[styles.cta, { color: colors.primary }]}>{feature.cta}</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.summaryPill}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function PhaseTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.phaseTab, active && styles.phaseTabActive]}>
      <Text style={[styles.phaseTabText, active && styles.phaseTabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function statusStyle(status: GrowthFeature["status"]) {
  if (status === "completed") return { backgroundColor: "#E8F8EE" };
  if (status === "ready") return { backgroundColor: "#FFF4D8" };
  return { backgroundColor: "#F0E4F8" };
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 22, height: 22 },
  headerCopy: { flex: 1 },
  title: { fontSize: 18, fontFamily: "Poppins_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Poppins_400Regular", marginTop: 2 },
  content: { padding: 16, gap: 18 },
  summaryCard: { flexDirection: "row", borderWidth: 1, borderRadius: 18, padding: 14, justifyContent: "space-between" },
  summaryPill: { alignItems: "center", flex: 1 },
  summaryValue: { fontSize: 24, fontFamily: "Poppins_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Poppins_600SemiBold", color: "#7B7284", marginTop: 2 },
  phaseTabs: { gap: 8, paddingRight: 16 },
  phaseTab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#F0E4F8" },
  phaseTabActive: { backgroundColor: "#A00EE7" },
  phaseTabText: { fontSize: 12, fontFamily: "Poppins_700Bold", color: "#A00EE7" },
  phaseTabTextActive: { color: "#fff" },
  phaseBlock: { gap: 12 },
  phaseTitle: { fontSize: 16, fontFamily: "Poppins_700Bold" },
  featureCard: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 9 },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 10, fontFamily: "Poppins_700Bold", color: "#6A00B8" },
  audience: { fontSize: 10, fontFamily: "Poppins_600SemiBold", textTransform: "capitalize" },
  featureTitle: { fontSize: 15, fontFamily: "Poppins_700Bold" },
  featureDescription: { fontSize: 12, fontFamily: "Poppins_400Regular", lineHeight: 18 },
  deliverableBox: { borderRadius: 12, padding: 10, gap: 3 },
  deliverableLabel: { fontSize: 10, fontFamily: "Poppins_700Bold", textTransform: "uppercase" },
  deliverableText: { fontSize: 11, fontFamily: "Poppins_400Regular", lineHeight: 16 },
  cta: { fontSize: 12, fontFamily: "Poppins_700Bold" },
});
