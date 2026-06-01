import { Platform } from 'react-native';
import { API } from './api';

interface CFPullTrack {
  mid?: string;
  trackName?: string;
  errorCode?: string;
  errorDescription?: string;
}

let RTC: any = null;
let mediaDevicesRef: any = null;
let MediaStreamClass: any = null;

try {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && (window as any).RTCPeerConnection) {
      RTC = {
        RTCPeerConnection: (window as any).RTCPeerConnection,
        RTCSessionDescription: (window as any).RTCSessionDescription,
      };
      mediaDevicesRef = (navigator as any).mediaDevices;
    }
  } else {
    // Cloudflare's fork of react-native-webrtc — drop-in replacement that
    // tracks libwebrtc one minor release ahead. Same JS API surface
    // (RTCPeerConnection, mediaDevices, MediaStream, RTCView, _switchCamera,
    // etc.) so the rest of this file is unchanged.
    const webrtc = require('@cloudflare/react-native-webrtc');
    RTC = {
      RTCPeerConnection: webrtc.RTCPeerConnection,
      RTCSessionDescription: webrtc.RTCSessionDescription,
    };
    mediaDevicesRef = webrtc.mediaDevices;
    MediaStreamClass = webrtc.MediaStream;
  }
} catch {
  RTC = null;
}

// FIX (#1 — speaker/earpiece audio routing): InCallManager actually routes the
// live call audio between the loudspeaker and the earpiece. WebRTC alone has
// no output-routing control, so previously the in-call Speaker button only
// flipped a UI flag without changing where the audio played. Native-only
// (Android/iOS); on web there is no programmatic output switch, so this stays
// null and setSpeaker() becomes a harmless no-op.
let InCallManager: any = null;
try {
  if (Platform.OS !== 'web') {
    InCallManager = require('react-native-incall-manager').default;
  }
} catch {
  InCallManager = null;
}

export function isWebRTCAvailable(): boolean {
  return RTC !== null && mediaDevicesRef !== null;
}

// FIX (video quality): target ceiling for the video stream. 720p30 looks
// crisp at ~2.5 Mbps. This is a CEILING, not a forced rate — WebRTC's
// congestion control (transport-cc / REMB) still scales the encoder DOWN
// automatically on weak networks, so raising it never causes overshoot; it
// only lets quality go UP when bandwidth is available. The old value was
// ~1.2 Mbps which produced a soft / blocky picture even on good Wi-Fi.
const VIDEO_MAX_KBPS = 2500;
const VIDEO_MAX_BPS = VIDEO_MAX_KBPS * 1000;

// Inject (or replace) the bandwidth lines on every video m-section of an SDP
// so neither the local encoder nor the Cloudflare SFU caps quality at the
// conservative WebRTC default. We apply this to BOTH the push offer (raises
// what WE send) and the pull answer (raises what the SFU sends US — i.e. what
// the user actually sees). `b=AS` is in kbps (Chromium/libwebrtc); `b=TIAS`
// is in bps (RFC 3890). Bandwidth lines must immediately follow the `c=` line
// per RFC 4566 ordering.
function preferVideoBitrate(sdp: string, kbps: number): string {
  if (!sdp) return sdp;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r\n|\n/);
  const out: string[] = [];
  let inVideo = false;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      inVideo = line.startsWith('m=video');
      out.push(line);
      continue;
    }
    // Strip any pre-existing bandwidth caps inside the video section so we
    // don't end up with stale / duplicate b= lines.
    if (inVideo && (line.startsWith('b=AS:') || line.startsWith('b=TIAS:'))) {
      continue;
    }
    out.push(line);
    if (inVideo && line.startsWith('c=')) {
      out.push(`b=AS:${kbps}`);
      out.push(`b=TIAS:${kbps * 1000}`);
    }
  }
  return out.join(eol);
}

