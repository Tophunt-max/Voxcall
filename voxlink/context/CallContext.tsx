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
  initiateCall: (participant: CallParticipant, type: CallType, coinsPerMinute?: number) => void;
  receiveCall: (participant: CallParticipant, type: CallType, callId: string) => void;
  acceptCall: () => void;
  markCallActive: () => void;
  syncServerStartTime: (serverStartedAtSeconds: number) => void;
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
        cfCallerSessionId: res.cf_session_id,
        cfHostSessionId: res.cf_host_session_id,
        coinsPerMinute: res.host_coins_per_minute ?? coinsPerMinute,
        maxSeconds: res.max_seconds,
      };
      updateCall(updated);
      // Fix C1: Caller should NOT call answerCall — only the HOST answers
    } catch (e) {
      console.warn("initiateCall API error:", e);
      updateCall(null);
      router.back();
    }
  }, []);

  const receiveCall = useCallback((participant: CallParticipant, type: CallType, callId: string) => {
    // Fix C3: also set sessionId = callId so acceptCall/declineCall can call the backend
    const call: ActiveCall = { callId, sessionId: callId, type, status: "incoming", participant, isMuted: false, isCameraOn: false, isSpeakerOn: false };
    updateCall(call);
    router.push("/user/call/incoming");
  }, []);

  const acceptCall = useCallback(async () => {
    const curr = activeCallRef.current;
    if (!curr) return;
    if (curr.sessionId) {
      try {
        await API.answerCall(curr.sessionId, true);
      } catch (e) {
        console.warn("acceptCall API error:", e);
        updateCall(null);
        router.back();
        return;
      }
    }
    const updated = { ...curr, status: "active" as CallStatus, startTime: Date.now() };
    updateCall(updated);
    router.replace(curr.type === "audio" ? "/user/call/audio-call" : "/user/call/video-call");
  }, []);

  const markCallActive = useCallback(() => {
    const curr = activeCallRef.current;
    if (!curr || curr.startTime) return;
    updateCall({ ...curr, status: "active" as CallStatus, startTime: Date.now() });
  }, []);

  // FIX: Called when the server notifies us that the host accepted the call.
  // Syncs the client billing timer to the server's started_at so they never drift.
  const syncServerStartTime = useCallback((serverStartedAtSeconds: number) => {
    const curr = activeCallRef.current;
    if (!curr) return;
    const startTimeMs = serverStartedAtSeconds * 1000;
    updateCall({ ...curr, status: "active" as CallStatus, startTime: startTimeMs });
  }, []);

  const declineCall = useCallback(() => {
    const curr = activeCallRef.current;
    updateCall(null);
    // Fix M3: notify backend that host declined
    if (curr?.sessionId) {
      try { API.answerCall(curr.sessionId, false); } catch {}
    }
    router.back();
  }, []);

  const endCall = useCallback(async (autoEnded = false) => {
    const call = activeCallRef.current;
    const wasActive = !!(call?.startTime);
    const duration = wasActive ? Math.floor((Date.now() - call!.startTime!) / 1000) : 0;
    updateCall(null);

    // FIX: Agar call cancel/decline hua (wasActive = false) lekin sessionId hai,
    // backend ko notify karo — warna session 2 min tak pending rehti hai
    // aur host ko call_ended event nahi milta, screen pe "Ringing..." stuck rahta hai
    if (!wasActive) {
      if (call?.sessionId) {
        try { await API.endCall(call.sessionId, 0); } catch {}
      }
      try { router.back(); } catch {}
      return;
    }

    let coinsSpent = Math.ceil((duration / 60) * (call?.coinsPerMinute ?? 5));

    if (call?.sessionId) {
      try {
        const res = await API.endCall(call.sessionId, duration);
        if (res?.coins_charged != null) {
          coinsSpent = res.coins_charged;
        }
      } catch (e) { console.warn("endCall API error:", e); }
      // Always refresh balance after call ends (remote may have already billed)
      try {
        const bal = await API.getBalance();
        if (bal?.coins != null) updateCoins(bal.coins);
      } catch {}
    }

    if (call) {
      router.replace({
        pathname: "/user/call/summary",
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
  }, [updateCoins]);

  const toggleMute = useCallback(() => setActiveCall((p) => p ? { ...p, isMuted: !p.isMuted } : null), []);
  const toggleCamera = useCallback(() => setActiveCall((p) => p ? { ...p, isCameraOn: !p.isCameraOn } : null), []);
  const toggleSpeaker = useCallback(() => setActiveCall((p) => p ? { ...p, isSpeakerOn: !p.isSpeakerOn } : null), []);

  return (
    <CallContext.Provider value={{ activeCall, initiateCall, receiveCall, acceptCall, markCallActive, syncServerStartTime, declineCall, endCall, toggleMute, toggleCamera, toggleSpeaker }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
