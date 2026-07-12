// ============================================================================
// Availability Prediction engine
// ============================================================================
//
// `lib/availability.ts` answers "is this host inside the window they MANUALLY
// configured right now?". This module answers a different, data-driven
// question: "based on when this host has ACTUALLY been active historically,
// how likely are they to be online right now / soon, and when do they usually
// come online?".
//
// It learns each host's typical activity hours from their recent call history
// (call_sessions.created_at, bucketed by hour-of-day in the host's timezone).
// From that histogram we derive:
//
//   • likelihood_now   — P(active | this hour), 0..1, smoothed.
//   • usually_online    — likelihood_now >= an admin threshold.
//   • peak_hours        — the host's top active hours (for "usually online at 8 PM").
//   • next_active_hour  — the nearest upcoming peak hour when offline now.
//
// Powers soft home-screen nudges ("Usually online now", "Back around 8 PM")
// WITHOUT falsely claiming a host is live — it's a probability, not presence.
// DEFAULT OFF (availability_predict_enabled=0). Pure histogram maths are
// exported for unit testing.
// ============================================================================

import { minutesOfDayInTz } from './availability';
import type { Env } from '../types';

/** A 24-slot histogram: index = hour-of-day, value = activity count. */
export type HourHistogram = number[];

export interface AvailabilityPrediction {
  enabled: boolean;
  /** Smoothed P(active | current hour), 0..1. */
  likelihood_now: number;
  /** likelihood_now >= threshold. */
  usually_online: boolean;
  /** Top active hours (0..23), most-active first. */
  peak_hours: number[];
  /** Nearest upcoming peak hour (0..23) or null when insufficient data. */
  next_active_hour: number | null;
  /** Total samples the prediction is based on (low = low confidence). */
  sample_count: number;
  /** Short human label for the UI. */
  label: string;
}

const NO_PREDICTION: AvailabilityPrediction = {
  enabled: false,
  likelihood_now: 0,
  usually_online: false,
  peak_hours: [],
  next_active_hour: null,
  sample_count: 0,
  label: '',
};

/** Build a 24-slot histogram from a list of hour-of-day observations. */
export function buildHistogram(hours: number[]): HourHistogram {
  const hist = new Array(24).fill(0);
  for (const h of hours) {
    const hr = Math.floor(h);
    if (hr >= 0 && hr < 24) hist[hr] += 1;
  }
  return hist;
}

/**
 * Smoothed likelihood for a given hour: blends the exact hour with its two
 * neighbours (activity rarely respects a hard hour boundary) and applies
 * add-one (Laplace) smoothing against the busiest hour so a host with only a
 * handful of samples doesn't jump to 1.0.
 */
export function likelihoodAtHour(hist: HourHistogram, hour: number): number {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const at = (h: number) => hist[((h % 24) + 24) % 24] || 0;
  // Neighbour-weighted local activity (center weighted double).
  const local = at(hour - 1) * 0.5 + at(hour) * 1 + at(hour + 1) * 0.5;
  const peak = Math.max(...hist);
  // Normalize against the peak hour with Laplace smoothing.
  return Math.min(1, (local + 1) / (peak * 2 + 1));
}

/** Top `n` active hours, most-active first. Ties broken by earlier hour. */
export function peakHours(hist: HourHistogram, n = 3): number[] {
  return hist
    .map((count, hour) => ({ hour, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour)
    .slice(0, n)
    .map((x) => x.hour);
}

/** Nearest upcoming peak hour from `nowHour` (wraps past midnight). */
export function nextActiveHour(peaks: number[], nowHour: number): number | null {
  if (!peaks.length) return null;
  const sorted = [...peaks].sort((a, b) => a - b);
  const ahead = sorted.find((h) => h > nowHour);
  return ahead ?? sorted[0]; // wrap to tomorrow's earliest peak
}

function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const hr12 = h % 12 === 0 ? 12 : h % 12;
  return `${hr12} ${period}`;
}

/** Turn the numeric prediction into a friendly UI label. */
export function predictionLabel(p: Omit<AvailabilityPrediction, 'label' | 'enabled'>): string {
  if (p.sample_count < 3) return '';
  if (p.usually_online) return 'Usually online now';
  if (p.next_active_hour != null) return `Usually online around ${hourLabel(p.next_active_hour)}`;
  return '';
}

/**
 * Pure predictor: given the host's hour observations + the current hour, return
 * a full prediction. `threshold` is the P(active) above which we say
 * "usually online now".
 */
export function predictFromHours(
  hours: number[],
  nowHour: number,
  threshold: number,
): AvailabilityPrediction {
  const hist = buildHistogram(hours);
  const sampleCount = hours.length;
  const likelihood = likelihoodAtHour(hist, nowHour);
  const peaks = peakHours(hist, 3);
  const usuallyOnline = sampleCount >= 3 && likelihood >= threshold;
  const base = {
    likelihood_now: Math.round(likelihood * 100) / 100,
    usually_online: usuallyOnline,
    peak_hours: peaks,
    next_active_hour: usuallyOnline ? null : nextActiveHour(peaks, nowHour),
    sample_count: sampleCount,
  };
  return { enabled: true, ...base, label: predictionLabel(base) };
}

async function readBool(db: D1Database, key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallback;
    return row.value !== '0' && row.value.toLowerCase() !== 'false';
  } catch { return fallback; }
}
async function readFloat(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseFloat(row?.value ?? '');
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}
async function readInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch { return fallback; }
}

/**
 * Predict availability for one host. Reads their recent call history + timezone
 * and runs the pure predictor. Returns a disabled result when the flag is off
 * or on any error (never throws on a hot path).
 */
export async function predictHostAvailability(env: Env, hostId: string): Promise<AvailabilityPrediction> {
  try {
    const db = env.DB;
    if (!(await readBool(db, 'availability_predict_enabled', false))) return NO_PREDICTION;

    const lookbackDays = Math.max(7, await readInt(db, 'availability_predict_lookback_days', 30));
    const threshold = Math.min(1, Math.max(0, await readFloat(db, 'availability_predict_threshold', 0.5)));
    const cutoff = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

    // Host timezone (best-effort; UTC fallback handled by minutesOfDayInTz).
    const hostRow = await db
      .prepare('SELECT timezone FROM hosts WHERE id = ?')
      .bind(hostId)
      .first<{ timezone: string | null }>()
      .catch(() => null);
    const tz = hostRow?.timezone ?? null;

    // Recent call timestamps for this host (bounded).
    const rows = await db
      .prepare('SELECT created_at FROM call_sessions WHERE host_id = ? AND created_at > ? LIMIT 2000')
      .bind(hostId, cutoff)
      .all<{ created_at: number }>();

    const hours = (rows.results ?? []).map((r) => {
      // Convert each timestamp to hour-of-day in the host's timezone.
      const minutes = minutesOfDayInTz(tz, new Date(Number(r.created_at) * 1000));
      return Math.floor(minutes / 60);
    });

    const nowHour = Math.floor(minutesOfDayInTz(tz) / 60);
    return predictFromHours(hours, nowHour, threshold);
  } catch (e) {
    console.warn('[availabilityPredict] predictHostAvailability failed for', hostId, e);
    return NO_PREDICTION;
  }
}
