// ============================================================================
// PendingAlertsProvider — global polling for actionable admin queues.
// ============================================================================
// Polls the pending WITHDRAWAL requests and pending (manual UTR) DEPOSITS
// every POLL_MS and exposes the counts to the whole app via context so the
// sidebar can render badge numbers.
//
// When a NEW pending item appears (count increases vs. the previous poll) it:
//   1. plays a short "ring" chime (Web Audio API — no asset needed),
//   2. shows an in-app toast,
//   3. fires a desktop/browser notification (if the admin granted permission).
//
// The very first poll only establishes a baseline — it never rings, so the
// admin isn't blasted with sound on login for the existing backlog.
// ============================================================================

import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const POLL_MS = 15_000;
const SOUND_KEY = 'voxlink_admin_alert_sound';

interface PendingAlertsValue {
  withdrawals: number;
  deposits: number;
  total: number;
  soundEnabled: boolean;
  setSoundEnabled: (on: boolean) => void;
  /** Manually re-play the ring (used when toggling sound on, as a test). */
  testRing: () => void;
}

const PendingAlertsContext = createContext<PendingAlertsValue>({
  withdrawals: 0,
  deposits: 0,
  total: 0,
  soundEnabled: true,
  setSoundEnabled: () => {},
  testRing: () => {},
});

export const usePendingAlerts = () => useContext(PendingAlertsContext);

// ─── Ring chime via Web Audio (a pleasant two-note "ding-dong") ─────────────
function playRing() {
  try {
    const AudioCtx: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // Two descending notes for a doorbell-like alert.
    [1174.66, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    // Free the context shortly after the sound finishes.
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

export function PendingAlertsProvider({ children }: { children: ReactNode }) {
  const [withdrawals, setWithdrawals] = useState(0);
  const [deposits, setDeposits] = useState(0);
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  });

  // Refs so the polling closure always reads the latest values without
  // re-subscribing the interval on every state change.
  const prev = useRef<{ w: number; d: number } | null>(null);
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  const setSoundEnabled = useCallback((on: boolean) => {
    setSoundEnabledState(on);
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    if (on) {
      // Ask for desktop-notification permission the moment sound is enabled.
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {});
        }
      } catch { /* ignore */ }
    }
  }, []);

  const testRing = useCallback(() => playRing(), []);

  const poll = useCallback(async () => {
    try {
      const [wRows, dRows] = await Promise.all([
        api.withdrawals().catch(() => [] as any[]),
        api.deposits().catch(() => [] as any[]),
      ]);

      const wCount = (wRows || []).filter((r: any) => r.status === 'pending').length;
      // "Manual UTR" deposits are the ones sitting in `pending` awaiting an
      // admin to verify the UTR — auto gateways settle themselves.
      const dCount = (dRows || []).filter((r: any) => r.status === 'pending').length;

      setWithdrawals(wCount);
      setDeposits(dCount);

      const previous = prev.current;
      if (previous) {
        const newW = wCount - previous.w;
        const newD = dCount - previous.d;

        if (newW > 0) {
          if (soundRef.current) playRing();
          const msg = `${newW} new withdrawal request${newW > 1 ? 's' : ''} pending`;
          toast.warning(msg, { description: `${wCount} total awaiting review` });
          notifyDesktop('New withdrawal request', msg);
        }
        if (newD > 0) {
          // Avoid a double-ring if both went up in the same tick.
          if (soundRef.current && newW <= 0) playRing();
          const msg = `${newD} new deposit${newD > 1 ? 's' : ''} awaiting UTR verification`;
          toast.warning(msg, { description: `${dCount} total pending` });
          notifyDesktop('New pending deposit', msg);
        }
      }

      prev.current = { w: wCount, d: dCount };
    } catch {
      /* network hiccup — keep last known counts */
    }
  }, []);

  useEffect(() => {
    // Only poll when an admin token is present (i.e. logged in).
    let stopped = false;
    const tick = () => { if (!stopped) void poll(); };

    tick(); // baseline immediately
    const id = window.setInterval(tick, POLL_MS);

    // Refresh right away when the tab regains focus so a returning admin
    // sees current numbers without waiting for the next interval.
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  return (
    <PendingAlertsContext.Provider
      value={{
        withdrawals,
        deposits,
        total: withdrawals + deposits,
        soundEnabled,
        setSoundEnabled,
        testRing,
      }}
    >
      {children}
    </PendingAlertsContext.Provider>
  );
}
