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
    const webrtc = require('react-native-webrtc');
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

const ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
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

  async start(): Promise<any> {
    if (this.destroyed || !RTC) return null;

    try {
      this.pc = new RTC.RTCPeerConnection({ iceServers: ICE_SERVERS });

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

      const constraints: any = {
        audio: true,
        video: this.isVideo ? { facingMode: 'user', width: 640, height: 480 } : false,
      };

      this.localStream = await mediaDevicesRef.getUserMedia(constraints);

      this.localStream.getTracks().forEach((track: any) => {
        this.pc?.addTrack(track, this.localStream);
      });

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

  private async pushLocalTracks(): Promise<void> {
    if (!this.pc || this.destroyed) return;

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.isVideo,
    });

    await this.pc.setLocalDescription(offer);
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
          await this.pc.setLocalDescription(answer);

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
        await this.pc.setLocalDescription(offer);
        await this.waitForIceGathering();
        const localDesc = this.pc.localDescription;
        if (localDesc) {
          await API.pushTracks(this.sessionId, localDesc.sdp, localDesc.type, []);
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
      // Native (iOS/Android): react-native-webrtc built-in method
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
