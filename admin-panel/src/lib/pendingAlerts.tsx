// ============================================================================
// PendingAlertsProvider — global polling for actionable admin queues.
// ============================================================================
// Polls every actionable admin queue on an interval and exposes the pending
// counts to the whole app via context so the sidebar can render badge numbers.
//
// Queues tracked:
//   • withdrawals        — payout requests awaiting review     (status=pending)
//   • deposits           — manual-UTR deposits awaiting verify  (status=pending)
//   • supportTickets     — open support tickets                (status=open)
//   • kycApplications    — host KYC applications to review      (pending / under_review)
//   • contentReports     — content moderation reports           (status=pending)
//
// When a NEW pending item appears (a queue's count increases vs. the previous
// poll) it:
//   1. plays a LOUD ~30-second two-tone alarm (Web Audio API — no asset needed)
//      that repeats until the admin opens a queue (acknowledge),
//   2. shows an in-app toast,
//   3. fires a desktop/browser notification (if permission was granted),
//   4. flags the backlog as UNACKNOWLEDGED so the ring keeps repeating on an
//      interval until the admin actually opens one of the queues.
//
// It also mirrors the total pending count into the browser tab title, e.g.
// "(3) VoxLink Admin", so the admin sees it even from another tab.
//
// The very first poll only establishes a baseline — it never rings, so the
// admin isn't blasted with sound on login for the existing backlog.
// ============================================================================

import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { toast } from 'sonner';
import { api, req } from '@/lib/api';

const POLL_MS = 15_000;      // how often we re-check the queues
const REPEAT_MS = 30_000;    // how often the ring repeats while unacknowledged
const SOUND_KEY = 'voxlink_admin_alert_sound';

// The set of queues we track, in the order used to pick the "busiest" one.
export type QueueKey =
  | 'withdrawals'
  | 'deposits'
  | 'supportTickets'
  | 'kycApplications'
  | 'contentReports';

export interface QueueMeta {
  key: QueueKey;
  label: string;   // human label used in toasts / notifications
  route: string;   // sidebar route the badge lives on
}

// Single source of truth so the sidebar, header pill and acknowledge logic
// all agree on which routes are "actionable queues".
export const QUEUES: QueueMeta[] = [
  { key: 'withdrawals', label: 'withdrawal request', route: '/withdrawals' },
  { key: 'deposits', label: 'deposit (UTR)', route: '/deposits' },
  { key: 'supportTickets', label: 'support ticket', route: '/support-tickets' },
  { key: 'kycApplications', label: 'KYC application', route: '/host-applications' },
  { key: 'contentReports', label: 'content report', route: '/content-moderation' },
];

export type PendingCounts = Record<QueueKey, number>;

const ZERO: PendingCounts = {
  withdrawals: 0,
  deposits: 0,
  supportTickets: 0,
  kycApplications: 0,
  contentReports: 0,
};

interface PendingAlertsValue {
  counts: PendingCounts;
  total: number;
  soundEnabled: boolean;
  setSoundEnabled: (on: boolean) => void;
  /** Re-play the ring on demand (used when toggling sound on, as a test). */
  testRing: () => void;
  /** Stop the repeating ring — call this when the admin opens a queue. */
  acknowledge: () => void;
}

const PendingAlertsContext = createContext<PendingAlertsValue>({
  counts: ZERO,
  total: 0,
  soundEnabled: true,
  setSoundEnabled: () => {},
  testRing: () => {},
  acknowledge: () => {},
});

export const usePendingAlerts = () => useContext(PendingAlertsContext);

// ─── Loud alert alarm via Web Audio (no asset needed) ───────────────────────
// A new pending withdrawal/deposit is money-critical, so the alert is a LOUD,
// ~30-second two-tone emergency siren (detuned square waves pushed through a
// compressor) that an admin can't miss from across the room. Only ONE alarm
// ever plays at a time (no stacking/distortion); it's silenced by acknowledging
// (opening a queue) or turning sound off.
const ALARM_SECONDS = 30;

let activeAlarm: { stop: () => void } | null = null;

function stopAlarm() {
  if (activeAlarm) {
    try { activeAlarm.stop(); } catch { /* ignore */ }
    activeAlarm = null;
  }
}

function playAlarm(durationSec = ALARM_SECONDS) {
  try {
    const AudioCtx: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    if (activeAlarm) return; // already blaring — never stack alarms
    const ctx = new AudioCtx();
    try { ctx.resume?.(); } catch { /* ignore */ }

    // Master path: gain → compressor → speakers. The compressor lets us push
    // the level hard (loud) while taming clipping on the square-wave stack.
    const master = ctx.createGain();
    master.gain.value = 0.95;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    const now = ctx.currentTime;
    const beep = 0.5;             // length of each tone (s)
    const tones = [1046.5, 784];  // C6 / G5 — bright, alarming two-tone
    const oscillators: OscillatorNode[] = [];
    let t = now;
    for (let i = 0; t < now + durationSec; i++) {
      const freq = tones[i % tones.length];
      // Two slightly-detuned square oscillators per beep = a thick, LOUD tone.
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.setValueAtTime(0.5, t + beep - 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + beep - 0.01);
        osc.connect(g).connect(master);
        osc.start(t);
        osc.stop(t + beep);
        oscillators.push(osc);
      }
      t += beep;
    }

    const endTimer = window.setTimeout(() => stopAlarm(), durationSec * 1000 + 400);
    activeAlarm = {
      stop: () => {
        window.clearTimeout(endTimer);
        oscillators.forEach((o) => { try { o.stop(); } catch { /* ignore */ } });
        window.setTimeout(() => ctx.close().catch(() => {}), 120);
      },
    };
  } catch {
    /* ignore — audio is best-effort */
  }
}

