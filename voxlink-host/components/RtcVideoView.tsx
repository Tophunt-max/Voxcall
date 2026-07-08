import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';

// ============================================================================
// RtcVideoView — Agora RTC video tile (platform-agnostic).
// ============================================================================
// Renders remote or local video for the Agora transport (the only transport):
//
//   • native (iOS/Android) → <RtcSurfaceView> keyed by uid. Agora exposes no
//                            MediaStream on native, so video is drawn by uid.
//   • web                  → the Agora web SDK gives real MediaStreamTracks,
//                            so the MediaStream is attached to a <video> tag.
// ============================================================================

let RtcSurfaceView: any = null;
let AgoraVideoSourceType: any = null;
try {
  if (Platform.OS !== 'web') {
    const agora = require('react-native-agora');
    RtcSurfaceView = agora.RtcSurfaceView;
    AgoraVideoSourceType = agora.VideoSourceType;
  }
} catch {
  // Agora native module missing (e.g. pre-rebuild) — RtcVideoView degrades to null.
}

export interface RtcVideoViewProps {
  /** MediaStream for the Agora web path. Ignored on native (rendered by uid). */
  stream?: any;
  provider?: 'agora' | 'unknown';
  /** Agora native render target: remote uid, or 0 for the local camera. */
  agoraUid?: number | null;
  isLocal?: boolean;
  style?: any;
  mirror?: boolean;
}

export function RtcVideoView({ stream, provider, agoraUid, isLocal = false, style, mirror = false }: RtcVideoViewProps) {
  const videoRef = useRef<any>(null);

  // Web: attach the MediaStream to a <video> element and force play() with a
  // bounded retry (autoPlay is unreliable on iOS Safari / mobile Chrome). This
  // mirrors the previous inline StreamView logic so behaviour is unchanged.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = videoRef.current;
    if (!el || !stream) return;
    try { el.srcObject = stream; } catch {}

    let settled = false;
    let attempts = 0;
    let intervalId: any = null;
    let gestureBound = false;

    const cleanupGesture = () => {
      try { window.removeEventListener('click', onGesture); } catch {}
      try { window.removeEventListener('touchend', onGesture); } catch {}
      try { document.removeEventListener('visibilitychange', onVisible); } catch {}
      gestureBound = false;
    };
    const stopInterval = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };

    const attempt = () => {
      if (settled || !videoRef.current) return;
      const p = videoRef.current.play?.();
      if (p && typeof p.catch === 'function') {
        p.then(() => { settled = true; stopInterval(); cleanupGesture(); })
          .catch((err: any) => {
            if (attempts <= 1) console.warn('[RtcVideoView] play() rejected:', err?.message ?? err);
            if (!gestureBound) {
              gestureBound = true;
              try {
                window.addEventListener('click', onGesture, { once: true } as any);
                window.addEventListener('touchend', onGesture, { once: true } as any);
                document.addEventListener('visibilitychange', onVisible);
              } catch {}
            }
          });
      } else {
        settled = true;
        stopInterval();
      }
    };
    function onGesture() { attempt(); }
    function onVisible() { if (document.visibilityState === 'visible') attempt(); }

    attempt();
    intervalId = setInterval(() => {
      attempts++;
      if (settled || attempts > 15) { stopInterval(); return; }
      attempt();
    }, 1000);

    return () => { stopInterval(); cleanupGesture(); };
  }, [stream]);

  // ── Agora native: render by uid via RtcSurfaceView ─────────────────────────
  if (provider === 'agora' && Platform.OS !== 'web') {
    if (!RtcSurfaceView) return null;
    const canvas = isLocal
      ? { uid: 0, sourceType: AgoraVideoSourceType?.VideoSourceCameraPrimary }
      : { uid: agoraUid ?? 0 };
    // A remote tile with no uid yet has nothing to draw.
    if (!isLocal && (agoraUid === null || agoraUid === undefined)) return null;
    return <RtcSurfaceView style={style} canvas={canvas} zOrderMediaOverlay={mirror} />;
  }

  // ── Web MediaStream path (Agora web exposes real MediaStreamTracks) ────────
  if (!stream) return null;

  if (Platform.OS === 'web') {
    return React.createElement('video', {
      ref: videoRef,
      autoPlay: true,
      playsInline: true,
      muted: mirror, // self-view muted, remote plays audio
      style: {
        ...StyleSheet.flatten(style),
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: mirror ? 'scaleX(-1)' : undefined,
      },
    });
  }

  // Native video is served exclusively by Agora's RtcSurfaceView above.
  return null;
}
