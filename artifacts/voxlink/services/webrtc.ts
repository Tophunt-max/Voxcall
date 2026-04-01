import {
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { API } from './api';

const ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

export interface WebRTCCallbacks {
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: string) => void;
  onError?: (error: Error) => void;
}

export class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private sessionId: string;
  private callbacks: WebRTCCallbacks;
  private isVideo: boolean;
  private destroyed = false;
  private serverRole: string | null = null;

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
      if ((this.pc as any).iceGatheringState === 'complete') { resolve(); return; }

      const timeout = setTimeout(() => resolve(), 3000);

      this.pc.addEventListener('icegatheringstatechange' as any, () => {
        if ((this.pc as any).iceGatheringState === 'complete') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }

  async start(): Promise<MediaStream | null> {
    if (this.destroyed) return null;

    try {
      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.remoteStream = new MediaStream(undefined as any);

      this.pc.addEventListener('track' as any, (event: any) => {
        if (event.streams && event.streams[0]) {
          this.remoteStream = event.streams[0];
        } else if (event.track) {
          this.remoteStream?.addTrack(event.track);
        }
        if (this.remoteStream && this.callbacks.onRemoteStream) {
          this.callbacks.onRemoteStream(this.remoteStream);
        }
      });

      this.pc.addEventListener('connectionstatechange' as any, () => {
        const state = (this.pc as any)?.connectionState || 'unknown';
        this.callbacks.onConnectionStateChange?.(state);
      });

      const constraints: any = {
        audio: true,
        video: this.isVideo ? { facingMode: 'user', width: 640, height: 480 } : false,
      };

      this.localStream = await mediaDevices.getUserMedia(constraints) as MediaStream;

      this.localStream.getTracks().forEach((track: any) => {
        this.pc?.addTrack(track, this.localStream!);
      });

      await this.pushLocalTracks();

      setTimeout(() => this.pullRemoteTracks(), 2000);

      return this.localStream;
    } catch (error: any) {
      console.error('WebRTC start error:', error);
      this.callbacks.onError?.(error);
      return null;
    }
  }

  private async pushLocalTracks(): Promise<void> {
    if (!this.pc || this.destroyed) return;

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.isVideo,
    } as any);

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
        localDesc.sdp!,
        localDesc.type,
        tracks
      );

      if (result.role) {
        this.serverRole = result.role;
      }

      if (result.answer) {
        const answerDesc = new RTCSessionDescription(result.answer as any);
        await this.pc!.setRemoteDescription(answerDesc);
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

    const maxRetries = 10;
    let attempt = 0;

    while (attempt < maxRetries && !this.destroyed) {
      try {
        const result = await API.pullTracks(this.sessionId, trackNames);

        if (result.offer) {
          const offerDesc = new RTCSessionDescription(result.offer as any);
          await this.pc!.setRemoteDescription(offerDesc);

          const answer = await this.pc!.createAnswer();
          await this.pc!.setLocalDescription(answer);

          await this.waitForIceGathering();

          const finalDesc = this.pc!.localDescription;
          if (finalDesc) {
            await API.sendPullAnswer(
              this.sessionId,
              finalDesc.sdp!,
              finalDesc.type
            );
          }
        }
        return;
      } catch (error: any) {
        attempt++;
        if (attempt < maxRetries && !this.destroyed) {
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.error('Pull tracks failed after retries:', error);
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
    const videoTrack = this.localStream.getVideoTracks()[0] as any;
    if (videoTrack && videoTrack._switchCamera) {
      videoTrack._switchCamera();
    }
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  destroy(): void {
    this.destroyed = true;

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
