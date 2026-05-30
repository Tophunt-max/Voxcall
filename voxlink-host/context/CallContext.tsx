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
  const isAcceptingRef = useRef(false);

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
      // FIX: For video calls, host's camera should default to ON. Hardcoding
      // false meant the host saw their own preview as "Camera Off" the moment
      // they accepted, even though the screen is a video call. Speaker also
      // defaults to ON for video to match the user app behavior.
      isCameraOn: type === "video",
      isSpeakerOn: type === "video",
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
    if (isAcceptingRef.current) return;
    isAcceptingRef.current = true;

    let serverStartedAtMs = Date.now();
    if (curr.sessionId) {
      try {
        const res = await API.answerCall(curr.sessionId, true);
        if (res?.started_at) serverStartedAtMs = res.started_at * 1000;
      } catch (e: any) {
        const msg = (e?.message || "").toLowerCase();
        // Sirf "session not found" ya "not authorized" pe decline karo
        // Network error ya 401 pe bhi decline mat karo — retry milega
        const isHardFail =
          msg.includes("not found") ||
          msg.includes("not authorized") ||
          msg.includes("declined") ||
          msg.includes("ended");
        if (isHardFail) {
          isAcceptingRef.current = false;
          updateCall(null);
          // incoming.tsx ka activeCall watcher router.back() karega
          return;
        }
        // Soft error (network, timeout): optimistically continue karo
        // server billing timer reset ho sakta hai — startTime ab ka use hoga
        console.warn("answerCall soft error, continuing:", e);
      }
    }

    const updated = { ...curr, status: "active" as CallStatus, startTime: serverStartedAtMs };
    updateCall(updated);
    isAcceptingRef.current = false;

    // router.replace ki jagah router.push use karo — fullScreenModal ke andar
    // replace() kabhi kabhi modal stack ko galat navigate karta hai web pe.
    // incoming screen activeCall null nahi hoga (status "active" hai) isliye
    // incoming ka watcher back() nahi karega.
    router.push(curr.type === "audio" ? "/calls/audio-call" : "/calls/video-call");
  }, []);

  const markCallActive = useCallback(() => {
    const curr = activeCallRef.current;
    if (!curr || curr.startTime) return;
    updateCall({ ...curr, status: "active" as CallStatus, startTime: Date.now() });
  }, []);

  const declineCall = useCallback(() => {
    const curr = activeCallRef.current;
    isAcceptingRef.current = false;
    updateCall(null);
    if (curr?.sessionId) {
      API.answerCall(curr.sessionId, false).catch((e: any) => console.warn("declineCall notify error:", e));
    }
    // NOTE: Do NOT call router.back() here — incoming.tsx's useEffect watches
    // activeCall and calls router.back() when it goes null. Calling it here too
    // would double-pop the navigation stack.
  }, []);

  const endCall = useCallback(async (autoEnded = false) => {
    const call = activeCallRef.current;
    const wasActive = !!(call?.startTime);
    let duration = wasActive ? Math.floor((Date.now() - call!.startTime!) / 1000) : 0;
    updateCall(null);

    // FIX: Agar call cancel hua (wasActive = false) lekin sessionId hai,
    // backend ko notify karo — warna caller ko call_ended event nahi milta
    if (!wasActive) {
      if (call?.sessionId) {
        try { await API.endCall(call.sessionId, 0); } catch (e) { console.warn('[CallContext] endCall failed:', e); }
      }
      // incoming.tsx useEffect watches activeCall → null and calls router.back()
      return;
    }

    let coinsEarned = Math.ceil((duration / 60) * (call?.coinsPerMinute ?? 5));

    if (call?.sessionId) {
      try {
        const res = await API.endCall(call.sessionId, duration);
        if (res?.duration_seconds != null) {
          duration = res.duration_seconds;
        }
        if (res?.host_earnings != null) {
          coinsEarned = res.host_earnings;
        }
      } catch (e: any) {
        // "Call already ended" means the caller ended it first — the server already
        // calculated the correct host earnings. Fetch session data so the summary
        // shows the actual host_earnings instead of a locally-estimated value.
        const isAlreadyEnded =
          /already ended/i.test(e?.message ?? "") ||
          e?.message?.includes("400");
        if (isAlreadyEnded && call.sessionId) {
          try {
            const session = await API.getCallSession(call.sessionId);
            if (session?.coins_charged != null) {
              coinsEarned = Math.floor(session.coins_charged * 0.7);
            }
          } catch (e) { console.warn('[CallContext] getCallSession failed:', e); }
        } else {
          console.warn("endCall API error:", e);
        }
      }
      await refreshProfile().catch((e: unknown) => console.warn('refreshProfile after endCall failed:', e));
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
      try { router.back(); } catch (e) { console.warn('[CallContext] router.back failed:', e); }
    }
  }, [refreshProfile]);

  // FIX (stale activeCallRef): route toggles through updateCall so the ref
  // stays in sync with state. Previously these used setActiveCall directly,
  // leaving activeCallRef.current.isMuted/isCameraOn/isSpeakerOn stale — any
  // code reading those flags off the ref saw outdated values.
  const toggleMute = useCallback(() => {
    const c = activeCallRef.current;
    if (c) updateCall({ ...c, isMuted: !c.isMuted });
  }, []);
  const toggleCamera = useCallback(() => {
    const c = activeCallRef.current;
    if (c) updateCall({ ...c, isCameraOn: !c.isCameraOn });
  }, []);
  const toggleSpeaker = useCallback(() => {
    const c = activeCallRef.current;
    if (c) updateCall({ ...c, isSpeakerOn: !c.isSpeakerOn });
  }, []);

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
