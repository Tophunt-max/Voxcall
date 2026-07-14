// ============================================================================
// Audit trail — an append-only record of every console mutation.
// ============================================================================
// One small R2 object per action under ota/audit/<app>/<ts>-<rand>.json. The
// timestamp prefix means a plain list returns them in chronological order, so
// reading the most recent N is a bounded reverse scan. Writes are best-effort;
// auditing must never block or fail the action it records.
// ============================================================================

import { type Env, AUDIT_PREFIX, json } from '../shared';

export interface AuditEntry {
  ts: string;
  app: string;
  action: string; // 'promote' | 'rollback' | 'rollout' | 'force' | 'build.add' | 'build.delete' | 'auto-rollback'
  detail: Record<string, unknown>;
  actor: string; // 'console' | 'ci' | 'auto' | 'system'
}

export async function appendAudit(env: Env, entry: Omit<AuditEntry, 'ts'>): Promise<void> {
  try {
    const ts = new Date().toISOString();
    const rand = crypto.randomUUID().slice(0, 8);
    const key = `${AUDIT_PREFIX}/${entry.app}/${ts}-${rand}.json`;
    await env.STORAGE.put(key, JSON.stringify({ ts, ...entry }), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    // ignore — audit is best-effort
  }
}

export async function listAudit(env: Env, app: string, limit = 100): Promise<AuditEntry[]> {
  const prefix = `${AUDIT_PREFIX}/${app}/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await env.STORAGE.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects) if (o.key.endsWith('.json')) keys.push(o.key);
    if (!res.truncated) break;
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
  }
  // Keys sort ascending by ISO timestamp; take the newest `limit`.
  const newest = keys.sort().slice(-limit).reverse();
  const entries = await Promise.all(
    newest.map(async (k) => {
      const obj = await env.STORAGE.get(k);
      if (!obj) return null;
      try {
        return (await obj.json()) as AuditEntry;
      } catch {
        return null;
      }
    }),
  );
  return entries.filter((e): e is AuditEntry => e !== null);
}

/** Convenience JSON response used by the API layer. */
export async function auditResponse(env: Env, app: string, limit: number): Promise<Response> {
  return json({ app, entries: await listAudit(env, app, limit) });
}
