// ============================================================================
// AgoraService — Agora RTC media transport (drop-in peer of WebRTCService).
// ============================================================================
//
// This is the PRIMARY call transport when the backend has Agora configured
// (AGORA_APP_ID + AGORA_APP_CERTIFICATE). It exposes the SAME lifecycle the
// call screens rely on via the useWebRTC hook (start / toggleMute /
// toggleCamera / setSpeaker / switchCamera / destroy) so switching providers
// needs no screen-logic changes — only the video RENDER differs (see
// components/RtcVideoView.tsx).
//
// Native (iOS/Android): react-native-agora. Remote/local video is NOT a
//   MediaStream — it is rendered by uid via <RtcSurfaceView>. So on native we
//   hand the hook lightweight { __agora: true } markers for stream-truthiness
//   and drive has-video / muted through explicit callbacks. Audio is routed by
//   the Agora engine automatically (no element needed).
//
// Web: agora-rtc-sdk-ng. We build a real MediaStream from the remote/local
//   MediaStreamTracks (getMediaStreamTrack) and DO NOT call track.play() — the
//   existing <StreamView> / <RemoteAudioMount> elements play them, exactly like
//   the Cloudflare path. This keeps web rendering byte-for-byte identical.
//
// Both modules are loaded via require() (guarded) so a missing native module
// (pre-EAS-rebuild) degrades gracefully instead of crashing the bundle.
// ============================================================================

import { Platform } from 'react-native';
import { API } from './api';

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

// Callback surface the useWebRTC hook wires up. Kept as a standalone contract
// now that Agora is the only transport (previously shared with WebRTCService).
export interface RtcCallbacks {
  onRemoteStream?: (stream: any) => void;
  onConnectionStateChange?: (state: string) => void;
  onError?: (error: Error) => void;
  // Periodic call-quality signal so the UI can show real network bars instead
  // of a binary connected/disconnected flag.
  onQualityChange?: (quality: ConnectionQuality, detail?: { rtt?: number; packetLoss?: number; jitter?: number }) => void;
}

// Extra signals the Agora path emits so the hook can render has-video / muted
// without inspecting a MediaStream (which does not exist for native remotes).
export interface AgoraCallbacks extends RtcCallbacks {
  onRemoteVideo?: (hasVideo: boolean) => void;
  onRemoteAudioMuted?: (muted: boolean) => void;
  onLocalVideo?: (hasVideo: boolean) => void;
  // Native remote uid changed (for <RtcSurfaceView> canvas). null = no remote.
  onRemoteUid?: (uid: number | null) => void;
}

export interface AgoraJoinConfig {
  app_id: string;
  channel: string;
  uid: number;
  token: string;
}

// Marker objects handed to the hook on native (where there is no MediaStream).
// They only need to be truthy; RtcVideoView renders by uid, not by stream.
const NATIVE_LOCAL_MARKER = { __agora: true, kind: 'local' as const };

// Cap local video to the Agora HD tier (≤720p) so a call NEVER bills at the
// pricier Full-HD rate ($8.99 vs $3.99 / 1,000 min). 360×640 is plenty for a
// 1:1 mobile call and also saves the user's mobile data. To enable a Full-HD
// premium tier later, raise these AND the FHD coin rate + video_max_resolution.
const NATIVE_VIDEO_WIDTH = 360;
const NATIVE_VIDEO_HEIGHT = 640;
const NATIVE_VIDEO_FPS = 15;
const WEB_VIDEO_ENCODER = '480p_1'; // agora-rtc-sdk-ng preset, 640×480 (HD tier)

let AgoraNative: any = null;
let AgoraWeb: any = null;
try {
  if (Platform.OS === 'web') {
    const mod = require('agora-rtc-sdk-ng');
    AgoraWeb = mod?.default ?? mod;
  } else {
    AgoraNative = require('react-native-agora');
  }
} catch {
  AgoraNative = null;
  AgoraWeb = null;
}

export function isAgoraAvailable(): boolean {
  return Platform.OS === 'web' ? !!AgoraWeb : !!AgoraNative;
}

// Map Agora QualityType (1 excellent … 6 down) to our ConnectionQuality.
function mapQuality(q: number): ConnectionQuality {
  switch (q) {
    case 1: return 'excellent';
    case 2: return 'excellent';
    case 3: return 'good';
    case 4: return 'poor';
    case 5: return 'poor';
    case 6: return 'lost';
    default: return 'unknown';
  }
}

