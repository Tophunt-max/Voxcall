// ============================================================================
// CallListener — admin "listen in" on a live call via the Agora web SDK.
// ============================================================================
// Joins the call's Agora channel (channel = call session id) as a silent
// observer: it SUBSCRIBES to remote audio and plays it through the admin's
// speakers, but NEVER creates or publishes a mic/camera track — so the two
// participants are not disturbed and don't know the admin is listening.
//
// The SDK is dynamically imported so the ~500 KB bundle is only fetched the
// first time an admin actually clicks "Listen".
// ============================================================================

import type { IAgoraRTCClient, IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng';

export interface ListenConfig {
  app_id: string;
  channel: string;
  token: string;
  uid: number;
}

export class CallListener {
  private client: IAgoraRTCClient | null = null;
  private joined = false;

  get isListening() {
    return this.joined;
  }

  async join(cfg: ListenConfig): Promise<void> {
    const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
    // 'rtc' mode interoperates with the participants' Communication-profile
    // channel. We simply never publish, which makes us an audio observer.
    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    this.client = client;

    const subscribeAudio = async (user: IAgoraRTCRemoteUser) => {
      try {
        await client.subscribe(user, 'audio');
        user.audioTrack?.play();
      } catch (e) {
        console.warn('[CallListener] audio subscribe failed:', e);
      }
    };

    client.on('user-published', (user, mediaType) => {
      if (mediaType === 'audio') void subscribeAudio(user);
    });

    const joinUid = cfg.uid === 0 ? null : cfg.uid;
    await client.join(cfg.app_id, cfg.channel, cfg.token, joinUid);

    // Catch anyone who was already publishing before we joined.
    for (const user of client.remoteUsers) {
      if (user.hasAudio) void subscribeAudio(user);
    }

    this.joined = true;
  }

  async leave(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.joined = false;
    if (!client) return;
    try {
      client.remoteUsers.forEach((u) => {
        try { u.audioTrack?.stop(); } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
    try { await client.leave(); } catch { /* ignore */ }
    try { client.removeAllListeners(); } catch { /* ignore */ }
  }
}
