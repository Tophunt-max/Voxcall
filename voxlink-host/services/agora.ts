// ============================================================================
// AgoraService — Agora RTC media transport (the only call transport).
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
// Web: agora-rtc-sdk-ng. Remote AUDIO is played by Agora itself via
//   remoteAudioTrack.play() (this satisfies mobile-browser autoplay policies far
//   better than attaching a MediaStream to an <audio>/<video> element, which is
//   why calls were sometimes silent). Only the remote VIDEO track is handed to
//   the screen as a MediaStream for the <video> tag — so audio never double-plays.
//
// RELIABILITY (why calls failed on some mobile networks):
//   Many carrier / corporate / captive networks block Agora's default UDP media
//   ports, so the RTC session never reaches "connected" — the user sees a
//   permanent "Connection issue", no remote video and no audio. To recover, we
//   arm a watchdog after joining: if the connection has not gone "connected"
//   within PROXY_RETRY_MS, we transparently re-establish it through Agora's
//   Cloud Proxy (TCP over port 443 on web / cloud proxy on native), which almost
//   always traverses restrictive firewalls. Local mic/camera tracks are REUSED
//   across the retry so the camera does not re-open.
//
// Both modules are loaded via require() (guarded) so a missing native module
// (pre-EAS-rebuild) degrades gracefully instead of crashing the bundle.
// ============================================================================

import { Platform } from 'react-native';
import { API } from './api';

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

// Callback surface the useWebRTC hook wires up. Agora is the only transport.
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
  // The direct connection stalled and we are re-establishing it through the
  // Agora Cloud Proxy. Lets the screen show a transient "weak connection,
  // reconnecting…" notice instead of a scary error.
  onProxyRetry?: () => void;
}

export interface AgoraJoinConfig {
  app_id: string;
  channel: string;
  uid: number;
  token: string;
  // Smart call-quality routing: the tier the local video encoder should START
  // at (server hint from the user's recent network history). Defaults to
  // 'high' when absent; live adaptation still takes over after connect.
  initialTier?: 'high' | 'medium' | 'low';
}

// Marker objects handed to the hook on native (where there is no MediaStream).
// They only need to be truthy; RtcVideoView renders by uid, not by stream.
const NATIVE_LOCAL_MARKER = { __agora: true, kind: 'local' as const };

// ── Adaptive video-quality tiers ─────────────────────────────────────────────
// Auto-quality steps the local encoder DOWN when the UPLINK is congested (so
// the call stays smooth instead of freezing) and back UP once it recovers.
// EVERY tier stays within Agora's HD billing tier (≤720p) so a call NEVER bills
// at the pricier Full-HD rate ($8.99 vs $3.99 / 1,000 min). Aspect ratio is
// kept constant per platform so a tier switch never re-frames the picture.
type QualityTier = 'high' | 'medium' | 'low';

const TIER_RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2 };

// Native (react-native-agora) — 9:16 portrait to match a phone selfie.
const NATIVE_TIERS: Record<QualityTier, { width: number; height: number; frameRate: number; bitrate: number }> = {
  high:   { width: 360, height: 640, frameRate: 24, bitrate: 800 },
  medium: { width: 270, height: 480, frameRate: 20, bitrate: 450 },
  low:    { width: 180, height: 320, frameRate: 15, bitrate: 200 },
};

// Web (agora-rtc-sdk-ng) — 4:3, typical webcam capture.
const WEB_TIERS: Record<QualityTier, { width: number; height: number; frameRate: number; bitrateMin: number; bitrateMax: number }> = {
  high:   { width: 640, height: 480, frameRate: 24, bitrateMin: 350, bitrateMax: 900 },
  medium: { width: 480, height: 360, frameRate: 20, bitrateMin: 200, bitrateMax: 550 },
  low:    { width: 320, height: 240, frameRate: 15, bitrateMin: 100, bitrateMax: 280 },
};

