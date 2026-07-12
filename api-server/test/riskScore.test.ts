import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RISK_WEIGHTS,
  normalizeRiskWeights,
  computeRiskScore,
  EMPTY_FEATURES,
  type RiskFeatures,
} from '../src/lib/riskScore';

describe('normalizeRiskWeights', () => {
  it('returns defaults for null / undefined / array / primitive', () => {
    expect(normalizeRiskWeights(null)).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(normalizeRiskWeights(undefined)).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(normalizeRiskWeights([1, 2])).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(normalizeRiskWeights(7)).toEqual(DEFAULT_RISK_WEIGHTS);
  });

  it('overrides valid fields and ignores negative / non-finite', () => {
    const w = normalizeRiskWeights({ refund_ratio: 2, chargeback_hits: -1, ban_history: NaN });
    expect(w.refund_ratio).toBe(2);
    expect(w.chargeback_hits).toBe(DEFAULT_RISK_WEIGHTS.chargeback_hits);
    expect(w.ban_history).toBe(DEFAULT_RISK_WEIGHTS.ban_history);
  });
});

describe('computeRiskScore', () => {
  it('scores a clean user as 0 / low tier with no reasons', () => {
    const r = computeRiskScore(EMPTY_FEATURES, DEFAULT_RISK_WEIGHTS);
    expect(r.score).toBe(0);
    expect(r.tier).toBe('low');
    expect(r.reasons).toEqual([]);
    expect(r.enabled).toBe(true);
  });

  it('saturates to 100 / high when every signal maxes out', () => {
    const f: RiskFeatures = {
      recent_purchases: 8,
      total_purchases: 10,
      refunds: 10,
      chargebacks: 3,
      account_age_days: 1,
      purchased_coins: 5000,
      ban_count: 2,
      declined_calls: 10,
      offered_calls: 10,
    };
    const r = computeRiskScore(f, DEFAULT_RISK_WEIGHTS, { velocityBurst: 4, newAccountDays: 3 });
    expect(r.score).toBe(100);
    expect(r.tier).toBe('high');
    expect(r.reasons.length).toBe(3); // top-3 strongest signals
  });

  it('classifies a mixed profile as medium tier', () => {
    const f: RiskFeatures = {
      ...EMPTY_FEATURES,
      recent_purchases: 4, // velocity -> 1
      total_purchases: 5,
      refunds: 5, // refund ratio -> 1
      ban_count: 2, // ban history -> 1
    };
    const r = computeRiskScore(f, DEFAULT_RISK_WEIGHTS, { velocityBurst: 4 });
    expect(r.tier).toBe('medium');
    expect(r.score).toBeGreaterThanOrEqual(40);
    expect(r.score).toBeLessThan(70);
  });

  it('does not divide by zero when there are no purchases / offers', () => {
    const f: RiskFeatures = { ...EMPTY_FEATURES, refunds: 3, declined_calls: 3 };
    const r = computeRiskScore(f, DEFAULT_RISK_WEIGHTS);
    expect(r.breakdown.refund_ratio).toBe(0);
    expect(r.breakdown.decline_rate).toBe(0);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('only counts new-account burst inside the new-account window', () => {
    const base: RiskFeatures = { ...EMPTY_FEATURES, purchased_coins: 5000 };
    const newAcct = computeRiskScore({ ...base, account_age_days: 1 }, DEFAULT_RISK_WEIGHTS, { newAccountDays: 3 });
    const oldAcct = computeRiskScore({ ...base, account_age_days: 30 }, DEFAULT_RISK_WEIGHTS, { newAccountDays: 3 });
    expect(newAcct.breakdown.new_account_burst).toBeGreaterThan(0);
    expect(oldAcct.breakdown.new_account_burst).toBe(0);
  });
});
