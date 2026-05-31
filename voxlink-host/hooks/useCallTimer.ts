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

    // FIX (timer drift): compute elapsed from a fixed wall-clock start on every
    // tick instead of incrementing a counter. setInterval is throttled while the
    // app is backgrounded / the JS thread is busy, so `prev + 1` silently drifts
    // behind real time — which matters here because onAutoEnd (the balance-cap
    // auto-end) fires off this value. Anchoring to the server's started_at (or
    // local now() as a fallback) keeps the display AND the auto-end accurate,
    // and self-corrects the instant the app returns to the foreground.
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