// FIX (audio robustness on lossy mobile networks): enable Opus in-band FEC
// (forward error correction) and DTX (discontinuous transmission) on the audio
// m-section. FEC lets the decoder reconstruct lost packets from redundancy
// carried in subsequent packets — a big win for voice clarity on cellular /
// congested Wi-Fi — while DTX trims bitrate during silence. We apply it to
// every SDP we set locally (push offer + pull answer) so both directions
// benefit, regardless of how the SFU forwards. Safe no-op when there is no
// Opus payload.
function preferAudioRobustness(sdp: string): string {
  if (!sdp) return sdp;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r\n|\n/);

  // Resolve the Opus payload type from its rtpmap (e.g. "a=rtpmap:111 opus/48000/2").
  let opusPt: string | null = null;
  for (const line of lines) {
    const m = /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(line);
    if (m) { opusPt = m[1]; break; }
  }
  if (!opusPt) return sdp;

  const want = ['useinbandfec=1', 'usedtx=1'];
  const out: string[] = [];
  let patched = false;
  for (const line of lines) {
    if (!patched && line.startsWith(`a=fmtp:${opusPt}`)) {
      let params = line.slice(`a=fmtp:${opusPt}`.length).trim();
      for (const kv of want) {
        const key = kv.split('=')[0];
        if (!new RegExp(`(^|;)\\s*${key}=`).test(params)) {
          params = params ? `${params};${kv}` : kv;
        }
      }
      out.push(`a=fmtp:${opusPt} ${params}`);
      patched = true;
      continue;
    }
    out.push(line);
  }

  // Opus had an rtpmap but no fmtp line — synthesise one right after the rtpmap.
  if (!patched) {
    const result: string[] = [];
    for (const line of out) {
      result.push(line);
      if (new RegExp(`^a=rtpmap:${opusPt}\\s+opus/48000`, 'i').test(line)) {
        result.push(`a=fmtp:${opusPt} ${want.join(';')}`);
      }
    }
    return result.join(eol);
  }

  return out.join(eol);
}

// FIX (TURN / no-audio on UDP-blocked networks): even with a serverless SFU
// (Cloudflare Calls), clients on networks that block UDP outbound can't
// reach the SFU's edge. TURN-over-TCP/TLS provides a 443 tunnel to the SFU.
// We try to fetch the live config from /api/calls/ice-config (which mints
// short-lived Cloudflare TURN credentials when configured) and fall back to
// this static list if the fetch fails — so call setup never breaks because
// of a transient backend hiccup.
const FALLBACK_ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export interface WebRTCCallbacks {
  onRemoteStream?: (stream: any) => void;
  onConnectionStateChange?: (state: string) => void;
  onError?: (error: Error) => void;
  // Periodic call-quality signal derived from getStats() (packet loss + RTT +
  // jitter) while the connection is live, so the UI can show real network bars
  // instead of a binary connected/disconnected flag.
  onQualityChange?: (quality: ConnectionQuality, detail?: { rtt?: number; packetLoss?: number; jitter?: number }) => void;
}

export class WebRTCService {
  private pc: any = null;
  private localStream: any = null;
  private remoteStream: any = null;
  // FIX (camera re-enable): cache the outbound video sender so toggleCamera can
  // attach a freshly-acquired track via replaceTrack without an SFU
  // renegotiation when the previous track ended / was never created.
  private videoSender: any = null;
  private sessionId: string;
  private callbacks: WebRTCCallbacks;
  private isVideo: boolean;
  private destroyed = false;

  private pushCompleted = false;
  private pullStarted = false;
  private pullRunning = false;
  private triggerPullPending = false;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestartAttempts = 0;
  private readonly MAX_ICE_RESTART_ATTEMPTS = 5;

  // Local mic/camera state, mirrored to the peer via API.sendMediaState so the
  // remote UI reacts instantly (see toggleMute / toggleCamera).
  private localMuted = false;
  private localCameraOff = false;

  // getStats()-based quality monitor.
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastStatSample: { lost: number; recv: number } | null = null;
  private currentQuality: ConnectionQuality = 'unknown';

  constructor(
    sessionId: string,
    isVideo: boolean,
    callbacks: WebRTCCallbacks
  ) {
    this.sessionId = sessionId;
    this.isVideo = isVideo;
    this.callbacks = callbacks;
  }

