import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { router } from "expo-router";
import { API } from "@/services/api";
import { useAuth } from "@/context/AuthContext";

export type CallType = "audio" | "video";
export type CallStatus = "idle" | "incoming" | "active" | "ended";

export interface CallParticipant {
  id: string;
  name: string;
  avatar?: string;
  role: "user" | "host";
}

export interface ActiveCall {
  callId: string;
  sessionId?: string;
  cfCallerSessionId?: string;
  cfHostSessionId?: string;
  type: CallType;
  status: CallStatus;
  participant: CallParticipant;
  startTime?: number;
  coinsPerMinute?: number;
  maxSeconds?: number;
  isMuted?: boolean;
  isCameraOn?: boolean;
  isSpeakerOn?: boolean;
}

interface CallContextValue {
  activeCall: ActiveCall | null;
  receiveCall: (participant: CallParticipant, type: CallType, callId: string, coinsPerMinute?: number, maxSeconds?: number) => void;
  acceptCall: () => void;
  markCallActive: () => void;
  declineCall: () => void;
  endCall: (autoEnded?: boolean) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { updateEarnings, refreshProfile } = useAuth();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);

  const updateCall = (call: ActiveCall | null) => {
    activeCallRef.current = call;
    setActiveCall(call);
  };

  const receiveCall = useCallback((participant: CallParticipant, type: CallType, callId: string, coinsPerMinute?: number, maxSeconds?: number) => {
    const call: ActiveCall = {
      callId,
      sessionId: callId,
      type,
      status: "incoming",
      participant,
      isMuted: false,
      isCameraOn: false,
      isSpeakerOn: false,
      coinsPerMinute,
      maxSeconds,
    };
    updateCall(call);
    // Navigation is handled by the caller (AppBridge / FCMBridge) so we do NOT
    // push here. Pushing from two places creates a duplicate stack entry that
    // causes the incoming screen to auto-back on mount (race condition).
  }, []);

  const acceptCall = useCallback(async () => {
    const curr = activeCallRef.current;
    if (!curr) return;
    // Bug 10 Fix: Call API first before updating state/navigating.
    // If the API fails (caller already cancelled), decline the call instead of
    // navigating to a dead call screen.
    let serverStartedAtMs = Date.now(); // fallback if server doesn't return started_at
    if (curr.sessionId) {
      try {
        const res = await API.answerCall(curr.sessionId, true);
        // FIX: use server's started_at to sync billing timer — avoids discrepancy
        // between client clock and server clock when charging coins
        if (res?.started_at) serverStartedAtMs = res.started_at * 1000;
      } catch {
        // Call no longer valid — silently decline and reset
        updateCall(null);
        try { router.back(); } catch {}
        return;
      }
    }
    const updated = { ...curr, status: "active" as CallStatus, startTime: serverStartedAtMs };
    updateCall(updated);
    router.replace(curr.type === "audio" ? "/calls/audio-call" : "/calls/video-call");
  }, []);

  const markCallActive = useCallback(() => {
    const curr = activeCallRef.current;
    if (!curr || curr.startTime) return;
    updateCall({ ...curr, status: "active" as CallStatus, startTime: Date.now() });
  }, []);

  const declineCall = useCallback(() => {
    const curr = activeCallRef.current;
    updateCall(null);
    if (curr?.sessionId) {
      try { API.answerCall(curr.sessionId, false); } catch {}
    }
    // NOTE: Do NOT call router.back() here — incoming.tsx's useEffect watches
    // activeCall and calls router.back() when it goes null. Calling it here too
    // would double-pop the navigation stack.
  }, []);

  const endCall = useCallback(async (autoEnded = false) => {
    const call = activeCallRef.current;
    const wasActive = !!(call?.startTime);
    const duration = wasActive ? Math.floor((Date.now() - call!.startTime!) / 1000) : 0;
    updateCall(null);

    // If call was never answered (still incoming when ended/cancelled by remote),
    // just dismiss — no summary, no API call needed.
    if (!wasActive) {
      // incoming.tsx useEffect watches activeCall → null and calls router.back()
      return;
    }

    let coinsEarned = Math.ceil((duration / 60) * (call?.coinsPerMinute ?? 5));

    if (call?.sessionId) {
      try {
        const res = await API.endCall(call.sessionId, duration);
        if (res?.host_earnings != null) {
          coinsEarned = res.host_earnings;
        }
      } catch (e) {
        console.warn("endCall API error:", e);
      }
      try {
        await refreshProfile();
      } catch {}
    }

    if (call) {
      router.replace({
        pathname: "/calls/summary",
        params: {
          duration: String(duration),
          type: call.type,
          participantName: call.participant.name,
          participantId: call.participant.id,
          sessionId: call.sessionId ?? "",
          coinsEarned: String(coinsEarned),
          autoEnded: autoEnded ? "1" : "0",
        },
      });
    } else {
      try { router.back(); } catch {}
    }
  }, [refreshProfile]);

  const toggleMute = useCallback(() => setActiveCall((p) => p ? { ...p, isMuted: !p.isMuted } : null), []);
  const toggleCamera = useCallback(() => setActiveCall((p) => p ? { ...p, isCameraOn: !p.isCameraOn } : null), []);
  const toggleSpeaker = useCallback(() => setActiveCall((p) => p ? { ...p, isSpeakerOn: !p.isSpeakerOn } : null), []);

  return (
    <CallContext.Provider value={{
      activeCall,
      receiveCall,
      acceptCall,
      markCallActive,
      declineCall,
      endCall,
      toggleMute,
      toggleCamera,
      toggleSpeaker,
    }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
