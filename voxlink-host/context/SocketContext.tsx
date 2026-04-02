// VoxLink Socket Context
// Provides socket connection state and event hooks to the entire app

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import socketService from "@/services/SocketService";
import { SocketEvents } from "@/constants/events";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { getItem, StorageKeys } from "@/utils/storage";

interface SocketContextValue {
  isConnected: boolean;
  sendMessage: (chatId: string, senderName: string, text: string) => void;
  onEvent: (event: string, handler: (...args: any[]) => void) => () => void;
  simulateIncomingCall: (
    hostName: string,
    hostAvatar: string,
    type?: "audio" | "video"
  ) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoggedIn } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const cleanupRefs = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;

    getItem(StorageKeys.AUTH_TOKEN).then((token) => {
      socketService.connect(user.id, token ?? undefined);
    });

    const offConnect = socketService.on(SocketEvents.CONNECT, () => setIsConnected(true));
    const offDisconnect = socketService.on(SocketEvents.DISCONNECT, () => setIsConnected(false));

    cleanupRefs.current = [offConnect, offDisconnect];

    return () => {
      cleanupRefs.current.forEach((fn) => fn());
      socketService.disconnect();
    };
  }, [isLoggedIn, user?.id]);

  const onEvent = useCallback(
    (event: string, handler: (...args: any[]) => void) => {
      return socketService.on(event, handler);
    },
    []
  );

  const sendMessage = useCallback(
    (chatId: string, _senderName: string, text: string) => {
      API.sendMessage(chatId, text).catch((err) =>
        console.warn("[SocketContext] sendMessage failed:", err)
      );
    },
    []
  );

  const simulateIncomingCall = useCallback(
    (hostName: string, hostAvatar: string, type: "audio" | "video" = "audio") => {
      socketService.simulateIncomingCall(hostName, hostAvatar, type);
    },
    []
  );

  return (
    <SocketContext.Provider
      value={{ isConnected, sendMessage, onEvent, simulateIncomingCall }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within SocketProvider");
  return ctx;
}

// Convenience hooks for common socket events
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
  deps: React.DependencyList = []
) {
  const { onEvent } = useSocket();

  useEffect(() => {
    const cleanup = onEvent(event, handler);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