export class AgoraService {
  private sessionId: string;
  private isVideo: boolean;
  private callbacks: AgoraCallbacks;
  private config: AgoraJoinConfig;
  private destroyed = false;

  // Native (react-native-agora)
  private engine: any = null;
  private remoteUid: number | null = null;

  // Web (agora-rtc-sdk-ng)
  private webClient: any = null;
  private webLocalAudio: any = null;
  private webLocalVideo: any = null;
  private webRemoteTracks: { audio?: any; video?: any } = {};
  private localStream: any = null;
  private remoteStream: any = null;

  private localMuted = false;
  private localCameraOff = false;
  private currentQuality: ConnectionQuality = 'unknown';

  constructor(sessionId: string, isVideo: boolean, callbacks: AgoraCallbacks, config: AgoraJoinConfig) {
    this.sessionId = sessionId;
    this.isVideo = isVideo;
    this.callbacks = callbacks;
    this.config = config;
  }

  get provider(): 'agora' { return 'agora'; }
  // Whether rendering must go through <RtcSurfaceView> (native) vs MediaStream.
  get isNativeRender(): boolean { return Platform.OS !== 'web'; }
  getEngine(): any { return this.engine; }
  getRemoteUid(): number | null { return this.remoteUid; }
  getLocalStream(): any { return this.localStream; }
  getRemoteStream(): any { return this.remoteStream; }

