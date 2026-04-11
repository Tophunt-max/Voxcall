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

    // FIX: initialize elapsed from server's started_at so the display timer matches
    // what the server is billing. Without this, the timer starts from 0 even though
    // the server already started charging 5-15 seconds ago (WebRTC negotiation time).
    const initialElapsed = startTimeMs
      ? Math.max(0, Math.floor((Date.now() - startTimeMs) / 1000))
      : 0;
    setElapsed(initialElapsed);
    setShowLowCoinWarning(false);
    setShowRechargePopup(false);

    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

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
