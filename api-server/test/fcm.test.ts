import { describe, it, expect, beforeEach } from 'vitest';
import { isPermanentTokenError, pruneFcmTokens } from '../src/lib/fcm';
import { createTestDb, type FakeD1 } from './helpers/d1';

// ─── isPermanentTokenError — decide when an FCM token is DEAD ────────────────
// Must be conservative: only wipe a token on an unambiguous "this token is
// gone" signal, never on a generic payload error (which would nuke every
// user's token on a single bad send).
describe('isPermanentTokenError', () => {
  it('treats a 404 as a dead token (UNREGISTERED)', () => {
    expect(isPermanentTokenError(404, '{"error":{"status":"NOT_FOUND"}}')).toBe(true);
  });

  it('detects the explicit UNREGISTERED / registration-token error codes', () => {
    expect(isPermanentTokenError(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(true);
    expect(isPermanentTokenError(400, 'messaging/registration-token-not-registered')).toBe(true);
    expect(isPermanentTokenError(400, 'messaging/invalid-registration-token')).toBe(true);
    expect(isPermanentTokenError(400, 'not a valid FCM registration token')).toBe(true);
  });

  it('does NOT treat a generic 400/INVALID_ARGUMENT as a dead token (payload bug safety)', () => {
    expect(isPermanentTokenError(400, '{"error":{"status":"INVALID_ARGUMENT","message":"Invalid value at message.android"}}')).toBe(false);
  });

  it('does NOT treat transient 5xx / 429 as dead tokens', () => {
    expect(isPermanentTokenError(503, 'The service is currently unavailable.')).toBe(false);
    expect(isPermanentTokenError(429, 'Quota exceeded')).toBe(false);
    expect(isPermanentTokenError(500, 'internal')).toBe(false);
  });

  it('handles empty/undefined body without false positives', () => {
    expect(isPermanentTokenError(400, '')).toBe(false);
    expect(isPermanentTokenError(401, undefined as any)).toBe(false);
  });
});

// ─── pruneFcmTokens — evict dead tokens from D1 ──────────────────────────────
describe('pruneFcmTokens', () => {
  let db: FakeD1;
  beforeEach(() => {
    db = createTestDb();
    db.applySchema(`
      CREATE TABLE users (id TEXT PRIMARY KEY, fcm_token TEXT);
      INSERT INTO users (id, fcm_token) VALUES
        ('u1', 'tok-alive'),
        ('u2', 'tok-dead-1'),
        ('u3', 'tok-dead-2'),
        ('u4', 'tok-dead-1');  -- same dead token on a second device/account
    `);
  });

  async function tokenOf(id: string): Promise<string | null> {
    const r = await db.prepare('SELECT fcm_token FROM users WHERE id = ?').bind(id).first<{ fcm_token: string | null }>();
    return r?.fcm_token ?? null;
  }

  it('nulls out every row holding a dead token and leaves live tokens intact', async () => {
    const changed = await pruneFcmTokens(db as any, ['tok-dead-1', 'tok-dead-2']);
    expect(changed).toBe(3); // u2, u3, u4
    expect(await tokenOf('u1')).toBe('tok-alive');
    expect(await tokenOf('u2')).toBeNull();
    expect(await tokenOf('u3')).toBeNull();
    expect(await tokenOf('u4')).toBeNull();
  });

  it('dedupes the input and is a no-op for an empty / all-empty list', async () => {
    expect(await pruneFcmTokens(db as any, [])).toBe(0);
    expect(await pruneFcmTokens(db as any, ['', ''])).toBe(0);
    expect(await tokenOf('u1')).toBe('tok-alive');
  });

  it('leaves everything untouched when no token matches', async () => {
    expect(await pruneFcmTokens(db as any, ['tok-not-here'])).toBe(0);
    expect(await tokenOf('u2')).toBe('tok-dead-1');
  });
});
