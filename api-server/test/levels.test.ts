import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEVEL_CONFIG,
  evaluateLevel,
  getEarningShare,
  getMaxRate,
  getMaxAudioRate,
  getMaxVideoRate,
  getHostAudioRateCeiling,
  getHostVideoRateCeiling,
  normalizeLevelConfig,
  BASE_EARNING_SHARE,
  ABSOLUTE_MAX_RATE,
  HOST_RATE_BONUS,
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

describe('per-channel rate caps', () => {
  it('getMaxAudioRate / getMaxVideoRate return the per-level admin caps', () => {
    expect(getMaxAudioRate(1, cfg)).toBe(100);
    expect(getMaxVideoRate(1, cfg)).toBe(100);
    expect(getMaxAudioRate(5, cfg)).toBe(500);
    expect(getMaxVideoRate(5, cfg)).toBe(500);
  });

  it('host rate ceilings add HOST_RATE_BONUS, clamped to ABSOLUTE_MAX_RATE', () => {
    // Level 1 cap 100 -> host can charge up to 100 + 5
    expect(getHostAudioRateCeiling(1, cfg)).toBe(100 + HOST_RATE_BONUS);
    expect(getHostVideoRateCeiling(1, cfg)).toBe(100 + HOST_RATE_BONUS);
    // Level 5 cap is already at ABSOLUTE_MAX_RATE -> bonus must NOT push past 500
    expect(getHostAudioRateCeiling(5, cfg)).toBe(ABSOLUTE_MAX_RATE);
    expect(getHostVideoRateCeiling(5, cfg)).toBe(ABSOLUTE_MAX_RATE);
  });

  it('audio + video can be set independently per level', () => {
    const custom = DEFAULT_LEVEL_CONFIG.map((l, i) => ({
      ...l,
      perks: {
        ...l.perks,
        max_audio_rate: 50 + i * 10, // 50, 60, 70, 80, 90
        max_video_rate: 200 + i * 20, // 200, 220, 240, 260, 280
      },
    }));
    const out = normalizeLevelConfig(custom);
    expect(getMaxAudioRate(1, out)).toBe(50);
    expect(getMaxVideoRate(1, out)).toBe(200);
    expect(getMaxAudioRate(5, out)).toBe(90);
    expect(getMaxVideoRate(5, out)).toBe(280);
    // Legacy combined cap should be the larger of the two channel caps.
    expect(getMaxRate(5, out)).toBe(280);
  });

  it('falls back to legacy max_rate when channel caps are missing (older configs)', () => {
    // Simulate a config saved before max_audio_rate / max_video_rate existed.
    const legacy = DEFAULT_LEVEL_CONFIG.map((l) => ({
      ...l,
      perks: {
        max_rate: 123,
        earning_share: l.perks.earning_share,
        rank_boost: l.perks.rank_boost,
      },
    })) as any;
    const out = normalizeLevelConfig(legacy);
    expect(out[0].perks.max_audio_rate).toBe(123);
    expect(out[0].perks.max_video_rate).toBe(123);
    expect(out[0].perks.max_rate).toBe(123);
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
      perks: { ...l.perks, max_rate: 99999, max_audio_rate: 99999, max_video_rate: 99999 },
    }));
    const out = normalizeLevelConfig(input);
    expect(out[0].perks.max_rate).toBe(ABSOLUTE_MAX_RATE);
    expect(out[0].perks.max_audio_rate).toBe(ABSOLUTE_MAX_RATE);
    expect(out[0].perks.max_video_rate).toBe(ABSOLUTE_MAX_RATE);
  });

  it('backfills perks from defaults when an older saved config omits them', () => {
    const input = DEFAULT_LEVEL_CONFIG.map((l) => ({ ...l, perks: undefined }));
    const out = normalizeLevelConfig(input);
    expect(out[0].perks.earning_share).toBe(DEFAULT_LEVEL_CONFIG[0].perks.earning_share);
    expect(out[4].perks.max_rate).toBe(DEFAULT_LEVEL_CONFIG[4].perks.max_rate);
  });
});
