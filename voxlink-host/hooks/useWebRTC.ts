import { useRef, useState, useCallback, useEffect } from 'react';
import { WebRTCService, isWebRTCAvailable } from '@/services/webrtc';
import { socketService } from '@/services/SocketService';
import { SocketEvents } from '@/constants/events';

export interface UseWebRTCOptions {
  sessionId: string | undefined;
  isVideo: boolean;
  enabled: boolean;
}

export interface UseWebRTCReturn {
  localStream: any;
  remoteStream: any;
  remoteHasVideo: boolean;
  remoteMuted: boolean;
  localHasVideo: boolean;
  connectionState: string;
  connectionQuality: string;
  isConnected: boolean;
  isAvailable: boolean;
  error: string | null;
  toggleMute: (muted: boolean) => void;
  toggleCamera: (enabled: boolean) => void;
  setSpeaker: (on: boolean) => void;
  switchCamera: () => void;
  triggerPull: () => void;
  clearError: () => void;
  cleanup: () => void;
}

export function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn {
  const { sessionId, isVideo, enabled } = options;
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  // Track-derived remote video presence (polling/event based — see effect below).
  const [trackHasVideo, setTrackHasVideo] = useState(false);
  // Explicit remote camera signal from PEER_MEDIA_STATE (null = unknown). When
  // the remote tells us their camera is off we trust it immediately instead of
  // waiting for the laggy track-mute polling to catch up.
  const [remoteVideoSignal, setRemoteVideoSignal] = useState<boolean | null>(null);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [localHasVideo, setLocalHasVideo] = useState(false);
  const [connectionState, setConnectionState] = useState('new');
  const [connectionQuality, setConnectionQuality] = useState<string>('unknown');
  const [error, setError] = useState<string | null>(null);
  const serviceRef = useRef<WebRTCService | null>(null);
  const startedRef = useRef(false);

  const available = isWebRTCAvailable();

  // Combine the explicit signal with track detection: an explicit "camera off"
  // forces false right away; otherwise fall back to what the track tells us.
  const remoteHasVideo = remoteVideoSignal === false ? false : trackHasVideo;

  const cleanup = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.destroy();
      serviceRef.current = null;
    }
    startedRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setTrackHasVideo(false);
    setRemoteVideoSignal(null);
    setRemoteMuted(false);
    setLocalHasVideo(false);
    setConnectionState('closed');
    setConnectionQuality('unknown');
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
      onQualityChange: (quality) => {
        setConnectionQuality(quality);
      },
    });

    serviceRef.current = service;

    service.start().then((stream) => {
      if (stream) {
        setLocalStream(stream);
      }
    }).catch((err: Error) => {
      setError(err.message ?? 'Failed to start WebRTC');
      console.error('WebRTC start error:', err);
    });

    return () => {
      service.destroy();
      serviceRef.current = null;
      startedRef.current = false;
    };
  }, [enabled, sessionId, isVideo, available]);

  // Instant remote mic/camera state via the PEER_MEDIA_STATE socket event the
  // other party emits on every toggle. This makes the camera-off avatar and
  // (optionally) a "muted" badge react immediately rather than waiting on the
  // 1.5s track-mute poll, which is laggy and unreliable across platforms.
  useEffect(() => {
    if (!sessionId) return;
    const off = socketService.on(SocketEvents.PEER_MEDIA_STATE, (data: any) => {
      if (data?.sessionId && data.sessionId !== sessionId) return;
      setRemoteMuted(data?.audio === false);
      setRemoteVideoSignal(typeof data?.video === 'boolean' ? data.video : null);
    });
    return off;
  }, [sessionId]);

  const toggleMute = useCallback((muted: boolean) => {
    serviceRef.current?.toggleMute(muted);
  }, []);

  const toggleCamera = useCallback((cameraOn: boolean) => {
    serviceRef.current?.toggleCamera(cameraOn);
  }, []);

  const setSpeaker = useCallback((on: boolean) => {
    serviceRef.current?.setSpeaker(on);
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
  // (The PEER_MEDIA_STATE signal above is the fast path; this is the backstop.)
  useEffect(() => {
    const stream = remoteStream;
    if (!stream) {
      setTrackHasVideo(false);
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
      setTrackHasVideo(active);
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
    remoteMuted,
    localHasVideo,
    connectionState,
    connectionQuality,
    isConnected: connectionState === 'connected',
    isAvailable: available,
    error,
    toggleMute,
    toggleCamera,
    setSpeaker,
    switchCamera,
    triggerPull,
    clearError,
    cleanup,
  };
}
