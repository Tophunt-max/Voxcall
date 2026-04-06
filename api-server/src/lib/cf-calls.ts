const CF_CALLS_BASE = 'https://rtc.live.cloudflare.com/v1/apps';

export interface CFCallsTrack {
  mid?: string;
  trackName?: string;
  errorCode?: string;
  errorDescription?: string;
  location?: 'local' | 'remote';
  sessionId?: string;
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
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`CF Calls createSession error ${res.status}: ${text}`);
    }
    const data = await res.json() as any;
    return { sessionId: data.sessionId };
  }

  async pushTracks(
    sessionId: string,
    offer: { type: string; sdp: string },
    tracks: Array<{ location: 'local'; mid: string; trackName: string }>
  ): Promise<{ answer: { type: string; sdp: string }; tracks: CFCallsTrack[] }> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/tracks/new`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        sessionDescription: { type: offer.type, sdp: offer.sdp },
        tracks,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`CF Calls pushTracks error ${res.status}: ${text}`);
    }
    const data = await res.json() as any;
    return {
      answer: data.sessionDescription || data.answer,
      tracks: data.tracks || [],
    };
  }

  async pullTracks(
    sessionId: string,
    remoteSessionId: string,
    trackNames: string[]
  ): Promise<{ offer: { type: string; sdp: string } | null; tracks: CFCallsTrack[] }> {
    const tracks = trackNames.map((trackName, i) => ({
      location: 'remote' as const,
      sessionId: remoteSessionId,
      trackName,
    }));

    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/tracks/new`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ tracks }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`CF Calls pullTracks error ${res.status}: ${text}`);
    }
    const data = await res.json() as any;
    return {
      offer: data.sessionDescription,
      tracks: data.tracks || [],
    };
  }

  async sendAnswerForPull(
    sessionId: string,
    answer: { type: string; sdp: string }
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/renegotiate`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        sessionDescription: { type: answer.type, sdp: answer.sdp },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`CF Calls renegotiate error ${res.status}: ${text}`);
    }
  }

  async closeTracks(
    sessionId: string,
    trackMids: string[]
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/tracks/close`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        tracks: trackMids.map(mid => ({ mid })),
        force: true,
      }),
    });
    if (!res.ok) {
      console.error('CF Calls closeTracks error:', res.status);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({ force_close: true }),
      });
    } catch {}
  }
}

export function createCFCalls(env: { CF_CALLS_APP_ID: string; CF_CALLS_APP_SECRET: string; CF_ACCOUNT_ID: string }) {
  if (!env.CF_CALLS_APP_ID || !env.CF_CALLS_APP_SECRET) {
    return null;
  }
  return new CloudflareCalls(env.CF_CALLS_APP_ID, env.CF_CALLS_APP_SECRET, env.CF_ACCOUNT_ID);
}
