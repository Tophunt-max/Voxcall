import { Platform } from 'react-native';
import { API } from './api';

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
  private triggerPullPending = false;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;

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

      // Mark push as complete; start pull via event signal or fallback timer
      this.pushCompleted = true;
      if (this.triggerPullPending) {
        this.triggerPullPending = false;
        this._startPull();
      } else {
        // Fallback: pull after 5 seconds if no peer_tracks_ready event arrives
        this.pullTimer = setTimeout(() => {
          if (!this.pullStarted) {
            this.pullStarted = true;
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

  public triggerPull(): void {
    if (this.pullStarted) return;
    if (!this.pushCompleted) {
      // Push not done yet — schedule pull to run immediately after push finishes
      this.triggerPullPending = true;
      return;
    }
    this._startPull();
  }

  private _startPull(): void {
    if (this.pullStarted) return;
    this.pullStarted = true;
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

    const maxRetries = 15;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries && !this.destroyed) {
      try {
        const result = await API.pullTracks(this.sessionId, trackNames);

        if (!result.offer) {
          // Remote tracks not published yet — treat as retriable error
          throw new Error('Remote tracks not ready yet');
        }

        // CF Calls returns a valid offer even when tracks have errors (a=inactive).
        // Detect this and retry rather than processing a bad SDP.
        const hasTrackErrors = result.tracks?.some((t: any) => t.errorCode);
        if (hasTrackErrors) {
          throw new Error('Remote tracks not ready yet (track unavailable)');
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
        return;
      } catch (error: any) {
        lastError = error;
        attempt++;
        if (attempt < maxRetries && !this.destroyed) {
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.error('Pull tracks failed after all retries:', error);
          if (lastError) {
            this.callbacks.onError?.(lastError);
          }
        }
      }
    }
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
    if (videoTrack && videoTrack._switchCamera) {
      videoTrack._switchCamera();
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
