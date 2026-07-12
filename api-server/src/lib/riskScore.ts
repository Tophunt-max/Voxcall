// ============================================================================
// Fraud / Abuse Risk Scoring engine
// ============================================================================
//
// A lightweight, TRANSPARENT risk score (0..100) per user, blended from
// behavioural signals we already store — no new PII, no opaque ML. It powers
// an admin "flagged users" view and can optionally throttle high-risk actions.
//
// Signals (all best-effort; a missing table/column just contributes 0):
//
//   • recharge_velocity  — many purchases in a very short window is the classic
//                          stolen-card / card-testing pattern.
//   • refund_ratio       — refunds as a share of purchases; abusers farm
//                          refunds / chargebacks.
//   • chargeback_hits    — explicit chargeback/dispute transactions (heavy).
//   • new_account_burst  — brand-new account that immediately spends big
//                          (bonus-abuse / promo-farming signal).
//   • ban_history        — prior bans/strikes on the account.
//   • decline_rate       — high call-decline / no-show rate (host-side abuse).
//
// The score is a weighted sum of per-signal sub-scores each clamped to 0..1,
// scaled to 0..100. Weights live in app_settings.risk_weights so admins can
// retune without a deploy. Everything is DEFAULT OFF (risk_scoring_enabled=0):
// enabling only surfaces information + optional soft-throttle, never bans.
//
// Pure scoring functions (no DB / env) are exported for unit testing; the
// DB-gathering helper is defensive and never throws on a hot path.
// ============================================================================

import type { Env } from '../types';

export interface RiskWeights {
  recharge_velocity: number;
  refund_ratio: number;
  chargeback_hits: number;
  new_account_burst: number;
  ban_history: number;
  decline_rate: number;
}

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  recharge_velocity: 0.9,
  refund_ratio: 1.0,
  chargeback_hits: 1.4,
  new_account_burst: 0.7,
  ban_history: 1.2,
  decline_rate: 0.5,
};

