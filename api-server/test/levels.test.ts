import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEVEL_CONFIG,
  evaluateLevel,
  getEarningShare,
  getMaxRate,
  normalizeLevelConfig,
  BASE_EARNING_SHARE,
  ABSOLUTE_MAX_RATE,
} from '../src/lib/levels';

const cfg = DEFAULT_LEVEL_CONFIG;

describe('evaluateLevel — highest rung whose call + rating thresholds are both met', () => {
  it('floors at level 1 for a brand-new host', () => {
    expect(evaluateLevel({ review_count: 0, rating: 0 }, cfg)).toBe(1);
    expect(evaluateLevel({ review_count: 49, rating: 5 }, cfg)).toBe(1);
  });

  it('promotes only when BOTH calls and rating clear the bar', () => {
    expect(evaluateLevel({ review_count: 50, rating: 4.0 }, cfg)).toBe(2);
    expect(evaluateLevel({ review_count: 200, rating: 4.3 }, cfg)).toBe(3);
    expect(evaluateLevel({ review_count: 1000, rating: 4.8 }, cfg)).toBe(5);
  });

  it('does not promote when rating is just below the threshold', () => {
    // enough calls for level 5 but rating below 4.8 -> caps at level 4 (needs 4.6)
    expect(evaluateLevel({ review_count: 1000, rating: 4.7 }, cfg)).toBe(4);
    // enough calls for level 2 but rating below 4.0 -> stays level 1
    expect(evaluateLevel({ review_count: 60, rating: 3.9 }, cfg)).toBe(1);
  });
});

describe('getEarningShare', () => {
  it('returns the per-level share from the ladder', () => {
    expect(getEarningShare(1, cfg)).toBe(0.7);
    expect(getEarningShare(3, cfg)).toBe(0.72);
    expect(getEarningShare(5, cfg)).toBe(0.8);
  });

  it('falls back to the baseline share for out-of-range levels', () => {
    expect(getEarningShare(99, cfg)).toBe(BASE_EARNING_SHARE);
    expect(getEarningShare(0, cfg)).toBe(BASE_EARNING_SHARE);
  });
});

describe('getMaxRate', () => {
  it('returns the per-level rate cap', () => {
    expect(getMaxRate(1, cfg)).toBe(100);
    expect(getMaxRate(5, cfg)).toBe(500);
  });
});

describe('normalizeLevelConfig — never returns a corrupt ladder', () => {
  it('returns the default ladder for invalid input', () => {
    expect(normalizeLevelConfig(null)).toBe(DEFAULT_LEVEL_CONFIG);
    expect(normalizeLevelConfig('nope')).toBe(DEFAULT_LEVEL_CONFIG);
    expect(normalizeLevelConfig([{ level: 1 }])).toBe(DEFAULT_LEVEL_CONFIG); // wrong length
  });

  it('clamps earning_share into the safe 0.1–0.95 band', () => {
    const input = DEFAULT_LEVEL_CONFIG.map((l) => ({
      ...l,
      perks: { ...l.perks, earning_share: 2.0 },
    }));
    const out = normalizeLevelConfig(input);
    expect(out[4].perks.earning_share).toBe(0.95); // 2.0 -> clamped to 0.95
  });

  it('clamps max_rate to the absolute ceiling', () => {
    const input = DEFAULT_LEVEL_CONFIG.map((l) => ({
      ...l,
      perks: { ...l.perks, max_rate: 99999 },
    }));
    const out = normalizeLevelConfig(input);
    expect(out[0].perks.max_rate).toBe(ABSOLUTE_MAX_RATE);
  });

  it('backfills perks from defaults when an older saved config omits them', () => {
    const input = DEFAULT_LEVEL_CONFIG.map((l) => ({ ...l, perks: undefined }));
    const out = normalizeLevelConfig(input);
    expect(out[0].perks.earning_share).toBe(DEFAULT_LEVEL_CONFIG[0].perks.earning_share);
    expect(out[4].perks.max_rate).toBe(DEFAULT_LEVEL_CONFIG[4].perks.max_rate);
  });
});
