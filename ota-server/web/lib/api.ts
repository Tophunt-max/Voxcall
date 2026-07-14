// ============================================================================
// OTA console API client — talks to the self-hosted OTA worker's /console/api/*
// endpoints. Auth is a single bearer token (the worker's CONSOLE_PASSWORD),
// kept in sessionStorage and sent on every request.
// ============================================================================

// Same-origin: the console is served by the OTA worker itself, so the API is a
// relative path — no CORS, no cross-origin config.
const API_BASE = '/console/api';
const TOKEN_KEY = 'voxota_token';

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let onUnauthorized: () => void = () => {};

export function getToken(): string {
  return token;
}
export function setToken(t: string): void {
  token = t;
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Network error — is the worker reachable?', 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (res.status === 401 || res.status === 503) {
    onUnauthorized();
    throw new ApiError(json.error || (res.status === 503 ? 'Console disabled' : 'Unauthorized'), res.status);
  }
  if (!res.ok) throw new ApiError(json.error || 'HTTP ' + res.status, res.status);
  return json as T;
}

// ─── Types ──────────────────────────────────────────────────────────────────
export type AppId = 'user' | 'host';

export interface Pointer {
  channel: string;
  runtimeVersion: string;
  updateId: string;
  createdAt: string | null;
  rollout: number;
  rollBackToEmbedded?: boolean;
}

export interface AuditEntry {
  ts: string;
  app: string;
  action: string;
  actor: string;
  detail: Record<string, unknown>;
}
export interface AuditResp {
  app: string;
  entries: AuditEntry[];
}
export interface UpdateHealth {
  ok: number;
  err: number;
  lastError: string | null;
  updatedAt: string;
}
export interface HealthResp {
  app: string;
  health: Record<string, UpdateHealth>;
}
export interface UpdateSummary {
  id: string;
  createdAt: string | null;
  runtimeVersion: string | null;
  runtimeVersions: string[];
  forceUpdate: boolean;
  message: string | null;
  gitCommit: string | null;
  platforms: string[];
  liveOn: string[];
}
export interface StateResp {
  app: string;
  channels: Pointer[];
  updates: UpdateSummary[];
}
export interface MetricsResp {
  total?: number;
  active24h?: number;
  active7d?: number;
  byUpdate?: Record<string, number>;
  byPlatform?: Record<string, number>;
  truncated?: boolean;
}
export interface Build {
  id: string;
  app: string;
  channel: string;
  platform: string;
  version: string;
  buildNumber: string;
  notes: string;
  createdAt: string;
  storageKey?: string;
  externalUrl?: string;
  filename?: string;
  size?: number;
  downloadUrl?: string;
  bundleId?: string;
}
export interface BuildsResp {
  app: string;
  builds: Build[];
}
export interface AssetDetail {
  key: string;
  hash: string;
  contentType: string;
  fileExtension: string | null;
  url: string;
}
export interface PlatformDetail {
  runtimeVersion: string;
  launchAsset: { key: string; hash: string; contentType: string; url: string };
  assetCount: number;
  assets: AssetDetail[];
}
export interface UpdateDetail {
  id: string;
  createdAt: string | null;
  runtimeVersion: string | null;
  runtimeVersions: string[];
  forceUpdate: boolean;
  message: string | null;
  gitCommit: string | null;
  publishedAt: string | null;
  easProjectId: string | null;
  manifestUrl: string;
  platforms: Record<string, PlatformDetail>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────
export const api = {
  state: (app: AppId) => req<StateResp>('GET', `/state?app=${app}`),
  metrics: (app: AppId) => req<MetricsResp>('GET', `/metrics?app=${app}`),
  health: (app: AppId) => req<HealthResp>('GET', `/health?app=${app}`),
  audit: (app: AppId) => req<AuditResp>('GET', `/audit?app=${app}`),
  builds: (app: AppId) => req<BuildsResp>('GET', `/builds?app=${app}`),
  update: (app: AppId, id: string) => req<UpdateDetail>('GET', `/update?app=${app}&id=${encodeURIComponent(id)}`),
  promote: (d: { app: AppId; channel: string; updateId: string; rollout: number }) =>
    req<{ ok: boolean; runtimeVersions: string[]; rollout: number }>('POST', '/promote', d),
  setRollout: (d: { app: AppId; channel: string; rollout: number }) =>
    req<{ ok: boolean; rollout: number }>('POST', '/rollout', d),
  setForce: (d: { app: AppId; updateId: string; force: boolean }) =>
    req<{ ok: boolean; forceUpdate: boolean }>('POST', '/force', d),
  rollbackEmbedded: (d: { app: AppId; channel: string }) =>
    req<{ ok: boolean; runtimeVersions: string[] }>('POST', '/rollback', d),
  registerBuild: (d: {
    app: AppId; channel: string; platform: string; version: string; buildNumber: string; notes: string; externalUrl: string;
  }) => req<{ ok: boolean; build: Build }>('POST', '/builds', d),
  deleteBuild: (app: AppId, id: string) => req<{ ok: boolean }>('DELETE', `/builds?app=${app}&id=${encodeURIComponent(id)}`),
  async uploadBuild(qs: string, file: File): Promise<{ ok: boolean; build: Build }> {
    const res = await fetch(`${API_BASE}/builds/upload?${qs}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; build?: Build };
    if (res.status === 401 || res.status === 503) {
      onUnauthorized();
      throw new ApiError(json.error || 'Unauthorized', res.status);
    }
    if (!res.ok) throw new ApiError(json.error || 'Upload failed', res.status);
    return json as { ok: boolean; build: Build };
  },
};