// After ANY tier change, wait this long before UPGRADING again so a single good
// network sample cannot cause the quality to flap. Downgrades are immediate.
const QUALITY_UPGRADE_COOLDOWN_MS = 12000;

// If the RTC session has not reached "connected" within this window after the
// initial join, assume the network is blocking Agora's direct media path and
// transparently retry through the Cloud Proxy. Kept comfortably below the call
// screens' connect timeouts (30 s video / 45 s audio) so the proxy attempt has
// time to succeed before the screen force-ends the call.
const PROXY_RETRY_MS = 8000;

// agora-rtc-sdk-ng startProxyServer() mode: 5 = force cloud proxy over TCP/TLS
// on port 443. This is the mode most likely to traverse restrictive mobile /
// corporate firewalls that drop Agora's default UDP media traffic.
const WEB_PROXY_MODE_TCP443 = 5;

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

  // Connection / cloud-proxy recovery state.
  private connected = false;
  private proxyRetried = false;
  private cameraFailed = false;
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;

  // Adaptive auto-quality state — starts at the top tier and follows the live
  // uplink network quality.
  private currentTier: QualityTier = 'high';
  private lastTierChangeAt = 0;

  constructor(sessionId: string, isVideo: boolean, callbacks: AgoraCallbacks, config: AgoraJoinConfig) {
    this.sessionId = sessionId;
    this.isVideo = isVideo;
    this.callbacks = callbacks;
    this.config = config;
    // Smart call-quality routing: start at the server-recommended tier instead
    // of always 'high'. Live adaptation still ramps this up/down after connect.
    if (config.initialTier === 'medium' || config.initialTier === 'low') {
      this.currentTier = config.initialTier;
    }
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
      const stream = Platform.OS === 'web' ? await this._startWeb() : await this._startNative();
      // Arm the cloud-proxy watchdog once the initial join is under way. If the
      // connection is already up (fast network) the watchdog no-ops.
      this._armConnectWatchdog();
      return stream;
    } catch (error: any) {
      console.error('[Agora] start error:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  // ── Connection tracking + cloud-proxy recovery ───────────────────────────
  // Every connection-state transition funnels through here so we can (a) clear
  // the watchdog the moment we connect, and (b) forward the state to the UI.
  private _emitConnState(mapped: string): void {
    if (mapped === 'connected') {
      this.connected = true;
      this._clearConnectWatchdog();
    }
    this.callbacks.onConnectionStateChange?.(mapped);
  }

  private _armConnectWatchdog(): void {
    if (this.connected || this.proxyRetried || this.destroyed) return;
    this._clearConnectWatchdog();
    this.connectWatchdog = setTimeout(() => {
      if (this.connected || this.proxyRetried || this.destroyed) return;
      console.warn(`[Agora] not connected within ${PROXY_RETRY_MS}ms — retrying via Cloud Proxy`);
      this._enableProxyAndRetry();
    }, PROXY_RETRY_MS);
  }

  private _clearConnectWatchdog(): void {
    if (this.connectWatchdog) {
      clearTimeout(this.connectWatchdog);
      this.connectWatchdog = null;
    }
  }

  private _enableProxyAndRetry(): void {
    if (this.proxyRetried || this.destroyed) return;
    this.proxyRetried = true;
    this.callbacks.onProxyRetry?.();
    if (Platform.OS === 'web') {
      this._enableProxyAndRetryWeb().catch((e) => {
        console.error('[Agora][web] proxy retry failed:', e);
        this.callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
      });
    } else {
      this._enableProxyNative();
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
        console.info('[Agora][native] join channel success');
        this._emitConnState('connected');
      },
      onUserJoined: (_conn: any, remoteUid: number) => {
        console.info('[Agora][native] remote user joined:', remoteUid);
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
        console.info('[Agora][native] connection-state:', state, '→', mapped);
        this._emitConnState(mapped);
      },
      onNetworkQuality: (_conn: any, uid: number, tx: number, rx: number) => {
        // uid 0 = local user's own uplink/downlink stats.
        if (uid !== 0) return;
        // Signal bars reflect DOWNLINK (how good the video we RECEIVE is).
        const q = mapQuality(rx);
        if (q !== this.currentQuality && q !== 'unknown') {
          this.currentQuality = q;
          this.callbacks.onQualityChange?.(q);
        }
        // Auto-quality follows UPLINK (how much WE can send) so we scale our
        // OWN outgoing video to keep it smooth on a congested uplink.
        const up = mapQuality(tx);
        if (up !== 'unknown') this._maybeAdaptQuality(up);
      },
      onError: (err: number, msg: string) => {
        console.error('[Agora][native] error', err, msg ?? '');
        this.callbacks.onError?.(new Error(`Agora error ${err}: ${msg ?? ''}`));
      },
    });

    engine.enableAudio();
    if (this.isVideo) {
      engine.enableVideo();
      // Apply the initial (high) encoder tier. Auto-quality re-encodes live via
      // _maybeAdaptQuality() as the uplink network quality changes. All tiers
      // stay within Agora's HD billing tier (≤720p).
      this._applyVideoTier(this.currentTier);
      engine.startPreview();
      this.callbacks.onLocalVideo?.(true);
    } else {
      engine.disableVideo();
    }
    // Video calls default to loudspeaker, audio calls to earpiece.
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

  // Native cloud proxy takes effect live (no rejoin needed).
  private _enableProxyNative(): void {
    if (!this.engine) return;
    try {
      const CloudProxyType = AgoraNative?.CloudProxyType;
      // UdpProxy routes media through Agora's cloud proxy servers, which helps
      // on symmetric-NAT / firewalled networks that drop direct media.
      this.engine.setCloudProxy?.(CloudProxyType?.UdpProxy ?? 1);
      console.warn('[Agora][native] cloud proxy enabled after stalled connection');
    } catch (e) {
      console.warn('[Agora][native] setCloudProxy failed:', e);
    }
  }

  // ── Adaptive auto-quality ────────────────────────────────────────────────
  // Which tier a given uplink quality should map to. 'unknown' keeps the
  // current tier (no data → no change).
  private _targetTierFor(uplink: ConnectionQuality): QualityTier {
    switch (uplink) {
      case 'excellent':
      case 'good': return 'high';
      case 'poor': return 'medium';
      case 'lost': return 'low';
      default: return this.currentTier;
    }
  }

  // Called on every uplink network-quality sample. Downgrades IMMEDIATELY when
  // the uplink weakens (react to congestion fast so the picture doesn't freeze)
  // and upgrades only after a cooldown (so one good sample can't cause flapping).
  private _maybeAdaptQuality(uplink: ConnectionQuality): void {
    if (this.destroyed || !this.isVideo || this.localCameraOff) return;
    const target = this._targetTierFor(uplink);
    if (target === this.currentTier) return;
    const now = Date.now();
    const goingUp = TIER_RANK[target] > TIER_RANK[this.currentTier];
    if (goingUp && now - this.lastTierChangeAt < QUALITY_UPGRADE_COOLDOWN_MS) return;
    this.currentTier = target;
    this.lastTierChangeAt = now;
    this._applyVideoTier(target);
  }

  // Re-encode the local video to the given tier (live, mid-call).
  private _applyVideoTier(tier: QualityTier): void {
    if (!this.isVideo) return;
    try {
      if (Platform.OS === 'web') {
        if (!this.webLocalVideo) return;
        const cfg = WEB_TIERS[tier];
        const p = this.webLocalVideo.setEncoderConfiguration?.(cfg);
        if (p && typeof p.catch === 'function') {
          p.catch((e: any) => console.warn('[Agora][web] setEncoderConfiguration failed:', e));
        }
        console.info('[Agora][web] video quality →', tier, cfg);
      } else {
        if (!this.engine) return;
        const cfg = NATIVE_TIERS[tier];
        this.engine.setVideoEncoderConfiguration?.({
          dimensions: { width: cfg.width, height: cfg.height },
          frameRate: cfg.frameRate,
          bitrate: cfg.bitrate,
          orientationMode: AgoraNative?.OrientationMode?.OrientationModeAdaptive,
          // Balance resolution vs framerate when Agora itself has to degrade on
          // top of our tiering.
          degradationPreference: AgoraNative?.DegradationPreference?.MaintainBalanced,
        });
        console.info('[Agora][native] video quality →', tier, cfg);
      }
    } catch (e) {
      console.warn('[Agora] applyVideoTier failed:', e);
    }
  }

  // ── Web (agora-rtc-sdk-ng) ──────────────────────────────────────────────────
  // Registers every remote-media / connection handler on a client. Extracted so
  // the cloud-proxy retry can build a fresh client and rewire it identically.
  private _registerWebHandlers(client: any): void {
    client.on('user-published', async (user: any, mediaType: 'audio' | 'video') => {
      try {
        await client.subscribe(user, mediaType);
      } catch (e) {
        console.warn('[Agora][web] subscribe failed:', e);
        return;
      }
      console.info('[Agora][web] subscribed to remote', mediaType, 'from', user.uid);
      this.remoteUid = user.uid;
      if (mediaType === 'video') {
        this.webRemoteTracks.video = user.videoTrack;
        this.callbacks.onRemoteVideo?.(true);
      } else {
        this.webRemoteTracks.audio = user.audioTrack;
        this.callbacks.onRemoteAudioMuted?.(false);
        // Play remote audio through Agora itself. Its play() creates a managed
        // element and cooperates with mobile-browser autoplay policies (auto-
        // resuming on the next user gesture), which the previous MediaStream-on-
        // <audio> approach did not — that was a source of silent calls.
        try { user.audioTrack?.play?.(); } catch (e) { console.warn('[Agora][web] audioTrack.play failed:', e); }
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
      console.info('[Agora][web] connection-state:', cur, '→', mapped);
      this._emitConnState(mapped);
    });

    client.on('network-quality', (stats: any) => {
      // Signal bars reflect DOWNLINK (received) quality.
      const q = mapQuality(stats?.downlinkNetworkQuality ?? 0);
      if (q !== this.currentQuality && q !== 'unknown') {
        this.currentQuality = q;
        this.callbacks.onQualityChange?.(q);
      }
      // Auto-quality follows UPLINK (sent) quality.
      const up = mapQuality(stats?.uplinkNetworkQuality ?? 0);
      if (up !== 'unknown') this._maybeAdaptQuality(up);
    });
  }

  // Create local mic/camera tracks ONCE and reuse them (so a cloud-proxy retry
  // does not re-open the camera). A failed camera degrades to audio-only rather
  // than failing the whole call.
  private async _ensureWebLocalTracks(): Promise<any[]> {
    if (!this.webLocalAudio) {
      this.webLocalAudio = await AgoraWeb.createMicrophoneAudioTrack();
    }
    if (this.isVideo && !this.webLocalVideo && !this.cameraFailed) {
      try {
        // Start at the HIGH tier; auto-quality re-encodes live via
        // _maybeAdaptQuality() based on uplink quality. All tiers stay within
        // Agora's HD tier (≤720p) so browser calls never bill at Full-HD.
        this.webLocalVideo = await AgoraWeb.createCameraVideoTrack({ encoderConfig: WEB_TIERS[this.currentTier] });
      } catch (e: any) {
        // Camera busy / blocked / unreadable — continue as an audio-only call
        // instead of stalling forever on "Starting camera…".
        this.cameraFailed = true;
        this.webLocalVideo = null;
        console.warn('[Agora][web] camera unavailable — continuing audio-only:', e?.message ?? e);
      }
    }
    return [this.webLocalAudio, this.webLocalVideo].filter(Boolean);
  }

  private async _startWeb(withProxy = false): Promise<any> {
    if (!AgoraWeb) throw new Error('agora-rtc-sdk-ng unavailable');
    const client = AgoraWeb.createClient({ mode: 'rtc', codec: 'vp8' });
    this.webClient = client;
    this._registerWebHandlers(client);

    if (withProxy) {
      try {
        client.startProxyServer(WEB_PROXY_MODE_TCP443);
        console.warn('[Agora][web] joining via Cloud Proxy (TCP/443)');
      } catch (e) {
        console.warn('[Agora][web] startProxyServer failed:', e);
      }
    }

    // uid 0 → pass null so Agora auto-assigns; token is valid for any uid.
    const joinUid = this.config.uid === 0 ? null : this.config.uid;
    await client.join(this.config.app_id, this.config.channel, this.config.token, joinUid);
    console.info('[Agora][web] joined channel', this.config.channel);

    if (this.destroyed) { this._closeWebLocalTracks(); return null; }
    const toPublish = await this._ensureWebLocalTracks();
    if (!this.webLocalAudio) throw new Error('Microphone unavailable');
    if (this.destroyed) { this._closeWebLocalTracks(); return null; }
    await client.publish(toPublish);
    console.info('[Agora][web] published local tracks', { audio: !!this.webLocalAudio, video: !!this.webLocalVideo });

    this.localStream = this._buildStream([
      this.webLocalAudio?.getMediaStreamTrack?.(),
      this.webLocalVideo?.getMediaStreamTrack?.(),
    ]);
    this.callbacks.onLocalVideo?.(!!this.webLocalVideo);
    return this.localStream;
  }

  // Tear down the current web client and rejoin through the Cloud Proxy, REUSING
  // the already-created local tracks (no camera re-open).
  private async _enableProxyAndRetryWeb(): Promise<void> {
    const old = this.webClient;
    try { await old?.unpublish?.(); } catch { /* ignore */ }
    try { await old?.leave?.(); } catch { /* ignore */ }
    if (this.destroyed) return;

    const client = AgoraWeb.createClient({ mode: 'rtc', codec: 'vp8' });
    this.webClient = client;
    this._registerWebHandlers(client);
    try {
      client.startProxyServer(WEB_PROXY_MODE_TCP443);
    } catch (e) {
      console.warn('[Agora][web] startProxyServer (retry) failed:', e);
    }

    const joinUid = this.config.uid === 0 ? null : this.config.uid;
    await client.join(this.config.app_id, this.config.channel, this.config.token, joinUid);
    console.warn('[Agora][web] rejoined via Cloud Proxy');
    if (this.destroyed) return;
    const toPublish = [this.webLocalAudio, this.webLocalVideo].filter(Boolean);
    if (toPublish.length) await client.publish(toPublish);
  }

  private _rebuildRemoteStream(): void {
    if (Platform.OS !== 'web') return;
    const videoTrack = this.webRemoteTracks.video?.getMediaStreamTrack?.();
    if (videoTrack) {
      // Only the remote VIDEO track is rendered by the <video> element. Remote
      // audio is played by Agora (audioTrack.play() above), so it is
      // deliberately NOT in this stream — that prevents double audio.
      this.remoteStream = this._buildStream([videoTrack]);
    } else if (this.webRemoteTracks.audio) {
      // Audio-only (voice call, or remote camera off): there is nothing to
      // render, but the screens use remoteStream truthiness as a "remote
      // present / media arrived" signal, so hand them a lightweight marker.
      this.remoteStream = { __agora: true, kind: 'remote-audio' };
    } else {
      this.remoteStream = null;
    }
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

  // ── Controls (call-screen lifecycle) ─────────────────────────────────────
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
    this._clearConnectWatchdog();
    if (Platform.OS === 'web') {
      try { this.webClient?.stopProxyServer?.(); } catch {}
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
