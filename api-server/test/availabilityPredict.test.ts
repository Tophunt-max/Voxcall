import { describe, it, expect } from 'vitest';
import {
  buildHistogram,
  likelihoodAtHour,
  peakHours,
  nextActiveHour,
  predictFromHours,
} from '../src/lib/availabilityPredict';

describe('buildHistogram', () => {
  it('buckets hours into a 24-slot histogram', () => {
    const h = buildHistogram([1, 1, 2, 23]);
    expect(h.length).toBe(24);
    expect(h[1]).toBe(2);
    expect(h[2]).toBe(1);
    expect(h[23]).toBe(1);
    expect(h[0]).toBe(0);
  });

  it('ignores out-of-range hours', () => {
    const h = buildHistogram([-1, 24, 5]);
    expect(h[5]).toBe(1);
    expect(h.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('likelihoodAtHour', () => {
  it('is 0 for an empty histogram', () => {
    expect(likelihoodAtHour(new Array(24).fill(0), 12)).toBe(0);
  });

  it('is higher near active hours than far from them', () => {
    const h = buildHistogram(Array(10).fill(20));
    expect(likelihoodAtHour(h, 20)).toBeGreaterThan(likelihoodAtHour(h, 4));
  });
});

describe('peakHours / nextActiveHour', () => {
  it('returns the busiest hours, most-active first', () => {
    const h = buildHistogram([8, 8, 8, 20, 20, 3]);
    expect(peakHours(h, 2)).toEqual([8, 20]);
  });

  it('finds the nearest upcoming peak and wraps past midnight', () => {
    expect(nextActiveHour([8, 20], 15)).toBe(20);
    expect(nextActiveHour([8, 20], 22)).toBe(8); // wrap to next day
    expect(nextActiveHour([], 10)).toBeNull();
  });
});

describe('predictFromHours', () => {
  it('marks a host usually-online now when the current hour is a strong peak', () => {
    const p = predictFromHours(Array(10).fill(20), 20, 0.5);
    expect(p.enabled).toBe(true);
    expect(p.usually_online).toBe(true);
    expect(p.label).toBe('Usually online now');
  });

  it('stays quiet (no label) with too few samples', () => {
    const p = predictFromHours([20, 20], 20, 0.5);
    expect(p.usually_online).toBe(false);
    expect(p.label).toBe('');
    expect(p.sample_count).toBe(2);
  });

  it('suggests the next active hour when offline-ish at the current hour', () => {
    const p = predictFromHours([8, 8, 8, 8, 8, 20], 15, 0.5);
    expect(p.usually_online).toBe(false);
    expect(p.next_active_hour).toBe(20);
    expect(p.label).toContain('Usually online around');
  });
});
