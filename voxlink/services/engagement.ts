// ============================================================================
// Engagement logger — client-side batching queue for impression/click events.
// ============================================================================
//
// The home feed + recommended rail emit a lot of small events (one impression
// per visible host, a click per tap). Sending each as its own request would be
// wasteful and could jank the UI, so we buffer them in memory and flush in
// batches to POST /api/engagement/events (see routes/engagement.ts).
//
// Principles:
//   • NEVER blocks or throws into the UI — analytics is best-effort. Every
//     failure path silently drops the batch.
//   • Bounded memory: the queue is capped; oldest events are discarded if it
//     overflows (e.g. offline for a long time).
//   • Flushes on three triggers: queue reaches FLUSH_AT, a periodic timer, or
//     the app going to background (so we don't lose the session's tail).
//   • Per-session impression de-dup so a host scrolled past repeatedly only
//     logs one impression per surface.
//
// Server-side: the endpoint is feature-flagged + rate-limited + validated, so
// the client stays dumb and trusting on purpose.

import { AppState } from 'react-native';
import { API } from './api';

export interface EngagementEvent {
  /** Allow-listed on the server: reco_impression | reco_click | host_impression | host_click | banner_click | call_start | call_complete */
  type: string;
  host_id?: string;
  /** Where it happened: home_reco | home_top | search | random | banner */
  surface?: string;
  /** Optional model score at impression time. */
  score?: number;
  /** Optional small context blob. */
  meta?: Record<string, unknown>;
  /** Unix seconds; defaulted to now if omitted. */
  ts?: number;
}

const MAX_QUEUE = 100;
const FLUSH_AT = 20;
const FLUSH_INTERVAL_MS = 10_000;
const MAX_PER_FLUSH = 50; // mirror server MAX_BATCH

const queue: EngagementEvent[] = [];
const seenImpressions = new Set<string>();
let started = false;
let flushing = false;

/** Send up to MAX_PER_FLUSH queued events. Silently drops on any error. */
async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, MAX_PER_FLUSH);
  try {
    await API.logEngagementEvents(batch);
  } catch {
    // Best-effort analytics: drop the batch rather than retry-storm. (If we
    // re-queued on every failure an offline device would grow unbounded.)
  } finally {
    flushing = false;
  }
}

/** Lazily start the periodic flush + background-flush listener (once). */
function ensureStarted(): void {
  if (started) return;
  started = true;
  setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
  try {
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
  } catch {
    /* AppState unavailable (e.g. SSR/web prerender) — periodic flush still works */
  }
}

/** Queue an engagement event. Non-blocking; safe to call from render/handlers. */
export function logEngagement(ev: EngagementEvent): void {
  if (!ev?.type) return;
  queue.push({ ...ev, ts: ev.ts ?? Math.floor(Date.now() / 1000) });
  // Cap memory: discard oldest if we overflow (e.g. long offline stretch).
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (queue.length >= FLUSH_AT) void flush();
  ensureStarted();
}

/**
 * Log a host impression at most once per (surface, host) per app session.
 * Prevents a host that's repeatedly scrolled into view from inflating the
 * impression count (which would deflate CTR).
 */
export function logImpressionOnce(
  hostId: string,
  surface: string,
  opts: { type?: 'reco_impression' | 'host_impression'; score?: number } = {},
): void {
  if (!hostId) return;
  const key = `${surface}:${hostId}`;
  if (seenImpressions.has(key)) return;
  seenImpressions.add(key);
  logEngagement({ type: opts.type ?? 'reco_impression', host_id: hostId, surface, score: opts.score });
}

/** Reset per-session impression de-dup (e.g. on logout / account switch). */
export function resetEngagementSession(): void {
  seenImpressions.clear();
  queue.length = 0;
}
