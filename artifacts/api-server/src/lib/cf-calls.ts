// Cloudflare Calls (SFU) API wrapper

const CF_CALLS_BASE = 'https://rtc.live.cloudflare.com/v1/apps';

export interface CFCallsSession {
  sessionId: string;
  sessionDescription: RTCSessionDescriptionInit;
}

export class CloudflareCalls {
  private appId: string;
  private appSecret: string;
  private accountId: string;

  constructor(appId: string, appSecret: string, accountId: string) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.accountId = accountId;
  }

  private get baseUrl() {
    return `${CF_CALLS_BASE}/${this.appId}`;
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.appSecret}`,
      'Content-Type': 'application/json',
    };
  }

  async createSession(): Promise<{ sessionId: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/new`, {
      method: 'POST',
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`CF Calls error: ${res.status}`);
    const data = await res.json() as any;
    return { sessionId: data.sessionId };
  }

  async createTrack(sessionId: string, offer: RTCSessionDescriptionInit, trackName: string): Promise<{
    sessionDescription: RTCSessionDescriptionInit;
    tracks: any[];
  }> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/tracks/new`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        sessionDescription: offer,
        tracks: [{ location: 'local', mid: '0', trackName }],
      }),
    });
    if (!res.ok) throw new Error(`CF Calls track error: ${res.status}`);
    return res.json() as any;
  }

  async closeSession(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: this.headers,
    });
  }

  async sendIce(sessionId: string, candidate: RTCIceCandidateInit): Promise<void> {
    await fetch(`${this.baseUrl}/sessions/${sessionId}/ice`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ candidate }),
    });
  }
}

export function createCFCalls(env: { CF_CALLS_APP_ID: string; CF_CALLS_APP_SECRET: string; CF_ACCOUNT_ID: string }) {
  if (!env.CF_CALLS_APP_ID || !env.CF_CALLS_APP_SECRET) {
    return null;
  }
  return new CloudflareCalls(env.CF_CALLS_APP_ID, env.CF_CALLS_APP_SECRET, env.CF_ACCOUNT_ID);
}
