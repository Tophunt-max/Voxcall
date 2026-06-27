// useDailyStreak — single-source-of-truth hook for the Daily Streak feature.
//
// On mount (and whenever the authenticated user changes) this hook calls
// GET /api/user/streak once. The response tells us:
//   - whether the user can claim right now (`can_claim_now`)
//   - what they'll earn (`next_reward`)
//   - the full schedule + milestones for the UI card
//
// The Daily Reward modal in `_layout.tsx` mounts this hook, then auto-pops
// itself when `can_claim_now` flips to true. Tapping Claim calls
// POST /api/user/streak/claim and updates local state + the AuthContext
// coin balance (so the wallet header refreshes immediately without a
// separate /me round-trip).
//
// All API calls are best-effort — a network error logs to console and the
// modal stays hidden. The streak feature is engagement gravy, not
// load-bearing, so it must never block the app.

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { API } from "@/services/api";
import { useAuth } from "@/context/AuthContext";

export interface DailyStreakStatus {
  streak_days: number;
  last_claim_at: number;
  can_claim_now: boolean;
  next_claim_at: number;
  next_reward: number;
  next_reward_base: number;
  next_reward_milestone: number;
  schedule: number[];
  milestones: Record<string, number>;
  enabled: boolean;
  // Variable "lucky wheel" mode (Priority 4) — optional so older backends omit.
  variable_enabled?: boolean;
  variable_table?: Array<{ m: number; p: number }>;
  // Engagement v2 — optional so older backends degrade gracefully.
  seconds_until_reset?: number;
  at_risk?: boolean;
  streak_max?: number;
  freeze_enabled?: boolean;
  freezes_available?: number;
  can_repair?: boolean;
  repair_cost_coins?: number;
  chest_enabled?: boolean;
  chest_threshold?: number;
  chest_reward?: number;
  claims_this_month?: number;
  chest_claimed_this_month?: boolean;
}

export interface DailyStreakClaimResult {
  success: boolean;
  claimed: boolean;
  code: string;
  streak_days: number;
  reward: number;
  base_reward: number;
  milestone_bonus: number;
  next_claim_at: number;
  new_balance?: number;
  // Variable "lucky wheel" (Priority 4) — set when the wheel drew the reward.
  variable?: boolean;
  /** The drawn multiplier (e.g. 2 = "2x!"). 1 when variable mode is off. */
  multiplier?: number;
  minutes_reward?: number;
  comeback_bonus?: number;
  chest_bonus?: number;
}

export interface DailyStreakRepairResult {
  success: boolean;
  repaired: boolean;
  code: string;
  method?: 'freeze' | 'coins';
  freezes_remaining?: number;
  coins_spent?: number;
  new_balance?: number;
  streak_days?: number;
  message?: string;
}

interface UseDailyStreakReturn {
  status: DailyStreakStatus | null;
  /** Initial fetch in flight or refetch in progress. */
  loading: boolean;
  /** Claim API in flight. UI should disable the Claim button while true. */
  claiming: boolean;
  /** Last claim outcome — drives the celebration view. Cleared on dismiss. */
  lastClaim: DailyStreakClaimResult | null;
  /** Force a refresh of the snapshot (e.g. after pull-to-refresh). */
  refresh: () => Promise<void>;
  /**
   * Issue the claim. Returns the result so the caller can surface a toast
   * or animation; also updates internal state + AuthContext coins on
   * success. Safe to call repeatedly — the server is idempotent within an
   * IST day.
   */
  claim: () => Promise<DailyStreakClaimResult | null>;
  /** Reset `lastClaim` so the celebration view stops showing. */
  dismissCelebration: () => void;
  /** Repair API in flight. UI should disable the repair button while true. */
  repairing: boolean;
  /**
   * Restore a lapsed streak (missed exactly one day). Spends a free freeze
   * token or coins on the server. Refreshes status + syncs coins on success.
   */
  repair: () => Promise<DailyStreakRepairResult | null>;
}

/**
 * App-launch / foreground-resume hook for the daily streak. Returning
 * users should see the modal whenever they open the app on a new IST day.
 */
export function useDailyStreak(): UseDailyStreakReturn {
  const { user, isLoggedIn, updateCoins } = useAuth();
  const [status, setStatus] = useState<DailyStreakStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [lastClaim, setLastClaim] = useState<DailyStreakClaimResult | null>(null);
  // Guard against double-fetching during a render race when both
  // `isLoggedIn` and `user?.id` change in the same tick.
  const inFlight = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!isLoggedIn || !user?.id) {
      setStatus(null);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await API.getStreak();
      setStatus(res);
    } catch (err) {
      // Quietly drop — surface only via debug log. The Daily Reward modal
      // depends on `status`, so a null here just means no modal pops.
      console.warn("[useDailyStreak] fetch failed:", err);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [isLoggedIn, user?.id]);

  // Initial fetch + refetch when the user logs in / changes.
  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Foreground-resume refetch — handles "user opened the app at 6am, kept
  // it backgrounded past midnight, foregrounded at 1am next day" so the
  // modal pops on day-rollover without the user closing & reopening.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void fetchStatus();
    });
    return () => sub.remove();
  }, [fetchStatus]);

  const claim = useCallback(async (): Promise<DailyStreakClaimResult | null> => {
    if (!isLoggedIn || !user?.id) return null;
    setClaiming(true);
    try {
      const res = await API.claimDailyStreak();
      setLastClaim(res);
      // Refresh snapshot so the UI flips to cooldown state immediately.
      void fetchStatus();
      // Sync the wallet header — the server returned the post-credit
      // balance for us, no need for a separate /me roundtrip.
      if (res.claimed && typeof res.new_balance === "number") {
        updateCoins(res.new_balance);
      }
      return res;
    } catch (err) {
      console.warn("[useDailyStreak] claim failed:", err);
      return null;
    } finally {
      setClaiming(false);
    }
  }, [isLoggedIn, user?.id, fetchStatus, updateCoins]);

  const dismissCelebration = useCallback(() => setLastClaim(null), []);

  const [repairing, setRepairing] = useState(false);
  const repair = useCallback(async (): Promise<DailyStreakRepairResult | null> => {
    if (!isLoggedIn || !user?.id) return null;
    setRepairing(true);
    try {
      const res = await API.repairStreak();
      // Refresh snapshot so the card reflects the restored streak immediately.
      void fetchStatus();
      if (res.repaired && typeof res.new_balance === "number") {
        updateCoins(res.new_balance);
      }
      return res;
    } catch (err) {
      console.warn("[useDailyStreak] repair failed:", err);
      return null;
    } finally {
      setRepairing(false);
    }
  }, [isLoggedIn, user?.id, fetchStatus, updateCoins]);

  return {
    status,
    loading,
    claiming,
    lastClaim,
    refresh: fetchStatus,
    claim,
    dismissCelebration,
    repairing,
    repair,
  };
}
