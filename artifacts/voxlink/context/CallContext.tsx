import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { router } from "expo-router";
import { API } from "@/services/api";
import { useAuth } from "@/context/AuthContext";

export type CallType = "audio" | "video";
export type CallStatus = "idle" | "outgoing" | "incoming" | "active" | "ended";

export interface CallParticipant {
  id: string;
  name: string;
  avatar?: string;
  role: "user" | "host";
}

export interface ActiveCall {
  callId: string;
  sessionId?: string;
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
  initiateCall: (participant: CallParticipant, type: CallType, coinsPerMinute?: number) => void;
  receiveCall: (participant: CallParticipant, type: CallType, callId: string) => void;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: (autoEnded?: boolean) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { updateCoins } = useAuth();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);

  const updateCall = (call: ActiveCall | null) => {
    activeCallRef.current = call;
    setActiveCall(call);
  };

  const initiateCall = useCallback(async (participant: CallParticipant, type: CallType, coinsPerMinute = 5) => {
    const localId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const call: ActiveCall = {
      callId: localId,
      type,
      status: "outgoing",
      participant,
      coinsPerMinute,
      isMuted: false,
      isCameraOn: type === "video",
      isSpeakerOn: type === "video",
    };
    updateCall(call);

    try {
      const res = await API.initiateCall(participant.id, type);
      const sessionId = res.session_id;
      const updated: ActiveCall = {
        ...call,
        sessionId,
        coinsPerMinute: res.host_coins_per_minute ?? coinsPerMinute,
        maxSeconds: res.max_seconds,
      };
      updateCall(updated);
      // Auto-accept on backend (simulates host answering in demo mode)
      // This marks the session as 'active' so coins are charged correctly
      if (sessionId) {
        try { await API.answerCall(sessionId, true); } catch {}
      }
    } catch (e) {
      console.warn("initiateCall API error (demo mode):", e);
    }
  }, []);

  const receiveCall = useCallback((participant: CallParticipant, type: CallType, callId: string) => {
    const call: ActiveCall = { callId, type, status: "incoming", participant, isMuted: false, isCameraOn: false, isSpeakerOn: false };
    updateCall(call);
    router.push("/shared/call/incoming");
  }, []);

  const acceptCall = useCallback(async () => {
    const curr = activeCallRef.current;
    if (!curr) return;
    const updated = { ...curr, status: "active" as CallStatus, startTime: Date.now() };
    updateCall(updated);
    // Mark session as active on backend so coins are charged
    if (curr.sessionId) {
      try { await API.answerCall(curr.sessionId, true); } catch {}
    }
    router.replace(curr.type === "audio" ? "/shared/call/audio-call" : "/shared/call/video-call");
  }, []);

  const declineCall = useCallback(() => {
    updateCall(null);
    router.back();
  }, []);

  const endCall = useCallback(async (autoEnded = false) => {
    const call = activeCallRef.current;
    const duration = call?.startTime ? Math.floor((Date.now() - call.startTime) / 1000) : 0;
    updateCall(null);

    let coinsSpent = Math.ceil(duration / 60) * (call?.coinsPerMinute ?? 5);

    if (call?.sessionId) {
      try {
        const res = await API.endCall(call.sessionId, duration);
        if (res?.coins_charged != null) {
          coinsSpent = res.coins_charged;
          // Fetch fresh balance from backend and update AuthContext
          try {
            const bal = await API.getBalance();
            if (bal?.coins != null) updateCoins(bal.coins);
          } catch {}
        }
      } catch (e) { console.warn("endCall API error:", e); }
    }

    if (call) {
      router.replace({
        pathname: "/shared/call/summary",
        params: {
          duration: String(duration),
          type: call.type,
          participantName: call.participant.name,
          participantId: call.participant.id,
          sessionId: call.sessionId ?? "",
          coinsSpent: String(coinsSpent),
          autoEnded: autoEnded ? "1" : "0",
        },
      });
    } else {
      router.back();
    }
  }, []);

  const toggleMute = useCallback(() => setActiveCall((p) => p ? { ...p, isMuted: !p.isMuted } : null), []);
  const toggleCamera = useCallback(() => setActiveCall((p) => p ? { ...p, isCameraOn: !p.isCameraOn } : null), []);
  const toggleSpeaker = useCallback(() => setActiveCall((p) => p ? { ...p, isSpeakerOn: !p.isSpeakerOn } : null), []);

  return (
    <CallContext.Provider value={{ activeCall, initiateCall, receiveCall, acceptCall, declineCall, endCall, toggleMute, toggleCamera, toggleSpeaker }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
