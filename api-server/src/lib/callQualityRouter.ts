// ============================================================================
// Session Quality Auto-Router engine
// ============================================================================
//
// The `call_quality` table already collects per-call jitter / packet-loss /
// rtt samples (see schemaGuard.ensureCallObservabilitySchema). This module
// finally ACTS on them:
//
//   1. recommendMediaProfile() — from a live quality sample, recommend the
//      media profile the client should switch to (fhd → hd → sd → audio-only)
//      so a call degrades gracefully instead of freezing/dropping on a bad
//      network. The server sends this as a hint over the call WS.
//
//   2. sessionQualityScore() — a 0..1 quality score for a finished call's
//      aggregate metrics.
//
//   3. hostQualityPenalty() — turns a host's recent average call quality into
//      a ranking penalty (0..1) so hosts who consistently deliver poor calls
//      (often a bad-network / bad-hardware signal, not their fault, but still
//      a worse user experience) are softly demoted in discovery.
//
// All thresholds are admin-tunable; DEFAULT OFF (quality_router_enabled=0) so
// nothing changes until enabled. Pure functions only.
// ============================================================================

export type MediaProfile = 'fhd' | 'hd' | 'sd' | 'audio';

export interface QualitySample {
  jitter_ms: number;
  packet_loss_pct: number;
  rtt_ms: number;
}

export interface QualityThresholds {
  /** Above this packet loss (%) we drop a profile tier. */
  loss_degrade_pct: number;
  /** Above this jitter (ms) we drop a profile tier. */
  jitter_degrade_ms: number;
  /** Above this RTT (ms) we drop a profile tier. */
  rtt_degrade_ms: number;
  /** Extreme loss (%) → fall straight to audio-only. */
  loss_audio_only_pct: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  loss_degrade_pct: 5,
  jitter_degrade_ms: 40,
  rtt_degrade_ms: 300,
  loss_audio_only_pct: 15,
};

export function normalizeThresholds(input: unknown): QualityThresholds {
  const out: QualityThresholds = { ...DEFAULT_QUALITY_THRESHOLDS };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(DEFAULT_QUALITY_THRESHOLDS) as (keyof QualityThresholds)[]) {
      const v = Number((input as Record<string, unknown>)[key]);
      if (Number.isFinite(v) && v > 0) out[key] = v;
    }
  }
  return out;
}

const VIDEO_LADDER: MediaProfile[] = ['fhd', 'hd', 'sd', 'audio'];

/** Drop `steps` tiers down the video ladder from `current`. */
function degrade(current: MediaProfile, steps: number): MediaProfile {
  const idx = VIDEO_LADDER.indexOf(current);
  if (idx < 0) return current;
  const next = Math.min(VIDEO_LADDER.length - 1, idx + Math.max(0, steps));
  return VIDEO_LADDER[next];
}

/**
 * Recommend the media profile the client should use given a live sample and
 * the profile it is currently on. Only ever recommends a profile <= current
 * (we never upgrade mid-call on a single noisy sample — recovery is left to a
 * separate hysteresis window in the client). Returns `current` when the
 * network looks healthy.
 */
export function recommendMediaProfile(
  sample: QualitySample,
  current: MediaProfile,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): MediaProfile {
  const loss = Math.max(0, Number(sample.packet_loss_pct) || 0);
  const jitter = Math.max(0, Number(sample.jitter_ms) || 0);
  const rtt = Math.max(0, Number(sample.rtt_ms) || 0);

  // Catastrophic loss → audio-only immediately.
  if (loss >= thresholds.loss_audio_only_pct) return 'audio';

  // Count how many independent metrics are in the degrade zone; each costs a tier.
  let steps = 0;
  if (loss >= thresholds.loss_degrade_pct) steps++;
  if (jitter >= thresholds.jitter_degrade_ms) steps++;
  if (rtt >= thresholds.rtt_degrade_ms) steps++;

  return steps > 0 ? degrade(current, steps) : current;
}

/**
 * Aggregate quality score (0..1) for a finished call. 1 = perfect. Each metric
 * contributes a penalty scaled by how far past its degrade threshold it sits.
 */
export function sessionQualityScore(
  avg: QualitySample,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): number {
  const lossPen = Math.min(1, (Math.max(0, Number(avg.packet_loss_pct) || 0)) / (thresholds.loss_audio_only_pct));
  const jitterPen = Math.min(1, (Math.max(0, Number(avg.jitter_ms) || 0)) / (thresholds.jitter_degrade_ms * 3));
  const rttPen = Math.min(1, (Math.max(0, Number(avg.rtt_ms) || 0)) / (thresholds.rtt_degrade_ms * 3));
  // Weighted: packet loss hurts perceived quality most.
  const penalty = lossPen * 0.5 + jitterPen * 0.3 + rttPen * 0.2;
  return Math.max(0, 1 - penalty);
}

/**
 * Ranking penalty (0..1) for a host from their recent average call quality.
 * `avgQualityScore` is the mean of sessionQualityScore over recent calls.
 * `sampleCount` gates the penalty so a host with too little data isn't demoted.
 * `maxPenalty` caps the demotion so a bad-network stretch can't bury a host.
 */
export function hostQualityPenalty(
  avgQualityScore: number,
  sampleCount: number,
  opts: { minSamples?: number; maxPenalty?: number } = {},
): number {
  const minSamples = opts.minSamples && opts.minSamples > 0 ? opts.minSamples : 5;
  const maxPenalty = opts.maxPenalty != null ? opts.maxPenalty : 0.3;
  if (sampleCount < minSamples) return 0;
  const q = Math.max(0, Math.min(1, Number(avgQualityScore) || 0));
  // Poor quality (low q) → higher penalty, linearly, capped at maxPenalty.
  return Math.max(0, Math.min(maxPenalty, (1 - q) * maxPenalty));
}
