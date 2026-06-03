import { describe, it, expect } from 'vitest';
import {
  normalizeWeights,
  scoreHost,
  scoreHosts,
  DEFAULT_WEIGHTS,
  type CandidateHost,
  type UserAffinity,
} from '../src/lib/recommend';
import { DEFAULT_LEVEL_CONFIG, type LevelDef } from '../src/lib/levels';

const NOW = 1700000000;
const config: LevelDef[] = DEFAULT_LEVEL_CONFIG;

function makeHost(overrides: Partial<CandidateHost> = {}): CandidateHost {
  return {
    id: 'host-1',
    user_id: 'user-1',
    level: 1,
    rating: 4.0,
    review_count: 20,
    is_online: 1,
    created_at: NOW - 86400 * 60,
    gender: null,
    languages: ['english'],
    specialties: ['music'],
    ...overrides,
  };
}

function makeAffinity(overrides: Partial<UserAffinity> = {}): UserAffinity {
  return {
    favoriteHostIds: new Set(),
    callCountByHost: new Map(),
    preferredLanguages: new Set(),
    preferredSpecialties: new Set(),
    preferredGender: null,
    ...overrides,
  };
}

describe('normalizeWeights', () => {
  it('returns defaults for null/undefined/non-object input', () => {
    expect(normalizeWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights(undefined)).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights(42)).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights([1, 2])).toEqual(DEFAULT_WEIGHTS);
  });

  it('overrides valid fields', () => {
    const result = normalizeWeights({ online: 2.0, rating: 0 });
    expect(result.online).toBe(2.0);
    expect(result.rating).toBe(0);
    expect(result.rank_boost).toBe(DEFAULT_WEIGHTS.rank_boost);
  });

  it('ignores invalid values (negative, NaN, Infinity)', () => {
    const result = normalizeWeights({ online: -1, rating: NaN, rank_boost: Infinity });
    expect(result.online).toBe(DEFAULT_WEIGHTS.online);
    expect(result.rating).toBe(DEFAULT_WEIGHTS.rating);
    expect(result.rank_boost).toBe(DEFAULT_WEIGHTS.rank_boost);
  });
});

describe('scoreHost', () => {
  it('produces a positive score for a standard host', () => {
    const host = makeHost();
    const affinity = makeAffinity();
    const result = scoreHost(host, affinity, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    expect(result.score).toBeGreaterThan(0);
    expect(result.host).toBe(host);
    expect(typeof result.reason).toBe('string');
    expect(result.breakdown).toBeDefined();
  });

  it('boosts score when host is a favorite', () => {
    const host = makeHost({ id: 'host-fav' });
    const affinity = makeAffinity({ favoriteHostIds: new Set(['host-fav']) });
    const affinityNone = makeAffinity();

    const scoreFav = scoreHost(host, affinity, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    const scoreNone = scoreHost(host, affinityNone, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    expect(scoreFav.score).toBeGreaterThan(scoreNone.score);
    expect(scoreFav.reason).toBe('One of your favorites');
  });

  it('boosts score for hosts the user has called before', () => {
    const host = makeHost({ id: 'host-past' });
    const affinity = makeAffinity({
      callCountByHost: new Map([['host-past', 5]]),
    });
    const affinityNone = makeAffinity();

    const scorePast = scoreHost(host, affinity, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    const scoreNone = scoreHost(host, affinityNone, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    expect(scorePast.score).toBeGreaterThan(scoreNone.score);
  });

  it('boosts freshness for new hosts with few reviews', () => {
    const newHost = makeHost({ created_at: NOW - 86400 * 3, review_count: 1 });
    const oldHost = makeHost({ created_at: NOW - 86400 * 60, review_count: 100 });
    const affinity = makeAffinity();

    const scoreNew = scoreHost(newHost, affinity, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    const scoreOld = scoreHost(oldHost, affinity, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    expect(scoreNew.breakdown.freshness).toBeGreaterThan(scoreOld.breakdown.freshness);
  });

  it('gives online hosts a higher online signal', () => {
    const online = makeHost({ is_online: 1 });
    const offline = makeHost({ is_online: 0 });
    const affinity = makeAffinity();

    const scoreOn = scoreHost(online, affinity, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    const scoreOff = scoreHost(offline, affinity, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    expect(scoreOn.breakdown.online).toBeGreaterThan(scoreOff.breakdown.online);
  });

  it('boosts score for language overlap', () => {
    const host = makeHost({ languages: ['hindi', 'english'] });
    const affinityMatch = makeAffinity({ preferredLanguages: new Set(['hindi']) });
    const affinityNone = makeAffinity({ preferredLanguages: new Set(['french']) });

    const scoreMatch = scoreHost(host, affinityMatch, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    const scoreMiss = scoreHost(host, affinityNone, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    expect(scoreMatch.score).toBeGreaterThan(scoreMiss.score);
  });

  it('returns a reason string for the top signal', () => {
    const host = makeHost({ rating: 4.8, is_online: 0 });
    const affinity = makeAffinity();
    const result = scoreHost(host, affinity, DEFAULT_WEIGHTS, config, { now: NOW, seed: 0 });
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('scoreHosts', () => {
  it('returns an empty array for an empty candidate list', () => {
    const result = scoreHosts([], makeAffinity(), DEFAULT_WEIGHTS, config, { now: NOW });
    expect(result).toEqual([]);
  });

  it('sorts online hosts before offline hosts', () => {
    const hosts = [
      makeHost({ id: 'offline-1', is_online: 0, rating: 5.0 }),
      makeHost({ id: 'online-1', is_online: 1, rating: 3.0 }),
    ];
    const result = scoreHosts(hosts, makeAffinity(), DEFAULT_WEIGHTS, config, { now: NOW });
    expect(result[0].host.id).toBe('online-1');
    expect(result[1].host.id).toBe('offline-1');
  });

  it('respects the limit parameter', () => {
    const hosts = Array.from({ length: 30 }, (_, i) =>
      makeHost({ id: `host-${i}`, is_online: 1 }),
    );
    const result = scoreHosts(hosts, makeAffinity(), DEFAULT_WEIGHTS, config, {
      now: NOW,
      limit: 5,
    });
    expect(result.length).toBe(5);
  });

  it('defaults to limit 20', () => {
    const hosts = Array.from({ length: 30 }, (_, i) =>
      makeHost({ id: `host-${i}`, is_online: 1 }),
    );
    const result = scoreHosts(hosts, makeAffinity(), DEFAULT_WEIGHTS, config, { now: NOW });
    expect(result.length).toBe(20);
  });

  it('sorts by score within the same online-status group', () => {
    const hosts = [
      makeHost({ id: 'low', is_online: 1, rating: 1.0, review_count: 0 }),
      makeHost({ id: 'high', is_online: 1, rating: 5.0, review_count: 500 }),
    ];
    const result = scoreHosts(hosts, makeAffinity(), DEFAULT_WEIGHTS, config, {
      now: NOW,
      seed: 0,
    });
    // Higher rated + more popular host should rank first
    expect(result[0].host.id).toBe('high');
  });
});
