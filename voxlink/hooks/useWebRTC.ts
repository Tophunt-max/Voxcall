import { useRef, useState, useCallback, useEffect } from 'react';
import { WebRTCService, isWebRTCAvailable } from '@/services/webrtc';

export interface UseWebRTCOptions {
  sessionId: string | undefined;
  isVideo: boolean;
  enabled: boolean;
}

export interface UseWebRTCReturn {
  localStream: any;
  remoteStream: any;
  connectionState: string;
  isConnected: boolean;
  isAvailable: boolean;
  error: string | null;
  toggleMute: (muted: boolean) => void;
  toggleCamera: (enabled: boolean) => void;
  switchCamera: () => void;
  triggerPull: () => void;
  clearError: () => void;
  cleanup: () => void;
}

export function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn {
  const { sessionId, isVideo, enabled } = options;
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [connectionState, setConnectionState] = useState('new');
  const [error, setError] = useState<string | null>(null);
  const serviceRef = useRef<WebRTCService | null>(null);
  const startedRef = useRef(false);

  const available = isWebRTCAvailable();

  const cleanup = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.destroy();
      serviceRef.current = null;
    }
    startedRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState('closed');
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || startedRef.current || !available) return;
    startedRef.current = true;
    setError(null);

    const service = new WebRTCService(sessionId, isVideo, {
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
      },
      onConnectionStateChange: (state) => {
        setConnectionState(state);
      },
      onError: (err) => {
        setError(err.message);
        console.error('WebRTC error:', err);
      },
    });

    serviceRef.current = service;

    service.start().then((stream) => {
      if (stream) {
        setLocalStream(stream);
      }
    });

    return () => {
      service.destroy();
      serviceRef.current = null;
      startedRef.current = false;
    };
  }, [enabled, sessionId, isVideo, available]);

  const toggleMute = useCallback((muted: boolean) => {
    serviceRef.current?.toggleMute(muted);
  }, []);

  const toggleCamera = useCallback((cameraOn: boolean) => {
    serviceRef.current?.toggleCamera(cameraOn);
  }, []);

  const switchCamera = useCallback(() => {
    serviceRef.current?.switchCamera();
  }, []);

  const triggerPull = useCallback(() => {
    serviceRef.current?.triggerPull();
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    localStream,
    remoteStream,
    connectionState,
    isConnected: connectionState === 'connected',
    isAvailable: available,
    error,
    toggleMute,
    toggleCamera,
    switchCamera,
    triggerPull,
    clearError,
    cleanup,
  };
}
