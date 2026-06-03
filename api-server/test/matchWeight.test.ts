import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MATCH_WEIGHTS,
  normalizeMatchWeights,
  computeMatchWeight,
  weightedSample,
  type MatchWeights,
  type WeightCandidate,
} from '../src/lib/matchWeight';

describe('normalizeMatchWeights', () => {
  it('returns defaults when input is null/undefined', () => {
    expect(normalizeMatchWeights(null)).toEqual(DEFAULT_MATCH_WEIGHTS);
    expect(normalizeMatchWeights(undefined)).toEqual(DEFAULT_MATCH_WEIGHTS);
  });

  it('returns defaults when input is an array', () => {
    expect(normalizeMatchWeights([1, 2, 3])).toEqual(DEFAULT_MATCH_WEIGHTS);
  });

  it('returns defaults when input is a non-object primitive', () => {
    expect(normalizeMatchWeights(42)).toEqual(DEFAULT_MATCH_WEIGHTS);
    expect(normalizeMatchWeights('string')).toEqual(DEFAULT_MATCH_WEIGHTS);
  });

  it('overrides valid fields from the input object', () => {
    const result = normalizeMatchWeights({ base: 2.0, rating: 0.5 });
    expect(result.base).toBe(2.0);
    expect(result.rating).toBe(0.5);
    // Other fields remain default
    expect(result.rank_boost).toBe(DEFAULT_MATCH_WEIGHTS.rank_boost);
  });

  it('ignores negative values', () => {
    const result = normalizeMatchWeights({ base: -1 });
    expect(result.base).toBe(DEFAULT_MATCH_WEIGHTS.base);
  });

  it('ignores non-finite values (NaN, Infinity)', () => {
    const result = normalizeMatchWeights({ base: NaN, rating: Infinity });
    expect(result.base).toBe(DEFAULT_MATCH_WEIGHTS.base);
    expect(result.rating).toBe(DEFAULT_MATCH_WEIGHTS.rating);
  });

  it('accepts zero as a valid weight', () => {
    const result = normalizeMatchWeights({ base: 0 });
    expect(result.base).toBe(0);
  });
});

describe('computeMatchWeight', () => {
  const now = 1700000000;

  const baseCandidate: WeightCandidate = {
    rating: 4.5,
    review_count: 50,
    created_at: now - 86400 * 60, // 60 days old — no freshness
    rank_boost_norm: 0.5,
    recent_matches: 0,
  };

  it('returns a strictly positive weight for a standard candidate', () => {
    const w = computeMatchWeight(baseCandidate, DEFAULT_MATCH_WEIGHTS, { now });
    expect(w).toBeGreaterThan(0);
  });

  it('applies freshness boost for newly created hosts', () => {
    const newHost: WeightCandidate = {
      ...baseCandidate,
      created_at: now - 86400 * 5, // 5 days old
      review_count: 2,
    };
    const wNew = computeMatchWeight(newHost, DEFAULT_MATCH_WEIGHTS, { now });
    const wOld = computeMatchWeight(baseCandidate, DEFAULT_MATCH_WEIGHTS, { now });
    expect(wNew).toBeGreaterThan(wOld);
  });

  it('applies demand penalty for hosts with many recent matches', () => {
    const hotHost: WeightCandidate = { ...baseCandidate, recent_matches: 20 };
    const wHot = computeMatchWeight(hotHost, DEFAULT_MATCH_WEIGHTS, { now });
    const wCold = computeMatchWeight(baseCandidate, DEFAULT_MATCH_WEIGHTS, { now });
    expect(wHot).toBeLessThan(wCold);
  });

  it('higher rating increases weight', () => {
    const high: WeightCandidate = { ...baseCandidate, rating: 5.0 };
    const low: WeightCandidate = { ...baseCandidate, rating: 2.0 };
    const wHigh = computeMatchWeight(high, DEFAULT_MATCH_WEIGHTS, { now });
    const wLow = computeMatchWeight(low, DEFAULT_MATCH_WEIGHTS, { now });
    expect(wHigh).toBeGreaterThan(wLow);
  });

  it('never returns zero or negative', () => {
    const worst: WeightCandidate = {
      rating: 0,
      review_count: 0,
      created_at: now - 86400 * 365,
      rank_boost_norm: 0,
      recent_matches: 1000,
    };
    const w = computeMatchWeight(worst, DEFAULT_MATCH_WEIGHTS, { now });
    expect(w).toBeGreaterThan(0);
  });

  it('respects custom weights (zeroed demand_balance removes penalty)', () => {
    const weights: MatchWeights = { ...DEFAULT_MATCH_WEIGHTS, demand_balance: 0 };
    const hotHost: WeightCandidate = { ...baseCandidate, recent_matches: 100 };
    const wNoPenalty = computeMatchWeight(hotHost, weights, { now });
    const wDefault = computeMatchWeight(hotHost, DEFAULT_MATCH_WEIGHTS, { now });
    expect(wNoPenalty).toBeGreaterThan(wDefault);
  });
});

describe('weightedSample', () => {
  it('returns null for an empty list', () => {
    expect(weightedSample([], () => 1)).toBeNull();
  });

  it('returns the only item in a single-element list', () => {
    expect(weightedSample(['a'], () => 1)).toBe('a');
  });

  it('deterministically selects based on the rng value', () => {
    const items = ['a', 'b', 'c'];
    // All equal weights: rng=0 → first item, rng close to 1 → last
    const first = weightedSample(items, () => 1, () => 0);
    expect(first).toBe('a');

    const last = weightedSample(items, () => 1, () => 0.999);
    expect(last).toBe('c');
  });

  it('respects weight distribution', () => {
    const items = ['heavy', 'light'];
    // heavy weight 100, light weight 1
    const weightOf = (item: string) => (item === 'heavy' ? 100 : 1);
    // rng = 0.5 → r = 0.5 * 101 = 50.5, which is within heavy's range (100)
    const result = weightedSample(items, weightOf, () => 0.5);
    expect(result).toBe('heavy');
  });

  it('falls back to first item when all weights are zero', () => {
    const result = weightedSample(['a', 'b', 'c'], () => 0);
    expect(result).toBe('a');
  });

  it('handles negative weights gracefully (treats as 0)', () => {
    const items = ['neg', 'pos'];
    const weightOf = (item: string) => (item === 'neg' ? -5 : 10);
    // total becomes 10 (neg is clamped to 0)
    const result = weightedSample(items, weightOf, () => 0.5);
    expect(result).toBe('pos');
  });
});
