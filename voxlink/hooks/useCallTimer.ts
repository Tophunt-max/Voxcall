import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";

interface UseCallTimerOptions {
  isActive: boolean;
  maxSeconds?: number;
  onAutoEnd: () => void;
}

interface CallTimerState {
  elapsed: number;
  remaining: number | null;
  showLowCoinWarning: boolean;
  showRechargePopup: boolean;
  dismissRechargePopup: () => void;
}

export function useCallTimer({ isActive, maxSeconds, onAutoEnd }: UseCallTimerOptions): CallTimerState {
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
    setElapsed(0);
    setShowLowCoinWarning(false);
    setShowRechargePopup(false);

    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive]);

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