/** Coerce a possibly-malformed saved blob over the defaults (finite, >= 0). */
export function normalizeRiskWeights(input: unknown): RiskWeights {
  const out: RiskWeights = { ...DEFAULT_RISK_WEIGHTS };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(DEFAULT_RISK_WEIGHTS) as (keyof RiskWeights)[]) {
      const v = Number((input as Record<string, unknown>)[key]);
      if (Number.isFinite(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}

/** Raw behavioural features gathered for one user. All counts are best-effort. */
export interface RiskFeatures {
  /** Purchases in the last `velocity_window_hours`. */
  recent_purchases: number;
  /** Total purchases in the lookback window. */
  total_purchases: number;
  /** Refund transactions in the lookback window. */
  refunds: number;
  /** Chargeback / dispute transactions in the lookback window. */
  chargebacks: number;
  /** Account age in days. */
  account_age_days: number;
  /** Total coins purchased in the lookback window. */
  purchased_coins: number;
  /** Prior bans/strikes recorded against the account. */
  ban_count: number;
  /** Calls the user declined / no-showed in the lookback window. */
  declined_calls: number;
  /** Calls the user was offered / initiated in the lookback window. */
  offered_calls: number;
}

export const EMPTY_FEATURES: RiskFeatures = {
  recent_purchases: 0,
  total_purchases: 0,
  refunds: 0,
  chargebacks: 0,
  account_age_days: 9999,
  purchased_coins: 0,
  ban_count: 0,
  declined_calls: 0,
  offered_calls: 0,
};

export type RiskTier = 'low' | 'medium' | 'high';

export interface RiskAssessment {
  enabled: boolean;
  score: number; // 0..100
  tier: RiskTier;
  /** Per-signal sub-scores (0..1) — for admin transparency. */
  breakdown: Record<keyof RiskWeights, number>;
  /** Human-readable top reasons, strongest first. */
  reasons: string[];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? 1 : n;
}

/**
 * Pure risk scorer. Returns a 0..100 score + a transparent breakdown. The
 * `velocityBurst` threshold is the number of recent purchases that saturates
 * the velocity sub-score to 1.0.
 */
export function computeRiskScore(
  f: RiskFeatures,
  weights: RiskWeights,
  opts: { velocityBurst?: number; newAccountDays?: number } = {},
): RiskAssessment {
  const velocityBurst = opts.velocityBurst && opts.velocityBurst > 0 ? opts.velocityBurst : 4;
  const newAccountDays = opts.newAccountDays && opts.newAccountDays > 0 ? opts.newAccountDays : 3;

  // Per-signal sub-scores, each 0..1.
  const rechargeVelocity = clamp01((Number(f.recent_purchases) || 0) / velocityBurst);

  const refundRatio =
    f.total_purchases > 0 ? clamp01((Number(f.refunds) || 0) / f.total_purchases) : 0;

  // A single chargeback is a strong signal; 3+ saturates.
  const chargebackHits = clamp01((Number(f.chargebacks) || 0) / 3);

  // Big spend on a brand-new account (only meaningful within the new window).
  const isNew = (Number(f.account_age_days) || 9999) <= newAccountDays;
  const newAccountBurst = isNew ? clamp01((Number(f.purchased_coins) || 0) / 5000) : 0;

  const banHistory = clamp01((Number(f.ban_count) || 0) / 2);

  const declineRate =
    f.offered_calls > 0 ? clamp01((Number(f.declined_calls) || 0) / f.offered_calls) : 0;

  const breakdown: Record<keyof RiskWeights, number> = {
    recharge_velocity: rechargeVelocity,
    refund_ratio: refundRatio,
    chargeback_hits: chargebackHits,
    new_account_burst: newAccountBurst,
    ban_history: banHistory,
    decline_rate: declineRate,
  };

  // Weighted sum, normalized by total weight so the score is always 0..100
  // regardless of how the admin tunes the weights.
  let weighted = 0;
  let totalWeight = 0;
  for (const key of Object.keys(breakdown) as (keyof RiskWeights)[]) {
    weighted += breakdown[key] * weights[key];
    totalWeight += weights[key];
  }
  const score = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 0;

  const tier: RiskTier = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

  // Reasons: label the strongest contributing signals (weighted), strongest first.
  const labels: Record<keyof RiskWeights, string> = {
    recharge_velocity: 'Rapid repeated recharges',
    refund_ratio: 'High refund ratio',
    chargeback_hits: 'Chargeback / dispute activity',
    new_account_burst: 'Large spend on a brand-new account',
    ban_history: 'Prior bans / strikes',
    decline_rate: 'High call-decline rate',
  };
  const reasons = (Object.keys(breakdown) as (keyof RiskWeights)[])
    .map((k) => ({ k, contrib: breakdown[k] * weights[k] }))
    .filter((x) => x.contrib > 0.05)
    .sort((a, b) => b.contrib - a.contrib)
    .slice(0, 3)
    .map((x) => labels[x.k]);

  return { enabled: true, score, tier, breakdown, reasons };
}

const NO_RISK: RiskAssessment = {
  enabled: false,
  score: 0,
  tier: 'low',
  breakdown: {
    recharge_velocity: 0,
    refund_ratio: 0,
    chargeback_hits: 0,
    new_account_burst: 0,
    ban_history: 0,
    decline_rate: 0,
  },
  reasons: [],
};

async function readBool(db: D1Database, key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallback;
    return row.value !== '0' && row.value.toLowerCase() !== 'false';
  } catch { return fallback; }
}
async function readInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch { return fallback; }
}
async function readWeights(db: D1Database): Promise<RiskWeights> {
  try {
    const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'risk_weights'").first<{ value: string }>();
    return normalizeRiskWeights(row?.value ? JSON.parse(row.value) : undefined);
  } catch { return { ...DEFAULT_RISK_WEIGHTS }; }
}

/**
 * Defensively gather risk features for a user from existing tables. Each query
 * is wrapped so a missing column/table contributes 0 rather than throwing.
 */
