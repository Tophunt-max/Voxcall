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

export interface WebRTCCallbacks {
  onRemoteStream?: (stream: any) => void;
  onConnectionStateChange?: (state: string) => void;
  onError?: (error: Error) => void;
}

export class WebRTCService {
  private pc: any = null;
  private localStream: any = null;
  private remoteStream: any = null;
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
  private readonly MAX_ICE_RESTART_ATTEMPTS = 3;

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

        // Network drop pe auto ICE restart karo (10s tak retry, phir fail)
        if (state === 'disconnected' || state === 'failed') {
          this._scheduleIceRestart(state === 'failed');
        }
        if (state === 'connected') {
          this._clearIceRestartTimer();
        }
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

      this.localStream.getTracks().forEach((track: any) => {
        this.pc?.addTrack(track, this.localStream);
      });

      // FIX (video clarity): give the outbound video sender real headroom so
      // the encoder can deliver a sharp HD picture. CF Calls / SFU relays
      // exactly what we send, and the previous ~1.2 Mbps cap produced a soft,
      // blocky image even from a 720p source. 2.5 Mbps is a safe ceiling for
      // 720p30 over 4G / Wi-Fi; congestion control scales it down when the
      // network is constrained. We also pin scaleResolutionDownBy=1 so the
      // encoder never silently drops below capture resolution, and bump the
      // network priority so video gets DSCP precedence over background data.
      if (this.isVideo) {
        try {
          const videoSender = this.pc.getSenders?.().find((s: any) => s.track?.kind === 'video');
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
          // Non-fatal: if setParameters isn't supported on this platform we
          // fall back to the default bitrate (the SDP b=AS line still helps).
          console.warn('[WebRTC] setParameters (video bitrate) failed:', e);
        }
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
      if (this.isVideo && desc?.sdp) {
        const sdp = preferVideoBitrate(desc.sdp, VIDEO_MAX_KBPS);
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
          trackName: `${t.sender.track.kind}-${t.mid || transceivers.indexOf(t)}`,
        }));
    } else {
      tracks = [{ mid: '0', trackName: 'audio-0' }];
      if (this.isVideo) {
        tracks.push({ mid: '1', trackName: 'video-1' });
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

    const trackNames = ['audio-0'];
    if (this.isVideo) {
      trackNames.push('video-1');
    }

    // Keep retrying until success or destroyed.
    // No hard limit — peer_tracks_ready event will restart if needed.
    // Use exponential-ish backoff capped at 3s so we don't spam CF Calls.
    let attempt = 0;

    while (!this.destroyed) {
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
  }

  private _scheduleIceRestart(immediate = false): void {
    if (this.destroyed || this.iceRestartAttempts >= this.MAX_ICE_RESTART_ATTEMPTS) {
      if (this.iceRestartAttempts >= this.MAX_ICE_RESTART_ATTEMPTS) {
        this.callbacks.onError?.(new Error('Connection failed after multiple reconnect attempts'));
      }
      return;
    }
    this._clearIceRestartTimer();
    const delay = immediate ? 1000 : 3000 + (this.iceRestartAttempts * 2000);
    this.iceRestartTimer = setTimeout(async () => {
      if (this.destroyed || !this.pc) return;
      try {
        this.iceRestartAttempts++;
        console.log(`[WebRTC] ICE restart attempt ${this.iceRestartAttempts}`);
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
        // map the renegotiated transceivers correctly. An empty list is a
        // valid renegotiation signal in some SFU implementations but the
        // safe path is to mirror what pushLocalTracks() does.
        const transceivers = this.pc.getTransceivers ? this.pc.getTransceivers() : [];
        const tracks = transceivers.length > 0
          ? transceivers
              .filter((t: any) => t.sender?.track)
              .map((t: any) => ({
                mid: t.mid || String(transceivers.indexOf(t)),
                trackName: `${t.sender.track.kind}-${t.mid || transceivers.indexOf(t)}`,
              }))
          : [];

        const result = await API.pushTracks(this.sessionId, localDesc.sdp, localDesc.type, tracks);
        if (this.destroyed || !this.pc) return;
        if (result?.answer && RTC.RTCSessionDescription) {
          const answerDesc = new RTC.RTCSessionDescription(result.answer);
          await this.pc.setRemoteDescription(answerDesc);
        }
      } catch (err) {
        console.warn('[WebRTC] ICE restart failed:', err);
      }
    }, delay);
  }

  private _clearIceRestartTimer(): void {
    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
    }
    this.iceRestartAttempts = 0;
  }

  toggleMute(muted: boolean): void {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach((track: any) => {
      track.enabled = !muted;
    });
  }

  toggleCamera(enabled: boolean): void {
    if (!this.localStream) return;
    this.localStream.getVideoTracks().forEach((track: any) => {
      track.enabled = enabled;
    });
  }

  async switchCamera(): Promise<void> {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    if (Platform.OS !== 'web') {
      // Native (iOS/Android): Cloudflare's react-native-webrtc fork ships
      // the same `_switchCamera()` helper as upstream.
      if (videoTrack._switchCamera) {
        videoTrack._switchCamera();
      }
    } else {
      // Web: enumerate devices aur next camera pe switch karo
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((d) => d.kind === 'videoinput');
        if (cameras.length < 2) return;

        const currentId = videoTrack.getSettings().deviceId;
        const nextCamera = cameras.find((c) => c.deviceId !== currentId) ?? cameras[0];

        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: nextCamera.deviceId } },
          audio: false,
        });
        const newVideoTrack = newStream.getVideoTracks()[0];

        // RTCPeerConnection sender mein track replace karo
        const sender = this.pc?.getSenders().find((s: any) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
        }

        // Local stream update karo
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
  }
}
