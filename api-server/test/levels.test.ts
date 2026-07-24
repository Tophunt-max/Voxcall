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

  it('promotes only when ALL metrics (calls, rating, minutes, earnings) clear the bar', () => {
    // evaluateLevel gates on all four thresholds (min_calls + min_rating +
    // min_minutes + min_earnings), exactly like the auto level-up engine in
    // levelService.ts. Supply the minutes/earnings that match each target rung.
    expect(evaluateLevel({ review_count: 50, rating: 4.0, total_minutes: 50, total_earnings: 500 }, cfg)).toBe(2);
    expect(evaluateLevel({ review_count: 200, rating: 4.3, total_minutes: 300, total_earnings: 3000 }, cfg)).toBe(3);
    expect(evaluateLevel({ review_count: 1000, rating: 4.8, total_minutes: 2500, total_earnings: 50000 }, cfg)).toBe(5);
  });

  it('does not promote when a single metric is just below the threshold', () => {
    // Minutes + earnings satisfy level 5, but rating 4.7 < 4.8 -> caps at level 4 (needs 4.6).
    expect(evaluateLevel({ review_count: 1000, rating: 4.7, total_minutes: 2500, total_earnings: 50000 }, cfg)).toBe(4);
    // enough calls for level 2 but rating below 4.0 -> stays level 1
    expect(evaluateLevel({ review_count: 60, rating: 3.9, total_minutes: 50, total_earnings: 500 }, cfg)).toBe(1);
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
    expect(evaluateLevel({ review_count: 1000, rating: 4.8, total_minutes: 2500, total_earnings: 50000 }, out)).toBe(3);
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
    // Highest rung whose thresholds are met should now reach level 7. Rungs 6
    // & 7 omit min_minutes/min_earnings, so normalizeLevelConfig backfills them
    // from generateLevelDefault (level 7 → 7500 min / 150000 earnings); supply
    // stats that clear those synthesized thresholds too.
    expect(evaluateLevel({ review_count: 5000, rating: 5, total_minutes: 7500, total_earnings: 150000 }, out)).toBe(7);
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
    // Seeded defaults — keep in sync with DEFAULT_LEVEL_CONFIG. Random-call
    // rates now default to the standard 25/40 across all levels so random
    // calls bill at the same advertised rate as direct calls (admins can still
    // tune per level).
    expect(getRandomAudioRate(1, DEFAULT_LEVEL_CONFIG)).toBe(25);
    expect(getRandomVideoRate(1, DEFAULT_LEVEL_CONFIG)).toBe(40);
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


// ============================================================================
// Flexible N-criteria engine (v2)
// ============================================================================
import {
  METRIC_REGISTRY,
  RECOMMENDED_LEVEL_CONFIG,
  resolveMetricValue,
  computeLevelProgress,
  countLanguages,
  type Criterion,
} from '../src/lib/levels';

// A tiny ladder builder: level 1 floor + one gated rung with arbitrary
// criteria. The legacy min_* fields are zeroed on the gated rung so an EMPTY
// criteria array truly means "no gates" (otherwise normalizeLevelConfig would
// synthesize the classic criteria from the spread legacy fields).
function ladderWith(criteria: Criterion[]) {
  return normalizeLevelConfig([
    { ...DEFAULT_LEVEL_CONFIG[0], criteria: [] },
    { ...DEFAULT_LEVEL_CONFIG[1], min_calls: 0, min_rating: 0, min_minutes: 0, min_earnings: 0, criteria },
  ]);
}

describe('METRIC_REGISTRY', () => {
  it('exposes the ten supported metrics with unique keys', () => {
    const keys = METRIC_REGISTRY.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('unique_callers');
    expect(keys).toContain('answer_rate');
    expect(keys).toContain('favorite_count');
    expect(keys).toContain('streak_max');
    expect(keys).toContain('tenure_days');
    expect(keys).toContain('kyc_verified');
  });
});

describe('resolveMetricValue — derived metrics', () => {
  it('answer_rate = answered / incoming, clamped to 1, and 1 when no incoming', () => {
    expect(resolveMetricValue({ review_count: 0, rating: 0, answered_calls: 85, incoming_calls: 100 }, 'answer_rate')).toBeCloseTo(0.85);
    expect(resolveMetricValue({ review_count: 0, rating: 0, answered_calls: 0, incoming_calls: 0 }, 'answer_rate')).toBe(1);
    expect(resolveMetricValue({ review_count: 0, rating: 0, answered_calls: 200, incoming_calls: 100 }, 'answer_rate')).toBe(1);
  });

  it('tenure_days = whole days since created_at (using the `now` override)', () => {
    const now = 1_000_000_000;
    const created = now - 30 * 86400;
    expect(resolveMetricValue({ review_count: 0, rating: 0, created_at: created, now }, 'tenure_days')).toBe(30);
    expect(resolveMetricValue({ review_count: 0, rating: 0, now }, 'tenure_days')).toBe(0);
  });

  it('kyc_verified normalizes identity_verified to 0/1', () => {
    expect(resolveMetricValue({ review_count: 0, rating: 0, identity_verified: 1 }, 'kyc_verified')).toBe(1);
    expect(resolveMetricValue({ review_count: 0, rating: 0, identity_verified: 0 }, 'kyc_verified')).toBe(0);
  });
});

describe('evaluateLevel — arbitrary criteria', () => {
  it('gates on a single non-classic metric (unique_callers)', () => {
    const cfg = ladderWith([{ metric: 'unique_callers', op: '>=', value: 30 }]);
    expect(evaluateLevel({ review_count: 999, rating: 5, unique_callers: 29 }, cfg)).toBe(1);
    expect(evaluateLevel({ review_count: 0, rating: 0, unique_callers: 30 }, cfg)).toBe(2);
  });

  it('requires ALL criteria across mixed metric types', () => {
    const cfg = ladderWith([
      { metric: 'review_count', op: '>=', value: 100 },
      { metric: 'answer_rate', op: '>=', value: 0.8 },
      { metric: 'kyc_verified', op: '==', value: 1 },
    ]);
    // KYC missing → stays level 1
    expect(evaluateLevel({ review_count: 100, rating: 0, answered_calls: 90, incoming_calls: 100, identity_verified: 0 }, cfg)).toBe(1);
    // All three satisfied → promoted
    expect(evaluateLevel({ review_count: 100, rating: 0, answered_calls: 90, incoming_calls: 100, identity_verified: 1 }, cfg)).toBe(2);
  });

  it('an == criterion is exact, not a floor', () => {
    const cfg = ladderWith([{ metric: 'kyc_verified', op: '==', value: 1 }]);
    expect(evaluateLevel({ review_count: 0, rating: 0, identity_verified: 1 }, cfg)).toBe(2);
    expect(evaluateLevel({ review_count: 0, rating: 0, identity_verified: 0 }, cfg)).toBe(1);
  });

  it('a rung with zero criteria is reachable by anyone', () => {
    const cfg = ladderWith([]);
    expect(evaluateLevel({ review_count: 0, rating: 0 }, cfg)).toBe(2);
  });
});

describe('normalizeLevelConfig — criteria validation', () => {
  it('drops criteria referencing unknown metrics and clamps values by kind', () => {
    const out = normalizeLevelConfig([
      { ...DEFAULT_LEVEL_CONFIG[0], criteria: [] },
      {
        ...DEFAULT_LEVEL_CONFIG[1],
        criteria: [
          { metric: 'bogus_metric', op: '>=', value: 5 },        // dropped
          { metric: 'rating', op: '>=', value: 9 },               // clamped to 5
          { metric: 'answer_rate', op: '>=', value: 250 },        // 250 → treated as % → 1.0
          { metric: 'kyc_verified', op: '>=', value: 3 },         // bool → 1
          { metric: 'unique_callers', op: '>=', value: 12.9 },    // int floor → 12
        ],
      },
    ]);
    const crit = out[1].criteria;
    expect(crit.find((c) => c.metric === ('bogus_metric' as any))).toBeUndefined();
    expect(crit.find((c) => c.metric === 'rating')!.value).toBe(5);
    expect(crit.find((c) => c.metric === 'answer_rate')!.value).toBe(1);
    expect(crit.find((c) => c.metric === 'kyc_verified')!.value).toBe(1);
    expect(crit.find((c) => c.metric === 'unique_callers')!.value).toBe(12);
  });

  it('accepts a 0–1 fraction for percent metrics as-is', () => {
    const out = normalizeLevelConfig([
      { ...DEFAULT_LEVEL_CONFIG[0], criteria: [] },
      { ...DEFAULT_LEVEL_CONFIG[1], criteria: [{ metric: 'answer_rate', op: '>=', value: 0.85 }] },
    ]);
    expect(out[1].criteria[0].value).toBeCloseTo(0.85);
  });

  it('de-duplicates repeated metrics on a rung (last wins)', () => {
    const out = normalizeLevelConfig([
      { ...DEFAULT_LEVEL_CONFIG[0], criteria: [] },
      { ...DEFAULT_LEVEL_CONFIG[1], criteria: [
        { metric: 'review_count', op: '>=', value: 50 },
        { metric: 'review_count', op: '>=', value: 99 },
      ] },
    ]);
    const rc = out[1].criteria.filter((c) => c.metric === 'review_count');
    expect(rc).toHaveLength(1);
    expect(rc[0].value).toBe(99);
  });

  it('mirrors the classic legacy min_* fields from the effective criteria', () => {
    const out = normalizeLevelConfig([
      { ...DEFAULT_LEVEL_CONFIG[0], criteria: [] },
      { ...DEFAULT_LEVEL_CONFIG[1], criteria: [
        { metric: 'review_count', op: '>=', value: 120 },
        { metric: 'rating', op: '>=', value: 4.2 },
        { metric: 'unique_callers', op: '>=', value: 40 },
      ] },
    ]);
    expect(out[1].min_calls).toBe(120);
    expect(out[1].min_rating).toBe(4.2);
    // No total_minutes / total_earnings criterion → legacy mirrors are 0.
    expect(out[1].min_minutes).toBe(0);
    expect(out[1].min_earnings).toBe(0);
  });

  it('synthesizes criteria from legacy min_* when no criteria array is present (pre-v2 config)', () => {
    const out = normalizeLevelConfig([
      { level: 1, name: 'A', badge: '', color: '', min_calls: 0, min_rating: 0, min_minutes: 0, min_earnings: 0, coin_reward: 0, description: '', perks: DEFAULT_LEVEL_CONFIG[0].perks },
      { level: 2, name: 'B', badge: '', color: '', min_calls: 50, min_rating: 4, min_minutes: 50, min_earnings: 500, coin_reward: 100, description: '', perks: DEFAULT_LEVEL_CONFIG[1].perks },
    ] as any);
    expect(out[1].criteria).toEqual([
      { metric: 'review_count', op: '>=', value: 50 },
      { metric: 'rating', op: '>=', value: 4 },
      { metric: 'total_minutes', op: '>=', value: 50 },
      { metric: 'total_earnings', op: '>=', value: 500 },
    ]);
  });
});

describe('computeLevelProgress — generic criteria breakdown', () => {
  it('reports per-criterion progress and gates overall % on the slowest one', () => {
    const cfg = ladderWith([
      { metric: 'review_count', op: '>=', value: 100 },
      { metric: 'unique_callers', op: '>=', value: 50 },
    ]);
    const p = computeLevelProgress({ review_count: 100, rating: 0, unique_callers: 25 }, cfg, 1);
    expect(p.level).toBe(1);
    expect(p.criteria).toHaveLength(2);
    const uc = p.criteria.find((c) => c.metric === 'unique_callers')!;
    expect(uc.pct).toBe(50);
    expect(uc.met).toBe(false);
    // review_count is fully met (100/100) but unique_callers only 50% → overall 50.
    expect(p.progress_pct).toBe(50);
  });

  it('keeps the classic 4 requirement keys for backward compatibility', () => {
    const cfg = ladderWith([{ metric: 'review_count', op: '>=', value: 100 }]);
    const p = computeLevelProgress({ review_count: 40, rating: 0 }, cfg, 1);
    expect(p.requirements.calls.required).toBe(100);
    expect(p.requirements.calls.current).toBe(40);
    // A metric the next rung doesn't gate on reports met=true.
    expect(p.requirements.minutes.met).toBe(true);
  });
});

describe('RECOMMENDED_LEVEL_CONFIG — richer opt-in ladder', () => {
  it('normalizes cleanly and gates high tiers on quality/trust metrics', () => {
    const cfg = normalizeLevelConfig(RECOMMENDED_LEVEL_CONFIG);
    expect(cfg).toHaveLength(5);
    // A host with huge classic stats but no unique_callers/answer_rate/KYC
    // must NOT reach Elite (level 5) — it stalls before the quality gates.
    const classicOnly = evaluateLevel(
      { review_count: 5000, rating: 5, total_minutes: 9999, total_earnings: 999999 },
      cfg,
    );
    expect(classicOnly).toBeLessThan(5);
    // Supplying the quality/trust metrics unlocks Elite (incl. online-time &
    // active-days gates added to the recommended ladder).
    const full = evaluateLevel(
      {
        review_count: 5000, rating: 5, total_minutes: 9999, total_earnings: 999999,
        unique_callers: 500, answered_calls: 950, incoming_calls: 1000,
        favorite_count: 500, streak_max: 30, identity_verified: 1,
        online_minutes: 9000, active_days: 60,
        created_at: 0, now: 400 * 86400,
      },
      cfg,
    );
    expect(full).toBe(5);
  });

  it('online-time & active-days gates block Elite until met', () => {
    const cfg = normalizeLevelConfig(RECOMMENDED_LEVEL_CONFIG);
    // Everything for Elite EXCEPT enough online-time (needs >= 6000).
    const base = {
      review_count: 5000, rating: 5, total_minutes: 9999, total_earnings: 999999,
      unique_callers: 500, answered_calls: 950, incoming_calls: 1000,
      favorite_count: 500, streak_max: 30, identity_verified: 1,
      active_days: 60, created_at: 0, now: 400 * 86400,
    };
    expect(evaluateLevel({ ...base, online_minutes: 5000 }, cfg)).toBeLessThan(5);
    expect(evaluateLevel({ ...base, online_minutes: 6000 }, cfg)).toBe(5);
  });
});

describe('resolveMetricValue — new online / derived metrics', () => {
  it('online_minutes and active_days read straight from stats', () => {
    expect(resolveMetricValue({ review_count: 0, rating: 0, online_minutes: 1250 }, 'online_minutes')).toBe(1250);
    expect(resolveMetricValue({ review_count: 0, rating: 0, active_days: 42 }, 'active_days')).toBe(42);
  });

  it('avg_call_minutes = total_minutes / answered_calls, 0 when no answered calls', () => {
    expect(resolveMetricValue({ review_count: 0, rating: 0, total_minutes: 300, answered_calls: 60 }, 'avg_call_minutes')).toBe(5);
    expect(resolveMetricValue({ review_count: 0, rating: 0, total_minutes: 300, answered_calls: 0 }, 'avg_call_minutes')).toBe(0);
  });

  it('repeat_callers = answered_calls - unique_callers, floored at 0', () => {
    expect(resolveMetricValue({ review_count: 0, rating: 0, answered_calls: 100, unique_callers: 30 }, 'repeat_callers')).toBe(70);
    expect(resolveMetricValue({ review_count: 0, rating: 0, answered_calls: 20, unique_callers: 50 }, 'repeat_callers')).toBe(0);
  });

  it('evaluateLevel can gate on a derived metric (avg_call_minutes)', () => {
    const cfg = ladderWith([{ metric: 'avg_call_minutes', op: '>=', value: 8 }]);
    expect(evaluateLevel({ review_count: 0, rating: 0, total_minutes: 350, answered_calls: 50 }, cfg)).toBe(1); // avg 7 < 8
    expect(evaluateLevel({ review_count: 0, rating: 0, total_minutes: 400, answered_calls: 50 }, cfg)).toBe(2); // avg 8 >= 8
  });
});

describe('resolveMetricValue — gift / referral / language metrics', () => {
  it('gifts_received and successful_referrals read straight from stats', () => {
    expect(resolveMetricValue({ review_count: 0, rating: 0, gifts_received: 120 }, 'gifts_received')).toBe(120);
    expect(resolveMetricValue({ review_count: 0, rating: 0, successful_referrals: 7 }, 'successful_referrals')).toBe(7);
  });

  it('languages_count reads the derived value from stats', () => {
    expect(resolveMetricValue({ review_count: 0, rating: 0, languages_count: 3 }, 'languages_count')).toBe(3);
    expect(resolveMetricValue({ review_count: 0, rating: 0 }, 'languages_count')).toBe(0);
  });

  it('evaluateLevel can gate on gifts_received / successful_referrals / languages_count', () => {
    const cfg = ladderWith([
      { metric: 'gifts_received', op: '>=', value: 50 },
      { metric: 'successful_referrals', op: '>=', value: 3 },
      { metric: 'languages_count', op: '>=', value: 2 },
    ]);
    expect(evaluateLevel({ review_count: 0, rating: 0, gifts_received: 50, successful_referrals: 3, languages_count: 1 }, cfg)).toBe(1);
    expect(evaluateLevel({ review_count: 0, rating: 0, gifts_received: 50, successful_referrals: 3, languages_count: 2 }, cfg)).toBe(2);
  });
});

describe('countLanguages', () => {
  it('counts distinct non-empty languages from a JSON array string', () => {
    expect(countLanguages('["English","Hindi","Tamil"]')).toBe(3);
    expect(countLanguages('["English","english"," English "]')).toBe(1); // case/trim dedupe
    expect(countLanguages('[]')).toBe(0);
  });

  it('tolerates null / malformed values', () => {
    expect(countLanguages(null)).toBe(0);
    expect(countLanguages(undefined)).toBe(0);
    expect(countLanguages('not json')).toBe(0);
    expect(countLanguages('{"a":1}')).toBe(0);
  });
});
