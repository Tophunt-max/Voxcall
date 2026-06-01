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
  getRandomAudioRate,
  getRandomVideoRate,
  normalizeLevelConfig,
  BASE_EARNING_SHARE,
  ABSOLUTE_MAX_RATE,
  HOST_RATE_BONUS,
  MIN_LEVELS,
  MAX_LEVELS,
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
    expect(normalizeLevelConfig([])).toBe(DEFAULT_LEVEL_CONFIG); // empty -> fallback
  });

  it('rejects ladders larger than MAX_LEVELS by returning the seeded default', () => {
    // Build an array longer than MAX_LEVELS — must fall back, not silently
    // truncate (the admin panel and PUT endpoint enforce the same bound, so
    // an oversized payload is a client bug we never want to persist).
    const oversized = Array.from({ length: MAX_LEVELS + 1 }, (_, i) => ({
      ...DEFAULT_LEVEL_CONFIG[0],
      level: i + 1,
    }));
    expect(normalizeLevelConfig(oversized)).toBe(DEFAULT_LEVEL_CONFIG);
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

describe('variable-length ladder (admin add/remove rungs)', () => {
  it('accepts a single-rung ladder (just level 1)', () => {
    const single = [DEFAULT_LEVEL_CONFIG[0]];
    const out = normalizeLevelConfig(single);
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe(1);
    expect(out[0].name).toBe('Newcomer');
    // evaluateLevel should never promote past the top rung available.
    expect(evaluateLevel({ review_count: 99999, rating: 5 }, out)).toBe(1);
  });

  it('accepts ladders shorter than the seed (e.g. 3 rungs)', () => {
    const three = DEFAULT_LEVEL_CONFIG.slice(0, 3);
    const out = normalizeLevelConfig(three);
    expect(out).toHaveLength(3);
    expect(out.map((l) => l.level)).toEqual([1, 2, 3]);
    // A host with stats matching level 5 of the seed ladder should still
    // cap at 3 because that's the highest configured rung now.
    expect(evaluateLevel({ review_count: 1000, rating: 4.8 }, out)).toBe(3);
  });

  it('accepts ladders longer than the seed (up to MAX_LEVELS)', () => {
    // Build an extended ladder by appending custom rungs after the seed.
    const extended = [
      ...DEFAULT_LEVEL_CONFIG,
      { level: 6, name: 'Legend', badge: '🏆', color: '#000', min_calls: 2000, min_rating: 4.9, coin_reward: 2000, description: '', perks: { max_rate: 500, max_audio_rate: 500, max_video_rate: 500, earning_share: 0.85, rank_boost: 6 } },
      { level: 7, name: 'Mythic', badge: '🏆', color: '#000', min_calls: 5000, min_rating: 4.95, coin_reward: 5000, description: '', perks: { max_rate: 500, max_audio_rate: 500, max_video_rate: 500, earning_share: 0.90, rank_boost: 7 } },
    ];
    const out = normalizeLevelConfig(extended);
    expect(out).toHaveLength(7);
    expect(out[5].name).toBe('Legend');
    expect(out[6].name).toBe('Mythic');
    expect(out[6].perks.earning_share).toBe(0.90);
    // Highest rung whose thresholds are met should now reach level 7.
    expect(evaluateLevel({ review_count: 5000, rating: 5 }, out)).toBe(7);
  });

  it('renumbers `level` to position so admin-side reorders never produce gaps', () => {
    // Simulate a payload where the client mis-numbered the rungs (e.g. after
    // a buggy remove). Position-based renumbering should fix it on the way in.
    const messy = DEFAULT_LEVEL_CONFIG.map((l) => ({ ...l, level: 99 }));
    const out = normalizeLevelConfig(messy);
    expect(out.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it('respects MIN_LEVELS / MAX_LEVELS constants', () => {
    expect(MIN_LEVELS).toBeGreaterThanOrEqual(1);
    expect(MAX_LEVELS).toBeGreaterThan(MIN_LEVELS);
    // Exactly MAX_LEVELS rungs is accepted (boundary case).
    const atCap = Array.from({ length: MAX_LEVELS }, (_, i) =>
      DEFAULT_LEVEL_CONFIG[i] ?? { ...DEFAULT_LEVEL_CONFIG[DEFAULT_LEVEL_CONFIG.length - 1], level: i + 1 },
    );
    expect(normalizeLevelConfig(atCap)).toHaveLength(MAX_LEVELS);
  });
});


describe('per-level random call rates', () => {
  it('reads admin-set random_audio_rate / random_video_rate from the ladder', () => {
    // Seeded defaults — keep in sync with DEFAULT_LEVEL_CONFIG.
    expect(getRandomAudioRate(1, DEFAULT_LEVEL_CONFIG)).toBe(5);
    expect(getRandomVideoRate(1, DEFAULT_LEVEL_CONFIG)).toBe(8);
    expect(getRandomAudioRate(5, DEFAULT_LEVEL_CONFIG)).toBe(25);
    expect(getRandomVideoRate(5, DEFAULT_LEVEL_CONFIG)).toBe(40);
  });

  it('respects custom per-level random rates set by the admin', () => {
    const custom = DEFAULT_LEVEL_CONFIG.map((l, i) => ({
      ...l,
      perks: {
        ...l.perks,
        random_audio_rate: 10 + i * 5, // 10, 15, 20, 25, 30
        random_video_rate: 20 + i * 10, // 20, 30, 40, 50, 60
      },
    }));
    const out = normalizeLevelConfig(custom);
    expect(getRandomAudioRate(1, out)).toBe(10);
    expect(getRandomVideoRate(1, out)).toBe(20);
    expect(getRandomAudioRate(5, out)).toBe(30);
    expect(getRandomVideoRate(5, out)).toBe(60);
  });

  it('falls back to the seeded default when older configs omit random rates', () => {
    // Simulate a config saved before random_audio_rate / random_video_rate
    // existed. normalizePerks should backfill from DEFAULT_LEVEL_CONFIG.
    const legacy = DEFAULT_LEVEL_CONFIG.map((l) => ({
      ...l,
      perks: {
        max_rate: l.perks.max_rate,
        max_audio_rate: l.perks.max_audio_rate,
        max_video_rate: l.perks.max_video_rate,
        earning_share: l.perks.earning_share,
        rank_boost: l.perks.rank_boost,
      },
    })) as any;
    const out = normalizeLevelConfig(legacy);
    // Each rung should pick up the seed default for its slot.
    expect(out[0].perks.random_audio_rate).toBe(DEFAULT_LEVEL_CONFIG[0].perks.random_audio_rate);
    expect(out[0].perks.random_video_rate).toBe(DEFAULT_LEVEL_CONFIG[0].perks.random_video_rate);
    expect(out[4].perks.random_audio_rate).toBe(DEFAULT_LEVEL_CONFIG[4].perks.random_audio_rate);
    expect(out[4].perks.random_video_rate).toBe(DEFAULT_LEVEL_CONFIG[4].perks.random_video_rate);
  });

  it('clamps random rates to the absolute ceiling', () => {
    const huge = DEFAULT_LEVEL_CONFIG.map((l) => ({
      ...l,
      perks: { ...l.perks, random_audio_rate: 99999, random_video_rate: 99999 },
    }));
    const out = normalizeLevelConfig(huge);
    expect(out[0].perks.random_audio_rate).toBe(ABSOLUTE_MAX_RATE);
    expect(out[0].perks.random_video_rate).toBe(ABSOLUTE_MAX_RATE);
  });

  it('extended ladders synthesize random rates that do not regress below seed level 5', () => {
    const extended = [
      ...DEFAULT_LEVEL_CONFIG,
      { level: 6, name: 'L6', badge: '🏆', color: '#000', min_calls: 2000, min_rating: 4.85, coin_reward: 1500, description: '', perks: {} as any },
      { level: 7, name: 'L7', badge: '🏆', color: '#000', min_calls: 3000, min_rating: 4.9, coin_reward: 2000, description: '', perks: {} as any },
    ];
    const out = normalizeLevelConfig(extended);
    expect(out).toHaveLength(7);
    // Synthesized rungs should never be cheaper than the previous level's
    // random rate (the admin can lower them explicitly later if they want).
    for (let i = 1; i < out.length; i++) {
      expect(out[i].perks.random_audio_rate).toBeGreaterThanOrEqual(out[i - 1].perks.random_audio_rate);
      expect(out[i].perks.random_video_rate).toBeGreaterThanOrEqual(out[i - 1].perks.random_video_rate);
    }
  });
});