export async function gatherRiskFeatures(
  db: D1Database,
  userId: string,
  lookbackDays: number,
  velocityWindowHours: number,
): Promise<RiskFeatures> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - lookbackDays * 86400;
  const velocityCutoff = now - velocityWindowHours * 3600;
  const f: RiskFeatures = { ...EMPTY_FEATURES };

  // coin_transactions: purchases (amount > 0, type in purchase/deposit/topup),
  // refunds, chargebacks.
  try {
    const row = await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN amount > 0 AND created_at > ? THEN 1 ELSE 0 END), 0) AS recent_purchases,
           COALESCE(SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END), 0) AS total_purchases,
           COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS purchased_coins,
           COALESCE(SUM(CASE WHEN type = 'refund' THEN 1 ELSE 0 END), 0) AS refunds,
           COALESCE(SUM(CASE WHEN type IN ('chargeback','dispute') THEN 1 ELSE 0 END), 0) AS chargebacks
         FROM coin_transactions
         WHERE user_id = ? AND created_at > ?`,
      )
      .bind(velocityCutoff, userId, cutoff)
      .first<{ recent_purchases: number; total_purchases: number; purchased_coins: number; refunds: number; chargebacks: number }>();
    if (row) {
      f.recent_purchases = Number(row.recent_purchases) || 0;
      f.total_purchases = Number(row.total_purchases) || 0;
      f.purchased_coins = Number(row.purchased_coins) || 0;
      f.refunds = Number(row.refunds) || 0;
      f.chargebacks = Number(row.chargebacks) || 0;
    }
  } catch (e) {
    console.warn('[riskScore] coin_transactions gather failed (non-fatal):', e);
  }

  // Account age from users.created_at.
  try {
    const u = await db.prepare('SELECT created_at FROM users WHERE id = ?').bind(userId).first<{ created_at: number }>();
    if (u?.created_at) f.account_age_days = Math.max(0, (now - Number(u.created_at)) / 86400);
  } catch (e) {
    console.warn('[riskScore] users gather failed (non-fatal):', e);
  }

  // Ban history — table name defensive (bans). 0 if absent.
  try {
    const b = await db.prepare('SELECT COUNT(*) AS n FROM bans WHERE user_id = ?').bind(userId).first<{ n: number }>();
    f.ban_count = Number(b?.n) || 0;
  } catch {
    /* no bans table / column — contributes 0 */
  }

  // Call decline / offer counts from call_sessions (caller side).
  try {
    const c = await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('declined','missed','cancelled') THEN 1 ELSE 0 END), 0) AS declined,
           COALESCE(COUNT(*), 0) AS offered
         FROM call_sessions
         WHERE caller_id = ? AND created_at > ?`,
      )
      .bind(userId, cutoff)
      .first<{ declined: number; offered: number }>();
    f.declined_calls = Number(c?.declined) || 0;
    f.offered_calls = Number(c?.offered) || 0;
  } catch (e) {
    console.warn('[riskScore] call_sessions gather failed (non-fatal):', e);
  }

  return f;
}

/**
 * Full assessment for a single user. Returns a disabled (zero) result when the
 * feature flag is off. Never throws.
 */
export async function assessUserRisk(env: Env, userId: string): Promise<RiskAssessment> {
  try {
    const db = env.DB;
    if (!(await readBool(db, 'risk_scoring_enabled', false))) return NO_RISK;

    const lookbackDays = Math.max(1, await readInt(db, 'risk_lookback_days', 30));
    const velocityWindowHours = Math.max(1, await readInt(db, 'risk_velocity_window_hours', 1));
    const velocityBurst = Math.max(2, await readInt(db, 'risk_velocity_burst', 4));
    const newAccountDays = Math.max(1, await readInt(db, 'risk_new_account_days', 3));
    const weights = await readWeights(db);

    const features = await gatherRiskFeatures(db, userId, lookbackDays, velocityWindowHours);
    return computeRiskScore(features, weights, { velocityBurst, newAccountDays });
  } catch (e) {
    console.warn('[riskScore] assessUserRisk failed for', userId, e);
    return NO_RISK;
  }
}
