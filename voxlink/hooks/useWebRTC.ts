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
  remoteHasVideo: boolean;
  localHasVideo: boolean;
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
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [localHasVideo, setLocalHasVideo] = useState(false);
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
    setRemoteHasVideo(false);
    setLocalHasVideo(false);
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
    }).catch((err: Error) => {
      setError(err?.message || 'WebRTC failed to start');
      console.error('WebRTC start error:', err);
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

  // FIX (remote-camera-off detection): track whether the remote stream has an
  // active video track. We can't simply check `!!remoteStream` because the
  // peer connection keeps the stream alive even when the remote toggles their
  // camera off — the video track stays present but goes muted/disabled, so
  // <video>/RTCView shows pure black instead of falling back to the avatar.
  // Listen to track add/remove and per-track mute/unmute/ended events, with a
  // polling fallback because not every platform fires every event reliably.
  useEffect(() => {
    const stream = remoteStream;
    if (!stream) {
      setRemoteHasVideo(false);
      return;
    }

    const recompute = () => {
      const tracks: any[] = stream.getVideoTracks?.() ?? [];
      const active = tracks.some((t: any) => {
        if (!t) return false;
        if (t.enabled === false) return false;
        if (t.readyState === 'ended') return false;
        if (t.muted === true) return false;
        return true;
      });
      setRemoteHasVideo(active);
    };

    recompute();

    const trackBindings: Array<{ t: any; evt: string; fn: any }> = [];
    const streamBindings: Array<{ evt: string; fn: any }> = [];

    try { stream.addEventListener?.('addtrack', recompute); streamBindings.push({ evt: 'addtrack', fn: recompute }); } catch {}
    try { stream.addEventListener?.('removetrack', recompute); streamBindings.push({ evt: 'removetrack', fn: recompute }); } catch {}

    const tracks: any[] = stream.getVideoTracks?.() ?? [];
    for (const t of tracks) {
      for (const evt of ['mute', 'unmute', 'ended']) {
        try {
          t.addEventListener?.(evt, recompute);
          trackBindings.push({ t, evt, fn: recompute });
        } catch {}
      }
    }

    const interval = setInterval(recompute, 1500);

    return () => {
      clearInterval(interval);
      for (const { evt, fn } of streamBindings) {
        try { stream.removeEventListener?.(evt, fn); } catch {}
      }
      for (const { t, evt, fn } of trackBindings) {
        try { t.removeEventListener?.(evt, fn); } catch {}
      }
    };
  }, [remoteStream]);

  // FIX (#6 — camera-unavailable feedback): track whether our LOCAL stream
  // actually carries a usable video track. When a video call falls back to
  // audio-only (camera busy / unreadable at start), there is no video track —
  // the screen uses this to tell the user "Camera unavailable" instead of
  // showing a permanently black self-preview. Polled because track add/remove
  // (e.g. toggleCamera re-acquire) mutates the same stream object in place.
  useEffect(() => {
    const stream = localStream;
    if (!stream) {
      setLocalHasVideo(false);
      return;
    }
    const recompute = () => {
      const tracks: any[] = stream.getVideoTracks?.() ?? [];
      const active = tracks.some((t: any) => t && t.readyState !== 'ended');
      setLocalHasVideo(active);
    };
    recompute();
    const interval = setInterval(recompute, 1500);
    return () => clearInterval(interval);
  }, [localStream]);

  return {
    localStream,
    remoteStream,
    remoteHasVideo,
    localHasVideo,
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
