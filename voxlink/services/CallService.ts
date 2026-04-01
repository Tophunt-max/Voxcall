// VoxLink Call Service
// Manages call lifecycle: initiate, accept, reject, end

import { appendToArray, StorageKeys } from "@/utils/storage";
import { CallRecord } from "@/data/mockData";

export type CallType = "audio" | "video";
export type CallStatus = "initiating" | "ringing" | "connected" | "ended" | "missed" | "rejected" | "failed";

export interface CallSession {
  id: string;
  hostId: string;
  hostName: string;
  hostAvatar: string;
  type: CallType;
  status: CallStatus;
  startTime?: number;
  endTime?: number;
  duration: number;
  coinsPerMinute: number;
  coinsSpent: number;
  isIncoming: boolean;
}

const MOCK_DELAY = 400;
function delay(ms = MOCK_DELAY) {
  return new Promise((r) => setTimeout(r, ms));
}

function generateCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function initiateCall(params: {
  hostId: string;
  hostName: string;
  hostAvatar: string;
  type: CallType;
  coinsPerMinute: number;
}): Promise<{ success: boolean; session?: CallSession; error?: string }> {
  await delay();
  const session: CallSession = {
    id: generateCallId(),
    ...params,
    status: "ringing",
    duration: 0,
    coinsSpent: 0,
    isIncoming: false,
  };
  return { success: true, session };
}

export async function acceptCall(session: CallSession): Promise<CallSession> {
  await delay(200);
  return {
    ...session,
    status: "connected",
    startTime: Date.now(),
  };
}

export async function rejectCall(session: CallSession): Promise<CallSession> {
  await delay(200);
  return { ...session, status: "rejected", endTime: Date.now() };
}

export async function endCall(session: CallSession): Promise<{
  record: CallRecord;
  coinsSpent: number;
  duration: number;
}> {
  await delay(300);
  const endTime = Date.now();
  const duration = session.startTime
    ? Math.floor((endTime - session.startTime) / 1000)
    : 0;
  const coinsSpent = Math.ceil((duration / 60) * session.coinsPerMinute);

  const record: CallRecord = {
    id: session.id,
    hostName: session.hostName,
    hostAvatar: session.hostAvatar,
    type: session.type,
    duration,
    coinsSpent,
    timestamp: endTime,
  };

  await appendToArray<CallRecord>(StorageKeys.CALL_HISTORY, record);
  return { record, coinsSpent, duration };
}

export function calculateCoinCost(durationSeconds: number, coinsPerMinute: number): number {
  return Math.ceil((durationSeconds / 60) * coinsPerMinute);
}

export function hasEnoughCoins(balance: number, coinsPerMinute: number, minMinutes = 1): boolean {
  return balance >= coinsPerMinute * minMinutes;
}

export async function getCallHistory(): Promise<CallRecord[]> {
  const { getItem } = await import("@/utils/storage");
  return (await getItem<CallRecord[]>(StorageKeys.CALL_HISTORY)) ?? [];
}

export async function rateCall(callId: string, rating: number): Promise<{ success: boolean }> {
  await delay(300);
  const { updateInArray } = await import("@/utils/storage");
  await updateInArray<CallRecord & { id: string }>(StorageKeys.CALL_HISTORY, callId, {
    rating,
  } as any);
  return { success: true };
}
