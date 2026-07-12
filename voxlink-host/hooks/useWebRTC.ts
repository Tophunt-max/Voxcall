import { useRef, useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { AgoraService, isAgoraAvailable } from '@/services/agora';
import { API } from '@/services/api';
import { socketService } from '@/services/SocketService';
import { SocketEvents } from '@/constants/events';

// Agora is the only RTC transport. The `provider` field is retained (always
// 'agora') so render components / analytics that branch on it keep working.
export type RtcProvider = 'agora' | 'unknown';

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
  // Transient, non-fatal status (e.g. "Weak connection — reconnecting…" while
  // the Agora Cloud Proxy fallback kicks in). Cleared automatically once the
  // call connects. Unlike `error`, this never triggers the auto-end paths.
  notice: string | null;
  provider: RtcProvider;
  // Agora native render target: the remote user's uid (rendered via
  // <RtcVideoView>). Null until a remote participant joins. On web this stays
  // null because rendering goes through the MediaStream path instead.
  agoraRemoteUid: number | null;
  toggleMute: (muted: boolean) => void;
  toggleCamera: (enabled: boolean) => void;
  setSpeaker: (on: boolean) => void;
  switchCamera: () => void;
  // No-op kept for call-screen API compatibility (Agora subscribes to remote
  // media via events, there is no manual pull loop).
  triggerPull: () => void;
  clearError: () => void;
  cleanup: () => void;
}

export function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn {
  const { sessionId, isVideo, enabled } = options;
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [agoraRemoteUid, setAgoraRemoteUid] = useState<number | null>(null);
  // has-video / muted are driven entirely by explicit signals from the Agora
  // service (both native and web), so there is no MediaStream track polling.
  const [remoteHasVideoSig, setRemoteHasVideoSig] = useState(false);
  const [localHasVideoSig, setLocalHasVideoSig] = useState(false);
  // Instant remote camera signal from PEER_MEDIA_STATE (null = unknown). Trust
  // it immediately when present — it beats the Agora video-state event on toggles.
  const [remoteVideoSignal, setRemoteVideoSignal] = useState<boolean | null>(null);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [connectionState, setConnectionState] = useState('new');
  const [connectionQuality, setConnectionQuality] = useState<string>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const serviceRef = useRef<AgoraService | null>(null);
  const startedRef = useRef(false);

  const available = isAgoraAvailable();
  const provider: RtcProvider = 'agora';

  const remoteHasVideo = remoteVideoSignal === false ? false : remoteHasVideoSig;
  const localHasVideo = localHasVideoSig;

  const cleanup = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.destroy();
      serviceRef.current = null;
    }
    startedRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setRemoteHasVideoSig(false);
    setLocalHasVideoSig(false);
    setAgoraRemoteUid(null);
    setRemoteVideoSignal(null);
    setRemoteMuted(false);
    setConnectionState('closed');
    setConnectionQuality('unknown');
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || startedRef.current) return;
    // The Agora SDK failed to load: on web the agora-rtc-sdk-ng module could
    // not be initialised (blocked script, ad-blocker, unsupported browser, or
    // an insecure/non-HTTPS context where WebRTC is disabled); on native the
    // module is missing from the build (pre-rebuild). Previously this returned
    // silently, leaving the call stuck on "Connecting…" forever with no error
    // and no log. Surface it so the user gets feedback and it shows in logs.
    if (!available) {
      console.error('[useWebRTC] Agora RTC engine unavailable — cannot start call', {
        platform: Platform.OS,
        secureContext: typeof window !== 'undefined' ? (window as any).isSecureContext : undefined,
      });
      setError('Calling engine could not start. Please use a supported browser over HTTPS, disable blockers, and refresh.');
      return;
    }
    startedRef.current = true;
    setError(null);

    let cancelled = false;

    const callbacks = {
      onRemoteStream: (stream: any) => { if (!cancelled) setRemoteStream(stream); },
      onConnectionStateChange: (state: string) => {
        if (cancelled) return;
        setConnectionState(state);
        // Once we actually connect, drop any transient "reconnecting" notice.
        if (state === 'connected') setNotice(null);
      },
      onError: (err: Error) => {
        if (cancelled) return;
        setError(err.message);
        console.error('RTC error:', err);
      },
      onQualityChange: (quality: string) => { if (!cancelled) setConnectionQuality(quality); },
      onRemoteVideo: (has: boolean) => { if (!cancelled) setRemoteHasVideoSig(has); },
      onRemoteAudioMuted: (muted: boolean) => { if (!cancelled) setRemoteMuted(muted); },
      onLocalVideo: (has: boolean) => { if (!cancelled) setLocalHasVideoSig(has); },
      onRemoteUid: (uid: number | null) => { if (!cancelled) setAgoraRemoteUid(uid); },
      // Direct media path stalled → Agora Cloud Proxy fallback engaged. Surface
      // a gentle, non-fatal notice while it reconnects.
      onProxyRetry: () => { if (!cancelled) setNotice('Weak connection — reconnecting…'); },
    };

    (async () => {
      let cfg;
      try {
        cfg = await API.getAgoraToken(sessionId);
      } catch (e: any) {
        if (!cancelled) {
          setError('Calling service unavailable. Please try again.');
          console.error('[useWebRTC] getAgoraToken failed:', e);
        }
        return;
      }
      if (cancelled) return;
      if (!cfg?.token || !cfg?.app_id) {
        setError('Calling service misconfigured.');
        return;
      }

      const service = new AgoraService(sessionId, isVideo, callbacks, {
        app_id: cfg.app_id,
        channel: cfg.channel,
        uid: cfg.uid ?? 0,
        token: cfg.token,
        initialTier: (cfg as any).recommended_quality,
      });
      serviceRef.current = service;

      try {
        const stream = await service.start();
        if (!cancelled && stream) setLocalStream(stream);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'RTC failed to start');
          console.error('RTC start error:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
      serviceRef.current?.destroy();
      serviceRef.current = null;
      startedRef.current = false;
    };
  }, [enabled, sessionId, isVideo, available]);

  // Instant remote mic/camera state via the PEER_MEDIA_STATE socket event the
  // other party emits on every toggle. Makes the camera-off avatar / muted
  // badge react immediately.
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
    // No-op: Agora subscribes to remote media via engine events.
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

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
    notice,
    provider,
    agoraRemoteUid,
    toggleMute,
    toggleCamera,
    setSpeaker,
    switchCamera,
    triggerPull,
    clearError,
    cleanup,
  };
}
