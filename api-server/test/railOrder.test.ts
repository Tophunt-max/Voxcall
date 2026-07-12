import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RAIL_WEIGHTS,
  normalizeRailWeights,
  railAffinity,
  orderRails,
  type RailStat,
} from '../src/lib/railOrder';

const DEFAULT = ['favorites', 'recommended', 'top'];

describe('normalizeRailWeights', () => {
  it('returns defaults for bad input and overrides valid fields', () => {
    expect(normalizeRailWeights(null)).toEqual(DEFAULT_RAIL_WEIGHTS);
    expect(normalizeRailWeights({ conversion: 5 }).conversion).toBe(5);
    expect(normalizeRailWeights({ conversion: -1 }).conversion).toBe(DEFAULT_RAIL_WEIGHTS.conversion);
  });
});

describe('railAffinity', () => {
  it('is the neutral 0.5 baseline for a rail with no engagement', () => {
    const a = railAffinity({ surface: 'x', impressions: 0, clicks: 0, conversions: 0 }, DEFAULT_RAIL_WEIGHTS);
    expect(a).toBeCloseTo(0.5, 5);
  });

  it('rises above baseline when a rail converts', () => {
    const engaged: RailStat = { surface: 'top', impressions: 10, clicks: 8, conversions: 5 };
    expect(railAffinity(engaged, DEFAULT_RAIL_WEIGHTS)).toBeGreaterThan(0.5);
  });
});

describe('orderRails', () => {
  it('keeps the default order for a no-signal user', () => {
    expect(orderRails(DEFAULT, {}, DEFAULT_RAIL_WEIGHTS)).toEqual(DEFAULT);
  });

  it('floats an engaged rail to the front', () => {
    const stats: Record<string, RailStat> = {
      top: { surface: 'top', impressions: 10, clicks: 8, conversions: 5 },
    };
    expect(orderRails(DEFAULT, stats, DEFAULT_RAIL_WEIGHTS)).toEqual(['top', 'favorites', 'recommended']);
  });

  it('holds pinned rails in their original slot', () => {
    const stats: Record<string, RailStat> = {
      top: { surface: 'top', impressions: 10, clicks: 8, conversions: 5 },
    };
    const result = orderRails(DEFAULT, stats, DEFAULT_RAIL_WEIGHTS, ['favorites']);
    expect(result[0]).toBe('favorites'); // pinned stays first
    expect(result).toEqual(['favorites', 'top', 'recommended']);
  });

  it('always returns a permutation of the input', () => {
    const stats: Record<string, RailStat> = {
      recommended: { surface: 'recommended', impressions: 3, clicks: 3, conversions: 2 },
    };
    const result = orderRails(DEFAULT, stats, DEFAULT_RAIL_WEIGHTS);
    expect([...result].sort()).toEqual([...DEFAULT].sort());
  });
});
