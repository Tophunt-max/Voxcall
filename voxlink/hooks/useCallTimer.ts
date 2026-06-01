import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";

interface UseCallTimerOptions {
  isActive: boolean;
  maxSeconds?: number;
  startTimeMs?: number; // server-synced start time in ms — used to initialize elapsed correctly
  onAutoEnd: () => void;
}

interface CallTimerState {
  elapsed: number;
  remaining: number | null;
  showLowCoinWarning: boolean;
  showRechargePopup: boolean;
  dismissRechargePopup: () => void;
}

export function useCallTimer({ isActive, maxSeconds, startTimeMs, onAutoEnd }: UseCallTimerOptions): CallTimerState {
  const [elapsed, setElapsed] = useState(0);
  const [showLowCoinWarning, setShowLowCoinWarning] = useState(false);
  const [showRechargePopup, setShowRechargePopup] = useState(false);
  const hasWarnedRef = useRef(false);
  const hasPopupRef = useRef(false);
  const hasEndedRef = useRef(false);

  const remaining = maxSeconds != null ? Math.max(0, maxSeconds - elapsed) : null;

  useEffect(() => {
    if (!isActive) return;
    hasWarnedRef.current = false;
    hasPopupRef.current = false;
    hasEndedRef.current = false;

    // FIX (host/user timer sync + drift): compute elapsed from a FIXED
    // wall-clock anchor on every tick instead of incrementing a counter.
    //  1. Anchoring to the server's started_at (the same value the host app
    //     receives) makes the caller's timer read the SAME elapsed value as
    //     the host's from the very first frame — they run in lock-step instead
    //     of each counting up from their own local "connected" moment.
    //  2. setInterval is throttled while the app is backgrounded / the JS
    //     thread is busy, so `prev + 1` silently drifts behind real time —
    //     which matters because onAutoEnd (the balance-cap auto-end) fires off
    //     this value. Anchoring self-corrects the instant the app returns to
    //     the foreground. Falls back to local now() when no server time exists.
    const startMs = startTimeMs && startTimeMs > 0 ? startTimeMs : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    setShowLowCoinWarning(false);
    setShowRechargePopup(false);

    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [isActive, startTimeMs]);

  useEffect(() => {
    if (!isActive || remaining == null) return;

    if (remaining <= 60 && remaining > 5 && !hasWarnedRef.current) {
      hasWarnedRef.current = true;
      setShowLowCoinWarning(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }

    if (remaining <= 5 && !hasPopupRef.current) {
      hasPopupRef.current = true;
      setShowLowCoinWarning(false);
      setShowRechargePopup(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }

    if (remaining === 0 && !hasEndedRef.current) {
      hasEndedRef.current = true;
      setShowRechargePopup(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      onAutoEnd();
    }
  }, [remaining, isActive, onAutoEnd]);

  const dismissRechargePopup = () => setShowRechargePopup(false);

  return { elapsed, remaining, showLowCoinWarning, showRechargePopup, dismissRechargePopup };
}
