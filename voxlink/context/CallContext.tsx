import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { router } from "expo-router";
import { API } from "@/services/api";
import { logEngagement } from "@/services/engagement";
import { useAuth } from "@/context/AuthContext";

export type CallType = "audio" | "video";
export type CallStatus = "idle" | "outgoing" | "incoming" | "active" | "ended";

// Why a call ended. Drives the summary screen's banner + messaging so we never
// show a misleading "you ran out of coins" line for a call that actually
// dropped because of a network / WebRTC problem or because the other party
// hung up. Only `balance` means the caller genuinely exhausted their coins.
export type CallEndReason =
  | "balance"     // coins/free-minutes exhausted (real out-of-coins)
  | "connection"  // WebRTC/ICE never connected or dropped (network problem)
  | "remote"      // other party hung up / server ended the session
  | "user";       // this user tapped End (normal hang-up)

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
  /** Talk-time (seconds) covered by the caller's free-minute pool before coins
   *  start being charged. Drives the in-call "free minutes" chip. */
  freeSeconds?: number;
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
  endCall: (autoEnded?: boolean, reason?: CallEndReason) => void;
  clearCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { updateCoins } = useAuth();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  // FIX: guard against double-tap accepting the same call (mirror host pattern)
  const isAcceptingRef = useRef(false);

  const updateCall = (call: ActiveCall | null) => {
    activeCallRef.current = call;
    setActiveCall(call);
  };

  const initiateCall = useCallback(async (participant: CallParticipant, type: CallType, coinsPerMinute = 25) => {
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
        freeSeconds: Number(res.free_seconds) || 0,
      };
      updateCall(updated);
      // Engagement conversion signal — a successfully initiated call is the
      // strongest reward signal for the recommender/feed. Best-effort, fire and
      // forget; only hosts (role === "host") count as feed conversions.
      if (participant.role === "host") {
        try {
          logEngagement({ type: "call_start", host_id: participant.id, surface: type === "video" ? "call_video" : "call_audio" });
        } catch { /* analytics best-effort */ }
      }
      // Fix C1: Caller should NOT call answerCall — only the HOST answers
    } catch (e) {
      console.warn("initiateCall API error:", e);
      updateCall(null);
      router.back();
    }
  }, []);

  const receiveCall = useCallback((participant: CallParticipant, type: CallType, callId: string) => {
    // Fix C3: also set sessionId = callId so acceptCall/declineCall can call the backend
    // FIX: For video calls, camera/speaker should default ON to match the
    // outgoing-call defaults — otherwise an incoming video call shows the
    // accepter's preview as "Camera Off" right after they accept.
    const call: ActiveCall = { callId, sessionId: callId, type, status: "incoming", participant, isMuted: false, isCameraOn: type === "video", isSpeakerOn: type === "video" };
    updateCall(call);
    router.push("/user/call/incoming");
  }, []);

  const acceptCall = useCallback(async () => {
    const curr = activeCallRef.current;
    if (!curr) return;
    // FIX: race-protection — double-tap on Accept must not fire answerCall twice
    if (isAcceptingRef.current) return;
    isAcceptingRef.current = true;

    // FIX: server-synced billing timer — start from server's started_at when present,
    // otherwise fall back to local clock. Prevents drift on slow networks.
    let serverStartedAtMs = Date.now();
    if (curr.sessionId) {
      try {
        const res = await API.answerCall(curr.sessionId, true);
        if (res?.started_at) serverStartedAtMs = res.started_at * 1000;
      } catch (e: any) {
        // FIX: only treat session-state errors as hard failures. Network/timeout
        // soft errors must NOT cancel the call — the user may still be on the line.
        const msg = (e?.message || "").toLowerCase();
        const isHardFail =
          msg.includes("not found") ||
          msg.includes("not authorized") ||
          msg.includes("declined") ||
          msg.includes("ended");
        if (isHardFail) {
          isAcceptingRef.current = false;
          updateCall(null);
          return;
        }
        console.warn("acceptCall soft error, continuing:", e);
      }
    }

    const updated = { ...curr, status: "active" as CallStatus, startTime: serverStartedAtMs };
    updateCall(updated);
    isAcceptingRef.current = false;
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
    isAcceptingRef.current = false;
    updateCall(null);
    // Fix M3: notify backend that host declined
    if (curr?.sessionId) {
      API.answerCall(curr.sessionId, false).catch((e: any) => console.warn("declineCall notify error:", e));
    }
    router.back();
  }, []);

  // BUG FIX #7: Improved duration handling with server validation
  const endCall = useCallback(async (autoEnded = false, reason?: CallEndReason) => {
    const call = activeCallRef.current;
    const wasActive = !!(call?.startTime);
    const clientDuration = wasActive ? Math.floor((Date.now() - call!.startTime!) / 1000) : 0;
    updateCall(null);

    // FIX: Agar call cancel/decline hua (wasActive = false) lekin sessionId hai,
    // backend ko notify karo — warna session 2 min tak pending rehti hai
    // aur host ko call_ended event nahi milta, screen pe "Ringing..." stuck rahta hai
    if (!wasActive) {
      if (call?.sessionId) {
        try { await API.endCall(call.sessionId, 0); } catch (e) { console.warn("[CallContext] endCall (cancel) failed:", e); }
      }
      try { router.back(); } catch (e) { console.warn("[CallContext] router.back (cancel) failed:", e); }
      return;
    }

    // BUG FIX #7: Use server duration if available, fall back to client duration
    let finalDuration = clientDuration;
    let coinsSpent = Math.ceil((clientDuration / 60) * (call?.coinsPerMinute ?? 25));
    let freeMinutesUsed = 0;

    if (call?.sessionId) {
      try {
        const res = await API.endCall(call.sessionId, clientDuration);
        if (res?.duration_seconds != null) {
          // Server provided accurate duration
          finalDuration = res.duration_seconds;
        }
        if (res?.coins_charged != null) {
          coinsSpent = res.coins_charged;
        }
        if (res?.free_minutes_used != null) {
          freeMinutesUsed = res.free_minutes_used;
        }
      } catch (e: any) {
        // "Call already ended" means the remote party ended it first — the server
        // already charged the correct amount. Fetch session details so the summary
        // shows the actual coins_charged instead of a locally-estimated value.
        const isAlreadyEnded =
          /already ended/i.test(e?.message ?? "") ||
          e?.message?.includes("400");
        if (isAlreadyEnded && call.sessionId) {
          try {
            const session = await API.getCallSession(call.sessionId);
            if (session?.coins_charged != null) coinsSpent = session.coins_charged;
            if (session?.duration_seconds != null) finalDuration = session.duration_seconds;
            if (session?.free_minutes_used != null) freeMinutesUsed = session.free_minutes_used;
          } catch (e2) {
            console.warn("[CallContext] getCallSession after already-ended failed:", e2);
          }
        } else {
          console.warn("endCall API error:", e);
        }
      }
      // Always refresh balance after call ends (remote may have already billed)
      try {
        const bal = await API.getBalance();
        if (bal?.coins != null) updateCoins(bal.coins);
      } catch (e) {
        console.warn("[CallContext] refresh balance after endCall failed:", e);
      }
    }

    if (call) {
      // Effective end reason: an explicit reason always wins; otherwise an
      // auto-end with no reason is treated as a generic "ended" (NOT
      // "ran out of coins"), and a manual end is "user".
      const endReason: CallEndReason = reason ?? (autoEnded ? "remote" : "user");
      router.replace({
        pathname: "/user/call/summary",
        params: {
          duration: String(finalDuration),
          type: call.type,
          participantName: call.participant.name,
          participantId: call.participant.id,
          sessionId: call.sessionId ?? "",
          coinsSpent: String(coinsSpent),
          freeMinutesUsed: String(freeMinutesUsed),
          autoEnded: autoEnded ? "1" : "0",
          endReason,
        },
      });
    } else {
      router.back();
    }
  }, [updateCoins]);

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

  // Clear the active call WITHOUT navigation — used by the random dialer to
  // tear down a ringing session when it exits, without bouncing the router.
  const clearCall = useCallback(() => { updateCall(null); }, []);

  return (
    <CallContext.Provider value={{ activeCall, initiateCall, receiveCall, acceptCall, markCallActive, syncServerStartTime, declineCall, endCall, clearCall, toggleMute, toggleCamera, toggleSpeaker }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