  async start(): Promise<any> {
    if (this.destroyed) return null;
    try {
      if (Platform.OS === 'web') return await this._startWeb();
      return await this._startNative();
    } catch (error: any) {
      console.error('[Agora] start error:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  // ── Native (react-native-agora) ─────────────────────────────────────────────
  private async _startNative(): Promise<any> {
    if (!AgoraNative) throw new Error('react-native-agora native module unavailable — rebuild required');
    const {
      createAgoraRtcEngine,
      ChannelProfileType,
      ClientRoleType,
    } = AgoraNative;

    const engine = createAgoraRtcEngine();
    this.engine = engine;
    engine.initialize({
      appId: this.config.app_id,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
    });

    engine.registerEventHandler({
      onJoinChannelSuccess: () => {
        this.callbacks.onConnectionStateChange?.('connected');
      },
      onUserJoined: (_conn: any, remoteUid: number) => {
        this.remoteUid = remoteUid;
        this.callbacks.onRemoteUid?.(remoteUid);
        // Provide a truthy marker so the screen's "remote present" gating fires.
        this.remoteStream = { __agora: true, kind: 'remote', uid: remoteUid };
        this.callbacks.onRemoteStream?.(this.remoteStream);
      },
      onUserOffline: (_conn: any, remoteUid: number) => {
        if (this.remoteUid === remoteUid) {
          this.remoteUid = null;
          this.remoteStream = null;
          this.callbacks.onRemoteUid?.(null);
          this.callbacks.onRemoteVideo?.(false);
        }
      },
      onRemoteVideoStateChanged: (_conn: any, _uid: number, state: number) => {
        // 0 Stopped, 1 Starting, 2 Decoding, 3 Frozen, 4 Failed
        this.callbacks.onRemoteVideo?.(state !== 0 && state !== 4);
      },
      onRemoteAudioStateChanged: (_conn: any, _uid: number, state: number, reason: number) => {
        // reason 5 = RemoteMuted, 6 = RemoteUnmuted; state 0 = Stopped
        this.callbacks.onRemoteAudioMuted?.(reason === 5 || state === 0);
      },
      onConnectionStateChanged: (_conn: any, state: number) => {
        // 1 Disconnected, 2 Connecting, 3 Connected, 4 Reconnecting, 5 Failed
        const mapped = state === 3 ? 'connected'
          : state === 5 ? 'failed'
          : state === 4 ? 'disconnected'
          : 'checking';
        this.callbacks.onConnectionStateChange?.(mapped);
      },
      onNetworkQuality: (_conn: any, uid: number, _tx: number, rx: number) => {
        // uid 0 = local user's own uplink/downlink stats.
        if (uid !== 0) return;
        const q = mapQuality(rx);
        if (q !== this.currentQuality && q !== 'unknown') {
          this.currentQuality = q;
          this.callbacks.onQualityChange?.(q);
        }
      },
      onError: (err: number, msg: string) => {
        this.callbacks.onError?.(new Error(`Agora error ${err}: ${msg ?? ''}`));
      },
    });

    engine.enableAudio();
    if (this.isVideo) {
      engine.enableVideo();
      // Cap the local encoder to the HD tier (≤720p) so Agora never bills the
      // Full-HD rate. OrientationModeAdaptive lets portrait selfies render right.
      try {
        engine.setVideoEncoderConfiguration({
          dimensions: { width: NATIVE_VIDEO_WIDTH, height: NATIVE_VIDEO_HEIGHT },
          frameRate: NATIVE_VIDEO_FPS,
          orientationMode: AgoraNative.OrientationMode?.OrientationModeAdaptive,
        });
      } catch (e) { console.warn('[Agora] setVideoEncoderConfiguration failed:', e); }
      engine.startPreview();
      this.callbacks.onLocalVideo?.(true);
    } else {
      engine.disableVideo();
    }
    // Video calls default to loudspeaker, audio calls to earpiece (matches CF).
    try { engine.setEnableSpeakerphone(this.isVideo); } catch { /* best-effort */ }

    engine.joinChannel(this.config.token, this.config.channel, this.config.uid, {
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      publishMicrophoneTrack: true,
      publishCameraTrack: this.isVideo,
      autoSubscribeAudio: true,
      autoSubscribeVideo: this.isVideo,
    });

    this.localStream = NATIVE_LOCAL_MARKER;
    return this.localStream;
  }

  // ── Web (agora-rtc-sdk-ng) ──────────────────────────────────────────────────
  private async _startWeb(): Promise<any> {
    if (!AgoraWeb) throw new Error('agora-rtc-sdk-ng unavailable');
    const client = AgoraWeb.createClient({ mode: 'rtc', codec: 'vp8' });
    this.webClient = client;

    client.on('user-published', async (user: any, mediaType: 'audio' | 'video') => {
      try {
        await client.subscribe(user, mediaType);
      } catch (e) {
        console.warn('[Agora][web] subscribe failed:', e);
        return;
      }
      this.remoteUid = user.uid;
      if (mediaType === 'video') {
        this.webRemoteTracks.video = user.videoTrack;
        this.callbacks.onRemoteVideo?.(true);
      } else {
        this.webRemoteTracks.audio = user.audioTrack;
        this.callbacks.onRemoteAudioMuted?.(false);
      }
      this._rebuildRemoteStream();
    });

    client.on('user-unpublished', (user: any, mediaType: 'audio' | 'video') => {
      if (mediaType === 'video') {
        this.webRemoteTracks.video = undefined;
        this.callbacks.onRemoteVideo?.(false);
      } else {
        this.webRemoteTracks.audio = undefined;
        this.callbacks.onRemoteAudioMuted?.(true);
      }
      this._rebuildRemoteStream();
    });

    client.on('user-left', () => {
      this.webRemoteTracks = {};
      this.remoteUid = null;
      this.remoteStream = null;
      this.callbacks.onRemoteVideo?.(false);
      this.callbacks.onRemoteStream?.(null);
    });

    client.on('connection-state-change', (cur: string) => {
      // CONNECTED | CONNECTING | RECONNECTING | DISCONNECTED | DISCONNECTING
      const mapped = cur === 'CONNECTED' ? 'connected'
        : cur === 'RECONNECTING' ? 'disconnected'
        : cur === 'DISCONNECTED' ? 'failed'
        : 'checking';
      this.callbacks.onConnectionStateChange?.(mapped);
    });

    client.on('network-quality', (stats: any) => {
      const q = mapQuality(stats?.downlinkNetworkQuality ?? 0);
      if (q !== this.currentQuality && q !== 'unknown') {
        this.currentQuality = q;
        this.callbacks.onQualityChange?.(q);
      }
    });

    // uid 0 → pass null so Agora auto-assigns; token is valid for any uid.
    const joinUid = this.config.uid === 0 ? null : this.config.uid;
    await client.join(this.config.app_id, this.config.channel, this.config.token, joinUid);

    this.webLocalAudio = await AgoraWeb.createMicrophoneAudioTrack();
    const toPublish: any[] = [this.webLocalAudio];
    if (this.isVideo) {
      // encoderConfig caps web capture to the HD tier (≤720p) — same cost
      // guard as native so browser calls never bill at the Full-HD rate.
      this.webLocalVideo = await AgoraWeb.createCameraVideoTrack({ encoderConfig: WEB_VIDEO_ENCODER });
      toPublish.push(this.webLocalVideo);
    }
    if (this.destroyed) { this._closeWebLocalTracks(); return null; }
    await client.publish(toPublish);

    this.localStream = this._buildStream([
      this.webLocalAudio?.getMediaStreamTrack?.(),
      this.webLocalVideo?.getMediaStreamTrack?.(),
    ]);
    this.callbacks.onLocalVideo?.(!!this.webLocalVideo);
    return this.localStream;
  }

  private _rebuildRemoteStream(): void {
    if (Platform.OS !== 'web') return;
    const tracks = [
      this.webRemoteTracks.audio?.getMediaStreamTrack?.(),
      this.webRemoteTracks.video?.getMediaStreamTrack?.(),
    ];
    this.remoteStream = this._buildStream(tracks);
    this.callbacks.onRemoteStream?.(this.remoteStream);
  }

  private _buildStream(tracks: any[]): any {
    const valid = tracks.filter(Boolean);
    try {
      const MS = (typeof MediaStream !== 'undefined') ? MediaStream : null;
      if (MS) return new MS(valid);
    } catch { /* fall through */ }
    return valid.length ? { __agora: true, tracks: valid } : null;
  }

  // ── Controls (parity with WebRTCService) ─────────────────────────────────────
  toggleMute(muted: boolean): void {
    this.localMuted = muted;
    try {
      if (Platform.OS === 'web') this.webLocalAudio?.setMuted?.(muted);
      else this.engine?.muteLocalAudioStream?.(muted);
    } catch (e) { console.warn('[Agora] toggleMute failed:', e); }
    this._sendMediaState();
  }

  async toggleCamera(enabled: boolean): Promise<void> {
    if (!this.isVideo) return;
    this.localCameraOff = !enabled;
    try {
      if (Platform.OS === 'web') {
        await this.webLocalVideo?.setEnabled?.(enabled);
      } else {
        this.engine?.enableLocalVideo?.(enabled);
        this.engine?.muteLocalVideoStream?.(!enabled);
      }
    } catch (e) { console.warn('[Agora] toggleCamera failed:', e); }
    this.callbacks.onLocalVideo?.(enabled);
    this._sendMediaState();
  }

  setSpeaker(on: boolean): void {
    // Native only — web has no output-routing API (audio plays through the
    // active output device).
    if (Platform.OS === 'web') return;
    try { this.engine?.setEnableSpeakerphone?.(on); } catch (e) { console.warn('[Agora] setSpeaker failed:', e); }
  }

  async switchCamera(): Promise<void> {
    if (!this.isVideo) return;
    try {
      if (Platform.OS === 'web') {
        // Web: pick the next camera deviceId and swap the published track.
        const cams = await AgoraWeb.getCameras?.();
        if (!cams || cams.length < 2 || !this.webLocalVideo) return;
        const cur = this.webLocalVideo.getTrackLabel?.();
        const next = cams.find((d: any) => d.label && d.label !== cur) ?? cams[0];
        await this.webLocalVideo.setDevice?.(next.deviceId);
      } else {
        this.engine?.switchCamera?.();
      }
    } catch (e) { console.warn('[Agora] switchCamera failed:', e); }
  }

  // No-op: Agora subscribes to remote media via events, there is no pull loop.
  triggerPull(): void { /* not applicable to Agora */ }

  private _sendMediaState(): void {
    if (this.destroyed) return;
    // Cross-provider peer badge relay (camera-off avatar / muted badge).
    API.sendMediaState(this.sessionId, {
      audio: !this.localMuted,
      video: !this.localCameraOff,
    }).catch(() => { /* best-effort */ });
  }

  private _closeWebLocalTracks(): void {
    try { this.webLocalAudio?.stop?.(); this.webLocalAudio?.close?.(); } catch {}
    try { this.webLocalVideo?.stop?.(); this.webLocalVideo?.close?.(); } catch {}
    this.webLocalAudio = null;
    this.webLocalVideo = null;
  }

  destroy(): void {
    this.destroyed = true;
    if (Platform.OS === 'web') {
      try { this.webClient?.unpublish?.(); } catch {}
      this._closeWebLocalTracks();
      try { this.webClient?.leave?.(); } catch {}
      this.webClient = null;
      this.webRemoteTracks = {};
    } else if (this.engine) {
      try { this.engine.stopPreview?.(); } catch {}
      try { this.engine.leaveChannel?.(); } catch {}
      try { this.engine.unregisterEventHandler?.({}); } catch {}
      try { this.engine.release?.(); } catch {}
      this.engine = null;
    }
    this.localStream = null;
    this.remoteStream = null;
    this.remoteUid = null;
  }
}
