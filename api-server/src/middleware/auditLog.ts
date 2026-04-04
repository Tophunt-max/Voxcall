// FIX #14: Audit Log Middleware for Admin Actions
// Logs every mutating admin request (POST/PUT/PATCH/DELETE) to the audit_logs table.
// Provides a complete trail of who changed what and when — critical for compliance.
// Read-only GET requests are intentionally excluded to keep the table manageable.

import { createMiddleware } from 'hono/factory';
import type { Env, JWTPayload } from '../types';

type Variables = { user: JWTPayload };

export const auditLogMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const method = c.req.method;

    // Only log write operations — reads don't need an audit trail
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const user = c.get('user');
    const path = new URL(c.req.url).pathname;

    // Capture response to include status in audit log
    await next();

    const status = c.res.status;

    try {
      // Read body for context — cloned because Hono/Workers can only read body once
      // We rely on the already-consumed body; log the path + method as the action descriptor
      const action = `${method} ${path}`;
      const id = crypto.randomUUID();

      await c.env.DB.prepare(
        `INSERT INTO audit_logs (id, admin_id, action, target_type, target, detail, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        user?.sub ?? 'unknown',
        action,
        extractEntityType(path),
        extractEntityId(path),
        `HTTP ${status}`,
        c.req.header('CF-Connecting-IP') ?? 'unknown',
        Math.floor(Date.now() / 1000)
      ).run();
    } catch (err) {
      // Audit log failures must never break the primary request
      console.error('[AuditLog] Failed to write audit entry:', err);
    }
  }
);

// Extract entity type from URL path, e.g. /api/admin/users/123 → "users"
function extractEntityType(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const adminIdx = parts.indexOf('admin');
  if (adminIdx !== -1 && parts[adminIdx + 1]) return parts[adminIdx + 1];
  return 'unknown';
}

// Extract entity ID from URL path (last segment if it looks like a UUID or number)
function extractEntityId(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && /^[0-9a-f-]{8,}$/i.test(last)) return last;
  return 'n/a';
}
