import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INSTANT_WEIGHTS,
  normalizeInstantWeights,
  scoreInstantCandidate,
  pickBestInstant,
  estimateWaitSeconds,
  decideInstant,
  type InstantCandidate,
} from '../src/lib/instantConnect';

const NOW = 1_700_000_000;

function candidate(over: Partial<InstantCandidate>): InstantCandidate {
  return {
    host_id: 'h',
    is_online: true,
    rating: 5,
    review_count: 20,
    created_at: NOW - 100 * 86400,
    rank_boost_norm: 0.5,
    past_calls: 0,
    is_favorite: false,
    recent_matches: 0,
    ...over,
  };
}

describe('normalizeInstantWeights', () => {
  it('returns defaults for bad input and clamps negatives', () => {
    expect(normalizeInstantWeights(null)).toEqual(DEFAULT_INSTANT_WEIGHTS);
    expect(normalizeInstantWeights({ affinity: -3 }).affinity).toBe(DEFAULT_INSTANT_WEIGHTS.affinity);
  });
});

describe('scoreInstantCandidate', () => {
  it('scores a favorite higher than an identical non-favorite', () => {
    const fav = scoreInstantCandidate(candidate({ is_favorite: true }), DEFAULT_INSTANT_WEIGHTS, NOW);
    const plain = scoreInstantCandidate(candidate({ is_favorite: false }), DEFAULT_INSTANT_WEIGHTS, NOW);
    expect(fav).toBeGreaterThan(plain);
  });

  it('penalizes a heavily-loaded host', () => {
    const light = scoreInstantCandidate(candidate({ recent_matches: 0 }), DEFAULT_INSTANT_WEIGHTS, NOW);
    const heavy = scoreInstantCandidate(candidate({ recent_matches: 12 }), DEFAULT_INSTANT_WEIGHTS, NOW);
    expect(heavy).toBeLessThan(light);
  });
});

describe('pickBestInstant', () => {
  it('never picks an offline host', () => {
    const best = pickBestInstant(
      [candidate({ host_id: 'off', is_online: false, rating: 5, is_favorite: true })],
      DEFAULT_INSTANT_WEIGHTS,
      NOW,
    );
    expect(best.host_id).toBeNull();
  });

  it('picks the highest-scoring online host', () => {
    const best = pickBestInstant(
      [
        candidate({ host_id: 'a', is_favorite: false }),
        candidate({ host_id: 'b', is_favorite: true }),
      ],
      DEFAULT_INSTANT_WEIGHTS,
      NOW,
    );
    expect(best.host_id).toBe('b');
  });
});

describe('estimateWaitSeconds', () => {
  it('returns the cap when nobody is expected online', () => {
    expect(estimateWaitSeconds(0, 300)).toBe(300);
  });
  it('shrinks as expected supply grows and clamps to [10, max]', () => {
    expect(estimateWaitSeconds(1)).toBe(60);
    expect(estimateWaitSeconds(2)).toBe(30);
    expect(estimateWaitSeconds(100)).toBe(10); // clamped to floor
  });
});

describe('decideInstant', () => {
  it('matches immediately when an online host exists', () => {
    const d = decideInstant([candidate({ host_id: 'a' })], DEFAULT_INSTANT_WEIGHTS, {
      now: NOW,
      poolLikelihood: 0,
    });
    expect(d.matched).toBe(true);
    expect(d.host_id).toBe('a');
    expect(d.wait_seconds).toBe(0);
  });

  it('returns a queued ETA when no host is online', () => {
    const d = decideInstant([], DEFAULT_INSTANT_WEIGHTS, { now: NOW, poolLikelihood: 2, queuePosition: 3 });
    expect(d.matched).toBe(false);
    expect(d.host_id).toBeNull();
    expect(d.wait_seconds).toBe(30);
    expect(d.queue_position).toBe(3);
    expect(d.reason).toContain('min');
  });
});
