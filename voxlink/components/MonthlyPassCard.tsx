import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";
import { FreeMinutesCardIcon, RandomCardIcon } from "@/components/MinuteCardIcons";

// ─────────────────────────────────────────────────────────────────────────────
// MonthlyPassCard — vertical two-track tier ladder.
// ─────────────────────────────────────────────────────────────────────────────
// A battle-pass style progression rendered as a ladder:
//     [ Common (free) ]   [ points node ]   [ Monthly Pass (VIP) ]
// A central progress rail connects the point thresholds. Common rewards are
// free for everyone; the Monthly Pass (Premium) column is a VIP-only perk —
// locked 🔒 for non-VIP users. Tapping a locked VIP reward opens a "Go VIP"
// popup. Original VoxCall styling (own design, not a visual copy).

type PassData = Awaited<ReturnType<typeof API.getPass>>;
type PassTier = NonNullable<PassData["tiers"]>[number];

const BANNER_BG = ["#7C3AED", "#DB2777"] as const;
const COMMON_ACCENT = ["#A78BFA", "#8B5CF6"] as const;
const VIP_ACCENT = ["#FBBF24", "#F97316"] as const;
const NODE_REACHED = "#7C3AED";

function formatDaysClock(sec: number): string {
  if (sec <= 0) return "0d 00:00:00";
  const days = Math.floor(sec / 86400);
  const rest = sec % 86400;
  const h = Math.floor(rest / 3600);
  const m = Math.floor((rest % 3600) / 60);
  const s = Math.floor(rest % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function MonthlyPassCard({ onChanged }: { onChanged?: () => void }) {
  const colors = useColors();
  const { updateCoins } = useAuth();

  const [data, setData] = useState<PassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [vipModal, setVipModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await API.getPass();
      setData(res);
      setServerOffsetMs(Date.now() - res.server_time * 1000);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Math.floor((Date.now() - serverOffsetMs) / 1000);

  const monthEndSec = data ? Math.max(0, data.month_end - now) : 0;
  const points = data?.points ?? 0;
  const maxPoints = data?.max_points ?? 0;
  const progressPct = maxPoints > 0 ? Math.min(100, Math.round((points / maxPoints) * 100)) : 0;
  const tiers: PassTier[] = useMemo(() => data?.tiers ?? [], [data]);
  // Only show tiers that actually grant a reward on at least one track — drops
  // the empty rows (0-minute tiers) that showed up as big blank gaps.
  const visibleTiers = useMemo(
    () => tiers.filter(
      (t) => (t.free_minutes + t.free_random_minutes) > 0 || (t.premium_minutes + t.premium_random_minutes) > 0,
    ),
    [tiers],
  );
  const premiumUnlocked = !!data?.premium_unlocked;

  const claim = useCallback(
    async (tier: PassTier, track: "common" | "premium") => {
      const key = `${tier.level}:${track}`;
      if (busy) return;
      setBusy(key);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      try {
        const res = await API.claimPass(tier.level, track);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        const parts: string[] = [];
        if (res.host_minutes > 0) parts.push(`${res.host_minutes} host min`);
        if (res.random_minutes > 0) parts.push(`${res.random_minutes} random min`);
        showSuccessToast(`+${parts.join(" + ")} 🎉`, `${tier.label} claimed`);
        await load();
        onChanged?.();
      } catch (e: any) {
        showErrorToast(e?.message ?? "Could not claim reward");
      } finally {
        setBusy(null);
      }
    },
    [busy, updateCoins, load, onChanged],
  );

  if (loading) {
    return (
      <View style={[styles.loadingWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ActivityIndicator color={BANNER_BG[0]} />
      </View>
    );
  }
  if (!data || !data.enabled) return null;

  return (
    <View style={styles.wrap}>
      {/* ── Banner: countdown + points ─────────────────────────────── */}
      <LinearGradient colors={BANNER_BG as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <View style={styles.bannerGlow} />
        <View style={styles.bannerGlow2} />
        <View style={styles.bannerRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.bannerTag}>
              <Text style={styles.bannerTagText}>SEASON REWARDS</Text>
            </View>
            <Text style={styles.bannerKicker}>Monthly End Countdown</Text>
            <Text style={styles.bannerCountdown}>{formatDaysClock(monthEndSec)}</Text>
            <View style={styles.pointsPill}>
              <Text style={styles.pointsStar}>⭐</Text>
              <Text style={styles.pointsText}>{points.toLocaleString()}</Text>
              <Text style={styles.pointsMax}>/ {maxPoints.toLocaleString()} pts</Text>
            </View>
          </View>
          <View style={styles.giftBadge}>
            <Text style={styles.giftEmoji}>🎁</Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
      </LinearGradient>

      {/* ── Column headers ─────────────────────────────────────────── */}
      <View style={styles.colHeaderRow}>
        <View style={[styles.colHeader, styles.colHeaderCommon]}>
          <Text style={styles.colHeaderCommonText}>🆓 Free User</Text>
        </View>
        <View style={styles.colHeaderCenter}>
          <Text style={styles.colHeaderStar}>⭐</Text>
        </View>
        <View style={[styles.colHeader, styles.colHeaderVip]}>
          <Text style={styles.colHeaderVipText}>👑 VIP User</Text>
        </View>
      </View>

      {/* ── Tier ladder ────────────────────────────────────────────── */}
      <View style={styles.ladder}>
        {visibleTiers.map((tier, idx) => (
          <View key={tier.level} style={styles.tierRow}>
            {/* Common (free) */}
            <View style={styles.trackCol}>
              <RewardBox
                minutes={tier.free_minutes}
                randomMinutes={tier.free_random_minutes}
                reached={tier.reached}
                claimed={tier.free_claimed}
                claimable={tier.free_claimable}
                locked={false}
                busy={busy === `${tier.level}:common`}
                accent={COMMON_ACCENT}
                onClaim={() => claim(tier, "common")}
              />
            </View>

            {/* Center rail + node */}
            <View style={styles.centerCol}>
              <View style={[styles.rail, idx === 0 && styles.railHidden, { top: 0, bottom: "50%" }]} />
              <View style={[styles.rail, idx === visibleTiers.length - 1 && styles.railHidden, { top: "50%", bottom: 0 }]} />
              <View style={[styles.node, tier.reached ? styles.nodeReached : { backgroundColor: colors.border }]}>
                <Text style={[styles.nodeText, { color: tier.reached ? "#fff" : colors.subText }]}>{tier.points}</Text>
              </View>
            </View>

            {/* Monthly Pass (VIP) */}
            <View style={styles.trackCol}>
              <RewardBox
                minutes={tier.premium_minutes}
                randomMinutes={tier.premium_random_minutes}
                reached={tier.reached}
                claimed={tier.premium_claimed}
                claimable={tier.premium_claimable}
                locked={!premiumUnlocked}
                vip
                busy={busy === `${tier.level}:premium`}
                accent={VIP_ACCENT}
                onClaim={() => claim(tier, "premium")}
                onLockedPress={() => setVipModal(true)}
              />
            </View>
          </View>
        ))}
      </View>

      {/* ── VIP purchase popup (shown when a free user taps a locked reward) ── */}
      <Modal visible={vipModal} transparent animationType="fade" onRequestClose={() => setVipModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <LinearGradient colors={VIP_ACCENT as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.modalCrown}>
              <Text style={{ fontSize: 30 }}>👑</Text>
            </LinearGradient>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Unlock the Monthly Pass</Text>
            <Text style={[styles.modalBody, { color: colors.subText }]}>
              Premium rewards are exclusive to VIP members. Go VIP to unlock every Monthly Pass reward this month — plus call discounts, daily bonuses and more!
            </Text>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => { setVipModal(false); router.push("/user/vip" as any); }}
              style={styles.modalGoBtnWrap}
            >
              <LinearGradient colors={VIP_ACCENT as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.modalGoBtn}>
                <Text style={styles.modalGoBtnText}>👑 Become VIP</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setVipModal(false)} style={styles.modalClose}>
              <Text style={[styles.modalCloseText, { color: colors.subText }]}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Single reward cell (Common or VIP track) ──────────────────────────────────
function RewardBox({
  minutes,
  randomMinutes,
  reached,
  claimed,
  claimable,
  locked,
  vip,
  busy,
  accent,
  onClaim,
  onLockedPress,
}: {
  minutes: number;
  randomMinutes: number;
  reached: boolean;
  claimed: boolean;
  claimable: boolean;
  locked: boolean;
  vip?: boolean;
  busy?: boolean;
  accent: readonly [string, string];
  onClaim: () => void;
  onLockedPress?: () => void;
}) {
  const total = (minutes || 0) + (randomMinutes || 0);
  if (total <= 0) return <View style={styles.rewardEmpty} />;

  // Host-call free minutes → FreeMinutesCardIcon; random-call → RandomCardIcon.
  const Chips = ({ color }: { color: string }) => (
    <View style={styles.minRow}>
      {minutes > 0 ? (
        <View style={styles.minChipRow}>
          <FreeMinutesCardIcon size={30} />
          <Text style={[styles.minChip, { color }]}>{minutes}m</Text>
        </View>
      ) : null}
      {randomMinutes > 0 ? (
        <View style={styles.minChipRow}>
          <RandomCardIcon size={30} />
          <Text style={[styles.minChip, { color }]}>{randomMinutes}m</Text>
        </View>
      ) : null}
    </View>
  );

  // Already claimed → cards + a "Claimed" label underneath.
  if (claimed) {
    return (
      <View style={[styles.rewardBox, styles.rewardClaimed]}>
        <Chips color="#059669" />
        <Text style={styles.rewardStatusClaimed}>✓ Claimed</Text>
      </View>
    );
  }

  // VIP track locked for a non-VIP user → tap opens the Go-VIP popup.
  if (locked) {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onLockedPress} style={[styles.rewardBox, styles.rewardVipLocked]}>
        <View style={styles.lockChip}><Text style={styles.lockChipText}>🔒</Text></View>
        <Chips color="#B45309" />
        <Text style={styles.rewardStatusVip}>🔒 VIP only</Text>
      </TouchableOpacity>
    );
  }

  // Reached + unclaimed → claimable gradient button: cards on top, "Claim" below.
  if (claimable) {
    return (
      <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onClaim} style={styles.rewardBtnWrap}>
        <LinearGradient colors={accent as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.rewardBox, styles.rewardClaimable]}>
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <View style={styles.minRow}>
                {minutes > 0 ? (
                  <View style={styles.minChipRow}>
                    <FreeMinutesCardIcon size={30} />
                    <Text style={styles.rewardClaimNum}>{minutes}m</Text>
                  </View>
                ) : null}
                {randomMinutes > 0 ? (
                  <View style={styles.minChipRow}>
                    <RandomCardIcon size={30} />
                    <Text style={styles.rewardClaimNum}>{randomMinutes}m</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.rewardClaimLabel}>Claim</Text>
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  // Not reached yet → greyed preview. NO lock icon: the Free column is never
  // "locked" (free — just not earned yet); the VIP column only locks via the
  // `locked` branch above (non-VIP users).
  return (
    <View style={[styles.rewardBox, vip ? styles.rewardVipIdle : styles.rewardCommonIdle]}>
      <Chips color={vip ? "#B45309" : "#6D28D9"} />
    </View>
  );
}

const CELL_H = 82;

const styles = StyleSheet.create({
  loadingWrap: { height: 90, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  wrap: { borderRadius: 20, overflow: "hidden" },

  // Banner
  banner: { padding: 18, borderRadius: 20, overflow: "hidden" },
  bannerGlow: { position: "absolute", top: -34, right: -24, width: 130, height: 130, borderRadius: 65, backgroundColor: "rgba(255,255,255,0.13)" },
  bannerGlow2: { position: "absolute", bottom: -40, left: -20, width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(255,255,255,0.08)" },
  bannerRow: { flexDirection: "row", alignItems: "center" },
  bannerTag: { alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.22)", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, marginBottom: 7 },
  bannerTagText: { color: "#FCD34D", fontSize: 9.5, fontFamily: "Poppins_700Bold", letterSpacing: 1 },
  bannerKicker: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  bannerCountdown: { color: "#fff", fontSize: 24, fontFamily: "Poppins_700Bold", marginTop: 1, letterSpacing: 0.5 },
  giftBadge: { width: 66, height: 66, borderRadius: 33, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", marginLeft: 8 },
  giftEmoji: { fontSize: 38 },
  pointsPill: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.2)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, marginTop: 12 },
  pointsStar: { fontSize: 14 },
  pointsText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_700Bold" },
  pointsMax: { color: "rgba(255,255,255,0.8)", fontSize: 11.5, fontFamily: "Poppins_500Medium" },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.22)", overflow: "hidden", marginTop: 10 },
  progressFill: { height: "100%", backgroundColor: "#FCD34D", borderRadius: 4 },

  // Column headers
  colHeaderRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 14, paddingBottom: 6, gap: 8 },
  colHeader: { flex: 1, paddingVertical: 8, borderRadius: 12, alignItems: "center" },
  colHeaderCommon: { backgroundColor: "rgba(139,92,246,0.14)" },
  colHeaderCommonText: { color: "#7C3AED", fontSize: 13, fontFamily: "Poppins_700Bold" },
  colHeaderCenter: { width: 44, alignItems: "center" },
  colHeaderStar: { fontSize: 18 },
  colHeaderVip: { backgroundColor: "rgba(249,115,22,0.14)" },
  colHeaderVipText: { color: "#EA580C", fontSize: 12.5, fontFamily: "Poppins_700Bold" },

  // Ladder
  ladder: { paddingHorizontal: 12, paddingBottom: 14 },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: CELL_H },
  trackCol: { flex: 1 },
  centerCol: { width: 44, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  rail: { position: "absolute", width: 4, backgroundColor: "rgba(124,58,237,0.25)", left: 20 },
  railHidden: { opacity: 0 },
  node: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", zIndex: 2, borderWidth: 2, borderColor: "#fff" },
  nodeReached: { backgroundColor: NODE_REACHED },
  nodeText: { fontSize: 11, fontFamily: "Poppins_700Bold" },

  // Reward cells
  rewardEmpty: { height: CELL_H - 12 },
  rewardBtnWrap: { borderRadius: 14, overflow: "hidden" },
  rewardBox: { minHeight: CELL_H - 12, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 5, paddingVertical: 8, paddingHorizontal: 6 },
  rewardCommonIdle: { backgroundColor: "rgba(139,92,246,0.10)" },
  rewardVipIdle: { backgroundColor: "rgba(249,115,22,0.12)" },
  rewardVipLocked: { backgroundColor: "rgba(249,115,22,0.12)" },
  rewardClaimable: {},
  rewardClaimed: { backgroundColor: "rgba(16,185,129,0.14)" },
  rewardStatusClaimed: { color: "#059669", fontSize: 11.5, fontFamily: "Poppins_700Bold" },
  rewardStatusVip: { color: "#B45309", fontSize: 11.5, fontFamily: "Poppins_700Bold" },
  rewardClaimLabel: { color: "#fff", fontSize: 14, fontFamily: "Poppins_700Bold", letterSpacing: 0.3 },
  rewardClaimNum: { color: "#fff", fontSize: 13, fontFamily: "Poppins_700Bold" },
  minRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" },
  minChipRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  minChip: { fontSize: 13, fontFamily: "Poppins_700Bold" },
  lockChip: { position: "absolute", top: 5, right: 7 },
  lockChipText: { fontSize: 13 },

  // VIP modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 28 },
  modalCard: { width: "100%", maxWidth: 340, borderRadius: 22, padding: 22, alignItems: "center", ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } }, android: { elevation: 10 }, web: { boxShadow: "0 10px 30px rgba(0,0,0,0.3)" } as any }) },
  modalCrown: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  modalTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", textAlign: "center" },
  modalBody: { fontSize: 13, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 19, marginTop: 8, marginBottom: 18 },
  modalGoBtnWrap: { width: "100%", borderRadius: 14, overflow: "hidden" },
  modalGoBtn: { height: 48, alignItems: "center", justifyContent: "center" },
  modalGoBtnText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_700Bold" },
  modalClose: { marginTop: 12, paddingVertical: 6 },
  modalCloseText: { fontSize: 13, fontFamily: "Poppins_600SemiBold" },
});
