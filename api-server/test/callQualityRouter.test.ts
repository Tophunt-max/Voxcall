import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  normalizeThresholds,
  recommendMediaProfile,
  sessionQualityScore,
  hostQualityPenalty,
} from '../src/lib/callQualityRouter';

describe('normalizeThresholds', () => {
  it('returns defaults for bad input and ignores non-positive values', () => {
    expect(normalizeThresholds(null)).toEqual(DEFAULT_QUALITY_THRESHOLDS);
    expect(normalizeThresholds({ loss_degrade_pct: 0 }).loss_degrade_pct).toBe(DEFAULT_QUALITY_THRESHOLDS.loss_degrade_pct);
    expect(normalizeThresholds({ loss_degrade_pct: 8 }).loss_degrade_pct).toBe(8);
  });
});

describe('recommendMediaProfile', () => {
  it('keeps the current profile on a healthy network', () => {
    expect(recommendMediaProfile({ jitter_ms: 5, packet_loss_pct: 0, rtt_ms: 50 }, 'hd')).toBe('hd');
  });

  it('drops straight to audio on catastrophic loss', () => {
    expect(recommendMediaProfile({ jitter_ms: 0, packet_loss_pct: 20, rtt_ms: 0 }, 'fhd')).toBe('audio');
  });

  it('drops one tier for a single degraded metric', () => {
    expect(recommendMediaProfile({ jitter_ms: 0, packet_loss_pct: 6, rtt_ms: 0 }, 'fhd')).toBe('hd');
  });

  it('drops multiple tiers when several metrics degrade', () => {
    expect(recommendMediaProfile({ jitter_ms: 50, packet_loss_pct: 6, rtt_ms: 0 }, 'fhd')).toBe('sd');
  });

  it('never drops below audio', () => {
    expect(recommendMediaProfile({ jitter_ms: 999, packet_loss_pct: 12, rtt_ms: 999 }, 'sd')).toBe('audio');
  });
});

describe('sessionQualityScore', () => {
  it('is 1 for a perfect call and lower for a bad one', () => {
    expect(sessionQualityScore({ jitter_ms: 0, packet_loss_pct: 0, rtt_ms: 0 })).toBe(1);
    const bad = sessionQualityScore({ jitter_ms: 60, packet_loss_pct: 10, rtt_ms: 400 });
    expect(bad).toBeGreaterThanOrEqual(0);
    expect(bad).toBeLessThan(1);
  });
});

describe('hostQualityPenalty', () => {
  it('is 0 below the minimum sample count', () => {
    expect(hostQualityPenalty(0.2, 3, { minSamples: 5 })).toBe(0);
  });

  it('penalizes poor quality up to the cap', () => {
    expect(hostQualityPenalty(0.5, 10, { minSamples: 5, maxPenalty: 0.3 })).toBeCloseTo(0.15, 5);
    expect(hostQualityPenalty(0, 10, { minSamples: 5, maxPenalty: 0.3 })).toBe(0.3);
  });

  it('gives no penalty to a perfect-quality host', () => {
    expect(hostQualityPenalty(1, 50)).toBe(0);
  });
});