  private waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.pc) { resolve(); return; }
      if (this.pc.iceGatheringState === 'complete') { resolve(); return; }

      const timeout = setTimeout(() => {
        this.pc?.removeEventListener('icegatheringstatechange', handler);
        resolve();
      }, 3000);

      const handler = () => {
        if (this.pc?.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          this.pc.removeEventListener('icegatheringstatechange', handler);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', handler);
    });
  }

  // FIX (camera fails to start / "Camera off"): robustly acquire the local
  // MediaStream. Tries HD first, then progressively relaxes the video
  // constraints, and (for video calls) falls back to audio-only as a last
  // resort so a transient camera failure never kills the whole call. Real
  // permission denials (NotAllowedError) are rethrown immediately so the UI
  // can re-prompt rather than silently degrading.
  private async acquireLocalStream(): Promise<any> {
    const hdVideo = {
      facingMode: 'user',
      width:  { min: 320, ideal: 1280, max: 1920 },
      height: { min: 240, ideal: 720,  max: 1080 },
      frameRate: { min: 15, ideal: 30, max: 30 },
      aspectRatio: { ideal: 16 / 9 },
    };
    const attempts: any[] = this.isVideo
      ? [
          { audio: true, video: hdVideo },
          { audio: true, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
          { audio: true, video: { facingMode: 'user' } },
          { audio: true, video: true },
          { audio: true, video: false }, // last resort: connect audio-only
        ]
      : [{ audio: true, video: false }];

    let lastErr: any = null;
    for (let i = 0; i < attempts.length; i++) {
      if (this.destroyed) throw new Error('cancelled');
      try {
        const stream = await mediaDevicesRef.getUserMedia(attempts[i]);
        if (i > 0) {
          console.warn(`[WebRTC] getUserMedia succeeded after relaxing constraints (attempt ${i + 1}/${attempts.length})`);
        }
        return stream;
      } catch (e: any) {
        lastErr = e;
        const name = String(e?.name ?? '');
        const msg = String(e?.message ?? e ?? '');
        // A genuine permission denial won't be fixed by relaxing constraints —
        // surface it immediately so the screen can re-prompt (once).
        if (/NotAllowed/i.test(name) || /NotAllowed/i.test(msg) ||
            /permission/i.test(msg) || /SecurityError/i.test(name)) {
          throw e;
        }
        // Transient hardware error (camera busy from the permission-check
        // release, source not readable) or unsatisfiable constraints — pause
        // briefly to let the device release the camera, then try the next,
        // more relaxed attempt.
        console.warn(`[WebRTC] getUserMedia attempt ${i + 1} failed (${name || msg}); retrying`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw lastErr ?? new Error('getUserMedia failed');
  }

  async start(): Promise<any> {
    if (this.destroyed || !RTC) return null;

    try {
      // FIX (TURN): fetch ICE config from backend (Cloudflare TURN creds when
      // available) so calls work on networks that block UDP. If the request
      // fails or returns nothing usable we fall back to the static list — we
      // never want a transient backend error to make calls completely
      // un-startable. The whole fetch is bounded by a 3 s soft timeout.
      let iceServers: any[] = FALLBACK_ICE_SERVERS;
      let iceCandidatePoolSize = 10;
      let bundlePolicy: any = 'max-bundle';
      let rtcpMuxPolicy: any = 'require';
      try {
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
        const cfg = await API.getIceConfig().finally(() => { if (timer) clearTimeout(timer); });
        if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length > 0) {
          iceServers = cfg.iceServers as any[];
          if (typeof cfg.iceCandidatePoolSize === 'number') iceCandidatePoolSize = cfg.iceCandidatePoolSize;
          if (cfg.bundlePolicy) bundlePolicy = cfg.bundlePolicy;
          if (cfg.rtcpMuxPolicy) rtcpMuxPolicy = cfg.rtcpMuxPolicy;
        }
      } catch (e: any) {
        console.warn('[WebRTC] ICE config fetch failed, using fallback:', e?.message ?? e);
      }

      this.pc = new RTC.RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize,
        bundlePolicy,
        rtcpMuxPolicy,
      });

      try {
        const MS = MediaStreamClass ?? (typeof MediaStream !== 'undefined' ? MediaStream : null);
        if (MS) this.remoteStream = new MS();
      } catch {
        this.remoteStream = null;
      }

      this.pc.addEventListener('track', (event: any) => {
        if (event.streams && event.streams[0]) {
          this.remoteStream = event.streams[0];
        } else if (event.track) {
          if (this.remoteStream) {
            this.remoteStream.addTrack(event.track);
          }
        }
        if (this.remoteStream && this.callbacks.onRemoteStream) {
          this.callbacks.onRemoteStream(this.remoteStream);
        }
      });

      this.pc.addEventListener('connectionstatechange', () => {
        const state = this.pc?.connectionState || 'unknown';
        this.callbacks.onConnectionStateChange?.(state);
        this._handleConnectivity(state);
      });

      // Secondary connectivity signal. On some react-native-webrtc (Android)
      // builds connectionState never advances to 'connected' even when ICE and
      // media are fully up — so we also drive reconnection + the UI state off
      // the ICE connection state, surfacing 'connected' when ICE is up.
      this.pc.addEventListener('iceconnectionstatechange', () => {
        const ice = this.pc?.iceConnectionState || 'unknown';
        if ((ice === 'connected' || ice === 'completed') && this.pc?.connectionState !== 'connected') {
          this.callbacks.onConnectionStateChange?.('connected');
        }
        this._handleConnectivity(ice);
      });

      // FIX (camera fails to start / "Camera off"): acquire local media with a
      // retry + constraint-fallback ladder instead of a single getUserMedia
      // call. On web the permission pre-check (usePermissions) opens then
      // immediately STOPS a camera stream; re-acquiring video+audio a moment
      // later can transiently fail with NotReadableError / "Could not start
      // video source", and the HD `min` values can throw OverconstrainedError
      // on some devices — both of which previously left the user with no local
      // video. acquireLocalStream() retries with progressively relaxed
      // constraints and, as a last resort on a video call, falls back to
      // audio-only so the call still connects.
      this.localStream = await this.acquireLocalStream();

      // FIX (#1): initialise audio routing for this call. Video calls default
      // to the loudspeaker, audio calls to the earpiece — matching the UI
      // defaults (CallContext sets isSpeakerOn = type === 'video'). The in-call
      // Speaker button then drives setSpeaker(). No-op on web.
      try {
        InCallManager?.start?.({ media: this.isVideo ? 'video' : 'audio' });
        InCallManager?.setForceSpeakerphoneOn?.(this.isVideo);
      } catch (e) {
        console.warn('[WebRTC] InCallManager.start failed:', e);
      }

      this.localStream.getTracks().forEach((track: any) => {
        this.pc?.addTrack(track, this.localStream);
      });

      // FIX (video clarity): give the outbound video sender real headroom so
      // the encoder can deliver a sharp HD picture (see _applyVideoSenderParams).
      if (this.isVideo) {
        this.videoSender = this.pc.getSenders?.().find((s: any) => s.track?.kind === 'video') ?? null;
        await this._applyVideoSenderParams();
      }

      await this.pushLocalTracks();

      this.pushCompleted = true;
      if (this.triggerPullPending) {
        this.triggerPullPending = false;
        this._startPull();
      } else {
        // Fallback: pull after 5 seconds if no peer_tracks_ready event arrives
        this.pullTimer = setTimeout(() => {
          if (!this.pullStarted) {
            this.pullStarted = true;
            this.pullRunning = true;
            this.pullRemoteTracks();
          }
        }, 5000);
      }

      return this.localStream;
    } catch (error: any) {
      console.error('WebRTC start error:', error);
      this.callbacks.onError?.(error);
      return null;
    }
  }

  // triggerPull: called by socket PEER_TRACKS_READY event.
  // If pull hasn't started yet → start immediately.
  // If pull already ran and finished (not currently running) → restart.
  // If pull is currently running → it will succeed on next retry.
  public triggerPull(): void {
    if (this.destroyed) return;
    if (!this.pushCompleted) {
      this.triggerPullPending = true;
      return;
    }
    if (this.pullRunning) {
      // Pull loop is active — it will pick up the remote tracks on next retry
      return;
    }
    // Either never started or previously finished — (re)start
    this.pullStarted = false;
    this._startPull();
  }

  private _startPull(): void {
    if (this.pullStarted) return;
    this.pullStarted = true;
    this.pullRunning = true;
    if (this.pullTimer) {
      clearTimeout(this.pullTimer);
      this.pullTimer = null;
    }
    this.pullRemoteTracks();
  }

  // FIX (video quality): set the local description after raising the video
  // bandwidth ceiling in its SDP. Munging BEFORE setLocalDescription means the
  // description we forward to CF Calls (this.pc.localDescription) carries the
  // b=AS / b=TIAS lines — applied to both the push offer (what we send) and
  // the pull answer (what the SFU sends us). Falls back to the un-munged
  // description on any error so call setup never breaks.
  private async _setLocalWithBitrate(desc: any): Promise<void> {
    let finalDesc: any = desc;
    try {
      if (desc?.sdp) {
        // Always raise audio robustness (Opus FEC/DTX); additionally raise the
        // video bitrate ceiling for video calls. Both directions (push offer +
        // pull answer) flow through here.
        let sdp = preferAudioRobustness(desc.sdp);
        if (this.isVideo) sdp = preferVideoBitrate(sdp, VIDEO_MAX_KBPS);
        finalDesc = RTC?.RTCSessionDescription
          ? new RTC.RTCSessionDescription({ type: desc.type, sdp })
          : { type: desc.type, sdp };
      }
    } catch {
      finalDesc = desc;
    }
    await this.pc.setLocalDescription(finalDesc);
  }

  private async pushLocalTracks(): Promise<void> {
    if (!this.pc || this.destroyed) return;

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.isVideo,
    });

    await this._setLocalWithBitrate(offer);
    await this.waitForIceGathering();

    const localDesc = this.pc.localDescription;
    if (!localDesc) return;

    const transceivers = this.pc.getTransceivers ? this.pc.getTransceivers() : [];
    let tracks: Array<{ mid: string; trackName: string }>;

    if (transceivers.length > 0) {
      tracks = transceivers
        .filter((t: any) => t.sender?.track)
        .map((t: any) => ({
          mid: t.mid || String(transceivers.indexOf(t)),
          // MID-INDEPENDENT track names: name purely by media kind ("audio" /
          // "video"). The previous `${kind}-${mid}` scheme broke when a
          // platform assigned MIDs in a different order than the puller assumed
          // (it hardcoded audio-0 / video-1), so the pull requested a track
          // name that never existed and media silently never arrived. There is
          // at most one audio and one video sender per 1:1 call, so the kind
          // alone is unique within the session and both sides always agree.
          trackName: t.sender.track.kind,
        }));
    } else {
      tracks = [{ mid: '0', trackName: 'audio' }];
      if (this.isVideo) {
        tracks.push({ mid: '1', trackName: 'video' });
      }
    }

    try {
      const result = await API.pushTracks(
        this.sessionId,
        localDesc.sdp,
        localDesc.type,
        tracks
      );

      if (result.answer && RTC.RTCSessionDescription) {
        const answerDesc = new RTC.RTCSessionDescription(result.answer);
        await this.pc.setRemoteDescription(answerDesc);
      }
    } catch (error: any) {
      console.error('Push tracks error:', error);
      this.callbacks.onError?.(error);
    }
  }

  private async pullRemoteTracks(): Promise<void> {
    if (!this.pc || this.destroyed) return;

    const trackNames = ['audio'];
    if (this.isVideo) {
      trackNames.push('video');
    }

    // Bounded retry: the remote may not have published yet. We retry with a
    // short backoff capped at 3s, but no longer loop forever — after
    // MAX_PULL_ATTEMPTS (~90s) we stop and surface a soft error so the call
    // screen can react instead of spinning silently and burning CF API calls.
    // A late peer_tracks_ready socket event still restarts the pull via
    // triggerPull() with a fresh counter, so this only bounds the *idle* case
    // where the other side genuinely never connects.
    const MAX_PULL_ATTEMPTS = 30;
    let attempt = 0;

    while (!this.destroyed && attempt < MAX_PULL_ATTEMPTS) {
      try {
        const result = await API.pullTracks(this.sessionId, trackNames);

        if (!result.offer) {
          // retryable: remote tracks not published yet
          attempt++;
          await new Promise(r => setTimeout(r, Math.min(2000 + attempt * 200, 3000)));
          continue;
        }

        const hasTrackErrors = (result.tracks as CFPullTrack[])?.some((t) => t.errorCode);
        if (hasTrackErrors) {
          attempt++;
          await new Promise(r => setTimeout(r, Math.min(2000 + attempt * 200, 3000)));
          continue;
        }

        if (RTC.RTCSessionDescription) {
          const offerDesc = new RTC.RTCSessionDescription(result.offer);
          await this.pc.setRemoteDescription(offerDesc);

          const answer = await this.pc.createAnswer();
          await this._setLocalWithBitrate(answer);

          await this.waitForIceGathering();

          const finalDesc = this.pc.localDescription;
          if (finalDesc) {
            await API.sendPullAnswer(
              this.sessionId,
              finalDesc.sdp,
              finalDesc.type
            );
          }
        }

        this.pullRunning = false;
        return;
      } catch (error: any) {
        attempt++;
        if (!this.destroyed) {
          await new Promise(r => setTimeout(r, Math.min(2000 + attempt * 200, 3000)));
        }
      }
    }

    this.pullRunning = false;
    // Exhausted the attempt budget without ever pulling the remote tracks (and
    // not because we were torn down) — tell the UI the other side never
    // connected media so it can show an error / offer to retry.
    if (!this.destroyed && attempt >= MAX_PULL_ATTEMPTS) {
      this.callbacks.onError?.(new Error('Could not connect to the other participant. Please try again.'));
    }
  }

  private _scheduleIceRestart(immediate = false): void {
    if (this.destroyed) return;
    if (this.iceRestartTimer) return; // an attempt is already queued — don't thrash
    if (this.iceRestartAttempts >= this.MAX_ICE_RESTART_ATTEMPTS) {
      this.callbacks.onError?.(new Error('Connection failed after multiple reconnect attempts'));
      return;
    }
    const delay = immediate ? 1000 : 3000 + (this.iceRestartAttempts * 2000);
    this.iceRestartTimer = setTimeout(async () => {
      this.iceRestartTimer = null;
      if (this.destroyed || !this.pc) return;
      try {
        this.iceRestartAttempts++;
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this._setLocalWithBitrate(offer);
        await this.waitForIceGathering();
        const localDesc = this.pc.localDescription;
        if (!localDesc) return;

        // CRITICAL FIX (ICE restart was completely broken): the previous
        // implementation pushed the new offer to the server but DISCARDED
        // the answer. CF Calls returns a renegotiated answer SDP that MUST
        // be applied via setRemoteDescription for ICE restart to actually
        // complete. Without it, the connection stayed in 'failed'/
        // 'disconnected' forever — every cellular network blip permanently
        // killed the call instead of recovering.
        //
        // Send the current local tracks list (not an empty array) so CF can
        // map the renegotiated transceivers correctly.
        const transceivers = this.pc.getTransceivers ? this.pc.getTransceivers() : [];
        const tracks = transceivers.length > 0
          ? transceivers
              .filter((t: any) => t.sender?.track)
              .map((t: any) => ({
                mid: t.mid || String(transceivers.indexOf(t)),
                // MID-independent name (see pushLocalTracks) so the re-offer
                // maps to the tracks the SFU already knows.
                trackName: t.sender.track.kind,
              }))
          : [];

        const result = await API.pushTracks(this.sessionId, localDesc.sdp, localDesc.type, tracks);
        if (this.destroyed || !this.pc) return;
        if (result?.answer && RTC.RTCSessionDescription) {
          const answerDesc = new RTC.RTCSessionDescription(result.answer);
          await this.pc.setRemoteDescription(answerDesc);
        }
        // A failed/disconnected connection usually drops INBOUND (pulled) media
        // too, not just our outbound push. Re-run the pull so the remote tracks
        // are re-attached on the freshly restarted transport.
        this.triggerPull();
      } catch (err) {
        console.warn('[WebRTC] ICE restart failed:', err);
      }
      // If we still aren't connected, queue the next bounded attempt. This
      // self-cancels when a 'connected' state fires (_resetIceRestart), so the
      // chain only continues while the connection is genuinely down — and stops
      // after MAX_ICE_RESTART_ATTEMPTS with an onError.
      if (!this.destroyed && this.pc &&
          this.pc.connectionState !== 'connected' &&
          this.pc.iceConnectionState !== 'connected' &&
          this.pc.iceConnectionState !== 'completed') {
        this._scheduleIceRestart(false);
      }
    }, delay);
  }

  private _clearIceRestartTimer(): void {
    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
    }
  }

  // Full reset — clears any pending restart AND zeroes the attempt counter.
  // Called only when we reach a genuinely connected state, so the bounded retry
  // budget (MAX_ICE_RESTART_ATTEMPTS) survives across a single outage instead of
  // being reset on every state re-fire — which previously made the "give up
  // after N attempts" guard ineffective (it could retry indefinitely).
  private _resetIceRestart(): void {
    this._clearIceRestartTimer();
    this.iceRestartAttempts = 0;
  }

  // Drive reconnection + quality from a connectivity state value. Fed by BOTH
  // connectionstatechange and iceconnectionstatechange because some
  // react-native-webrtc (Android) builds never advance connectionState past
  // 'connecting' even though ICE — and media — are fully established.
  private _handleConnectivity(state: string): void {
    if (state === 'connected' || state === 'completed') {
      this._resetIceRestart();
      this._startQualityMonitor();
    } else if (state === 'failed') {
      this._emitQuality('lost');
      this._scheduleIceRestart(true);
    } else if (state === 'disconnected') {
      // Often transient on mobile — schedule with a normal (non-immediate)
      // delay so a self-healing blip cancels it before it fires.
      this._scheduleIceRestart(false);
    }
  }

  // FIX (video clarity): apply the outbound video sender's bitrate/framerate
  // headroom. CF Calls / SFU relays exactly what we send; the old ~1.2 Mbps
  // cap produced a soft, blocky image even from a 720p source. 2.5 Mbps is a
  // safe ceiling for 720p30 (congestion control scales it down on weak
  // networks). scaleResolutionDownBy=1 stops silent downscaling and high
  // networkPriority gives video DSCP precedence. Re-runnable so it can be
  // re-applied after toggleCamera swaps in a new track.
  private async _applyVideoSenderParams(): Promise<void> {
    if (!this.isVideo) return;
    try {
      const videoSender = this.videoSender
        ?? this.pc?.getSenders?.().find((s: any) => s.track?.kind === 'video');
      if (videoSender && videoSender.getParameters && videoSender.setParameters) {
        const params = videoSender.getParameters();
        params.encodings = (params.encodings && params.encodings.length > 0)
          ? params.encodings
          : [{}];
        for (const enc of params.encodings) {
          enc.maxBitrate = VIDEO_MAX_BPS;
          enc.maxFramerate = 30;
          enc.scaleResolutionDownBy = 1;
          (enc as any).networkPriority = 'high';
        }
        await videoSender.setParameters(params);
      }
    } catch (e) {
      // Non-fatal: if setParameters isn't supported on this platform we fall
      // back to the default bitrate (the SDP b=AS line still helps).
      console.warn('[WebRTC] setParameters (video bitrate) failed:', e);
    }
  }

  // ── In-call media-state relay ──────────────────────────────────────────────
  // Best-effort: tell the other party our current mic/camera state so their UI
  // updates instantly (camera-off avatar / muted badge). Fire-and-forget;
  // never throws into the caller and never blocks the local toggle.
  private _sendMediaState(): void {
    if (this.destroyed) return;
    API.sendMediaState(this.sessionId, {
      audio: !this.localMuted,     // true = mic on
      video: !this.localCameraOff, // true = camera on
    }).catch(() => { /* best-effort */ });
  }

  // ── Call-quality monitor (getStats) ─────────────────────────────────────────
  // Polls inbound RTP stats every 3s once connected and derives a coarse
  // quality level from packet loss (per-interval delta), round-trip time and
  // jitter. Emitted via onQualityChange so the UI can render real signal bars.
  private _startQualityMonitor(): void {
    if (this.statsTimer || this.destroyed || !this.pc?.getStats) return;
    this.lastStatSample = null;
    this.statsTimer = setInterval(() => { void this._sampleStats(); }, 3000);
  }

  private _stopQualityMonitor(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.lastStatSample = null;
  }

  private async _sampleStats(): Promise<void> {
    if (this.destroyed || !this.pc?.getStats) return;
    try {
      const report = await this.pc.getStats();
      let lost = 0, recv = 0, jitter = 0, rtt = 0;
      report.forEach((s: any) => {
        if (s.type === 'inbound-rtp' && !s.isRemote) {
          lost += s.packetsLost ?? 0;
          recv += s.packetsReceived ?? 0;
          if (typeof s.jitter === 'number') jitter = Math.max(jitter, s.jitter);
        }
        if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded')) {
          if (typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime;
        }
      });

      // Loss over the last interval only (delta) so a long, healthy call isn't
      // dragged down by losses during the initial connection ramp-up.
      let lossPct = 0;
      if (this.lastStatSample) {
        const dLost = Math.max(0, lost - this.lastStatSample.lost);
        const dRecv = Math.max(0, recv - this.lastStatSample.recv);
        const total = dLost + dRecv;
        lossPct = total > 0 ? (dLost / total) * 100 : 0;
      }
      this.lastStatSample = { lost, recv };

      const rttMs = rtt * 1000;
      const jitterMs = jitter * 1000;

      let quality: ConnectionQuality;
      if (lossPct >= 8 || rttMs >= 500 || jitterMs >= 60) quality = 'poor';
      else if (lossPct >= 3 || rttMs >= 250 || jitterMs >= 30) quality = 'good';
      else quality = 'excellent';

      this._emitQuality(quality, { rtt: rttMs, packetLoss: lossPct, jitter: jitterMs });
    } catch {
      // getStats can throw transiently during renegotiation — ignore this tick.
    }
  }

  private _emitQuality(quality: ConnectionQuality, detail?: { rtt?: number; packetLoss?: number; jitter?: number }): void {
    if (quality === this.currentQuality) return; // de-dupe stable states
    this.currentQuality = quality;
    this.callbacks.onQualityChange?.(quality, detail);
  }

  toggleMute(muted: boolean): void {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach((track: any) => {
      track.enabled = !muted;
    });
    this.localMuted = muted;
    this._sendMediaState();
  }

  // FIX (#1 — speaker routing): actually switch the call audio between the
  // loudspeaker (on=true) and the earpiece (on=false) via InCallManager.
  // Native-only; on web there is no output-switch API so this is a no-op and
  // audio keeps playing through the device's active output.
  setSpeaker(on: boolean): void {
    try {
      InCallManager?.setForceSpeakerphoneOn?.(on);
    } catch (e) {
      console.warn('[WebRTC] setSpeaker failed:', e);
    }
  }

  // FIX (camera re-enable): camera failed to come back ON if the call had no
  // live video track — e.g. acquireLocalStream() fell back to audio-only, or
  // the track ended. We now re-acquire a camera track and attach it to the
  // existing video sender via replaceTrack. Turning OFF keeps the track + sender
  // alive (track.enabled=false) so re-enabling is instant and never needs an
  // SFU renegotiation; disabling sends "muted" to the remote (camera-off avatar).
  async toggleCamera(enabled: boolean): Promise<void> {
    if (!this.localStream || this.destroyed || !this.isVideo) return;

    this.localCameraOff = !enabled;
    this._sendMediaState();

    if (!enabled) {
      this.localStream.getVideoTracks().forEach((t: any) => { try { t.enabled = false; } catch {} });
      return;
    }

    // Re-enable a still-live track instantly.
    const liveTrack = this.localStream.getVideoTracks().find((t: any) => t.readyState === 'live');
    if (liveTrack) {
      liveTrack.enabled = true;
      return;
    }

    // No live video track — acquire a fresh camera track and swap it in.
    try {
      const camStream = await mediaDevicesRef.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (this.destroyed) { camStream.getTracks().forEach((t: any) => t.stop()); return; }
      const newTrack = camStream.getVideoTracks()[0];
      if (!newTrack) return;
      // Drop stale/ended video tracks first.
      this.localStream.getVideoTracks().forEach((t: any) => {
        try { t.stop(); } catch {}
        try { this.localStream.removeTrack(t); } catch {}
      });
      this.localStream.addTrack(newTrack);
      const sender = this.videoSender
        ?? this.pc?.getSenders?.().find((s: any) => s.track?.kind === 'video');
      if (sender) {
        this.videoSender = sender;
        await sender.replaceTrack(newTrack);
        await this._applyVideoSenderParams();
      } else if (this.pc) {
        // No pre-existing video sender (audio-only start). addTrack needs a
        // renegotiation our push flow doesn't perform mid-call, so this only
        // fully works when a video sender already exists.
        this.pc.addTrack(newTrack, this.localStream);
      }
    } catch (e) {
      console.warn('[WebRTC] toggleCamera re-acquire failed:', e);
    }
  }

  async switchCamera(): Promise<void> {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    if (Platform.OS !== 'web') {
      if (videoTrack._switchCamera) {
        videoTrack._switchCamera();
      }
    } else {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((d) => d.kind === 'videoinput');
        if (cameras.length < 2) return;
        const currentId = videoTrack.getSettings().deviceId;
        const nextCamera = cameras.find((c) => c.deviceId !== currentId) ?? cameras[0];
        // FIX (#5): some browsers reject { deviceId: { exact } } (camera busy /
        // constraint unsatisfiable), which left the flip silently broken. Try a
        // fallback ladder: exact deviceId → non-exact deviceId → facingMode.
        const ladder: any[] = [
          { video: { deviceId: { exact: nextCamera.deviceId } }, audio: false },
          { video: { deviceId: nextCamera.deviceId }, audio: false },
          { video: { facingMode: 'environment' }, audio: false },
        ];
        let newStream: any = null;
        for (const c of ladder) {
          try { newStream = await navigator.mediaDevices.getUserMedia(c); break; }
          catch { /* try next, more relaxed constraint */ }
        }
        if (!newStream) { console.warn('switchCamera: no camera could be acquired'); return; }
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (!newVideoTrack) return;
        const sender = this.videoSender ?? this.pc?.getSenders().find((s: any) => s.track?.kind === 'video');
        if (sender) { this.videoSender = sender; await sender.replaceTrack(newVideoTrack); }
        this.localStream.removeTrack(videoTrack);
        this.localStream.addTrack(newVideoTrack);
        videoTrack.stop();
      } catch (err) {
        console.warn('switchCamera web error:', err);
      }
    }
  }

  getLocalStream(): any {
    return this.localStream;
  }

  getRemoteStream(): any {
    return this.remoteStream;
  }

  destroy(): void {
    this.destroyed = true;
    this.pullRunning = false;
    this._clearIceRestartTimer();
    this._stopQualityMonitor();

    // FIX (#1): release the audio session / reset routing when the call ends.
    try { InCallManager?.stop?.(); } catch {}

    if (this.pullTimer) {
      clearTimeout(this.pullTimer);
      this.pullTimer = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track: any) => track.stop());
      this.localStream = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    this.remoteStream = null;
    this.videoSender = null;
  }
}
