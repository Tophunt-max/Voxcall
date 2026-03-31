import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { router } from "expo-router";

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
  type: CallType;
  status: CallStatus;
  participant: CallParticipant;
  startTime?: number;
  coinsPerMinute?: number;
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
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initiateCall = useCallback((participant: CallParticipant, type: CallType, coinsPerMinute = 5) => {
    const callId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const call: ActiveCall = {
      callId,
      type,
      status: "outgoing",
      participant,
      coinsPerMinute,
      isMuted: false,
      isCameraOn: type === "video",
      isSpeakerOn: type === "video",
    };
    setActiveCall(call);
    if (type === "audio") {
      router.push("/call/audio-call");
    } else {
      router.push("/call/video-call");
    }
  }, []);

  const receiveCall = useCallback((participant: CallParticipant, type: CallType, callId: string) => {
    const call: ActiveCall = {
      callId,
      type,
      status: "incoming",
      participant,
      isMuted: false,
      isCameraOn: false,
      isSpeakerOn: false,
    };
    setActiveCall(call);
    router.push("/call/incoming");
  }, []);

  const acceptCall = useCallback(() => {
    setActiveCall((prev) => {
      if (!prev) return null;
      return { ...prev, status: "active", startTime: Date.now() };
    });
    if (activeCall?.type === "audio") {
      router.replace("/call/audio-call");
    } else {
      router.replace("/call/video-call");
    }
  }, [activeCall]);

  const declineCall = useCallback(() => {
    setActiveCall(null);
    router.back();
  }, []);

  const endCall = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }
    const duration = activeCall?.startTime ? Math.floor((Date.now() - activeCall.startTime) / 1000) : 0;
    const call = activeCall;
    setActiveCall(null);
    if (call) {
      router.replace({
        pathname: "/call/summary",
        params: { duration, type: call.type, participantName: call.participant.name }
      });
    } else {
      router.back();
    }
  }, [activeCall]);

  const toggleMute = useCallback(() => {
    setActiveCall((prev) => prev ? { ...prev, isMuted: !prev.isMuted } : null);
  }, []);

  const toggleCamera = useCallback(() => {
    setActiveCall((prev) => prev ? { ...prev, isCameraOn: !prev.isCameraOn } : null);
  }, []);

  const toggleSpeaker = useCallback(() => {
    setActiveCall((prev) => prev ? { ...prev, isSpeakerOn: !prev.isSpeakerOn } : null);
  }, []);

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