// Short confirmation chime (used when toggling sound ON) — NOT the 30s alarm,
// so enabling sound doesn't blast the admin for half a minute.
function playPreview() {
  try {
    const AudioCtx: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [1174.66, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch {
    /* ignore — audio is best-effort */
  }
}

function notifyDesktop(title: string, body: string) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'voxlink-pending', renotify: true } as any);
    }
  } catch {
    /* ignore */
  }
}

function requestNotifyPermission() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch { /* ignore */ }
}

// Capture the base tab title once so we can prefix/restore the pending count.
const BASE_TITLE = typeof document !== 'undefined' ? (document.title || 'VoxLink Admin') : 'VoxLink Admin';

export function PendingAlertsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<PendingCounts>(ZERO);
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  });

  const total = QUEUES.reduce((sum, q) => sum + (counts[q.key] || 0), 0);

  // Refs so timers/closures always read the latest values without
  // re-subscribing on every state change.
  const prev = useRef<PendingCounts | null>(null);
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;
  const totalRef = useRef(total);
  totalRef.current = total;
  // Backlog the admin hasn't looked at yet → drives the repeating ring.
  const unackedRef = useRef(false);

  const setSoundEnabled = useCallback((on: boolean) => {
    setSoundEnabledState(on);
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    if (on) requestNotifyPermission();
    else stopAlarm(); // muting also silences any alarm blaring right now
  }, []);

  const testRing = useCallback(() => playPreview(), []);

  const acknowledge = useCallback(() => {
    unackedRef.current = false;
    stopAlarm(); // opening a queue silences the alarm immediately
  }, []);

  // Prefer the single aggregated endpoint; if it isn't available (older
  // backend not yet deployed) we permanently fall back to the 5 list calls.
  const useSingleEndpoint = useRef(true);

  // Legacy path: derive counts from the individual list endpoints.
  const fetchCountsLegacy = useCallback(async (): Promise<PendingCounts | null> => {
    const [wRows, dRows, tRows, kRows, cRows] = await Promise.all([
      api.withdrawals().catch(() => [] as any[]),
      api.deposits().catch(() => [] as any[]),
      api.supportTickets().catch(() => [] as any[]),
      req<any[]>('GET', '/admin/host-applications').catch(() => [] as any[]),
      api.contentReports().catch(() => [] as any[]),
    ]);
    return {
      withdrawals: (wRows || []).filter((r: any) => r.status === 'pending').length,
      deposits: (dRows || []).filter((r: any) => r.status === 'pending').length,
      supportTickets: (tRows || []).filter((r: any) => r.status === 'open').length,
      kycApplications: (kRows || []).filter(
        (r: any) => r.status === 'pending' || r.status === 'under_review',
      ).length,
      contentReports: (cRows || []).filter((r: any) => r.status === 'pending').length,
    };
  }, []);

  const fetchCounts = useCallback(async (): Promise<PendingCounts | null> => {
    if (useSingleEndpoint.current) {
      try {
        const r = await api.pendingCounts();
        return {
          withdrawals: r.withdrawals || 0,
          deposits: r.deposits || 0,
          supportTickets: r.support_tickets || 0,
          kycApplications: r.kyc_applications || 0,
          contentReports: r.content_reports || 0,
        };
      } catch {
        // Endpoint missing/unreachable — switch to the legacy multi-call path
        // for the rest of the session.
        useSingleEndpoint.current = false;
      }
    }
    try {
      return await fetchCountsLegacy();
    } catch {
      return null;
    }
  }, [fetchCountsLegacy]);

  const poll = useCallback(async () => {
    try {
      const next = await fetchCounts();
      if (!next) return; // total failure — keep last known counts

      setCounts(next);

      const previous = prev.current;
      if (previous) {
        // Collect every queue that grew since the last poll.
        const grew = QUEUES.filter((q) => next[q.key] - previous[q.key] > 0);
        if (grew.length > 0) {
          unackedRef.current = true;
          if (soundRef.current) playAlarm();
          for (const q of grew) {
            const delta = next[q.key] - previous[q.key];
            const msg = `${delta} new ${q.label}${delta > 1 ? 's' : ''} pending`;
            toast.warning(msg, { description: `${next[q.key]} total in this queue` });
            notifyDesktop('New pending item', msg);
          }
        }
      }

      prev.current = next;
      // If everything is cleared, there's nothing left to nag about.
      if (QUEUES.every((q) => next[q.key] === 0)) unackedRef.current = false;
    } catch {
      /* network hiccup — keep last known counts */
    }
  }, [fetchCounts]);

  // ─── Poll loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped) void poll(); };

    tick(); // baseline immediately
    const id = window.setInterval(tick, POLL_MS);

    // Refresh right away when the tab regains focus so a returning admin
    // sees current numbers without waiting for the next interval.
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);

    requestNotifyPermission();

    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  // ─── Repeating ring while a backlog stays unacknowledged ────────────────────
  useEffect(() => {
    const id = window.setInterval(() => {
      if (unackedRef.current && soundRef.current && totalRef.current > 0) {
        playAlarm();
      }
    }, REPEAT_MS);
    return () => window.clearInterval(id);
  }, []);

  // ─── Mirror the pending count into the browser tab title ────────────────────
  useEffect(() => {
    document.title = total > 0 ? `(${total}) ${BASE_TITLE}` : BASE_TITLE;
    return () => { document.title = BASE_TITLE; };
  }, [total]);

  return (
    <PendingAlertsContext.Provider
      value={{ counts, total, soundEnabled, setSoundEnabled, testRing, acknowledge }}
    >
      {children}
    </PendingAlertsContext.Provider>
  );
}
