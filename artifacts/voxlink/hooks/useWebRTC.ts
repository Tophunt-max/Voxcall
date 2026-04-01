import { useRef, useState, useCallback, useEffect } from 'react';
import { MediaStream } from 'react-native-webrtc';
import { WebRTCService } from '@/services/webrtc';

export interface UseWebRTCOptions {
  sessionId: string | undefined;
  isVideo: boolean;
  enabled: boolean;
}

export interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connectionState: string;
  isConnected: boolean;
  error: string | null;
  toggleMute: (muted: boolean) => void;
  toggleCamera: (enabled: boolean) => void;
  switchCamera: () => void;
  cleanup: () => void;
}

export function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn {
  const { sessionId, isVideo, enabled } = options;
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState('new');
  const [error, setError] = useState<string | null>(null);
  const serviceRef = useRef<WebRTCService | null>(null);
  const startedRef = useRef(false);

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
    if (!enabled || !sessionId || startedRef.current) return;
    startedRef.current = true;

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
  }, [enabled, sessionId, isVideo]);

  const toggleMute = useCallback((muted: boolean) => {
    serviceRef.current?.toggleMute(muted);
  }, []);

  const toggleCamera = useCallback((cameraOn: boolean) => {
    serviceRef.current?.toggleCamera(cameraOn);
  }, []);

  const switchCamera = useCallback(() => {
    serviceRef.current?.switchCamera();
  }, []);

  return {
    localStream,
    remoteStream,
    connectionState,
    isConnected: connectionState === 'connected',
    error,
    toggleMute,
    toggleCamera,
    switchCamera,
    cleanup,
  };
}
