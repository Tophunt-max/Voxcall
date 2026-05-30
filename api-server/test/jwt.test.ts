import { describe, it, expect } from 'vitest';
import { signToken, verifyToken, extractBearer } from '../src/lib/jwt';

const SECRET = 'test-secret-key-do-not-use-in-prod';

describe('signToken / verifyToken round-trip', () => {
  it('preserves the payload claims through sign -> verify', async () => {
    const token = await signToken({ sub: 'user-123', role: 'user' } as any, SECRET);
    const payload = await verifyToken(token, SECRET);
    expect(payload.sub).toBe('user-123');
    expect((payload as any).role).toBe('user');
    // jose stamps iat/exp automatically
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp!).toBeGreaterThan(payload.iat!);
  });
});

describe('verifyToken rejects invalid tokens', () => {
  it('throws when the secret does not match (forged/wrong signer)', async () => {
    const token = await signToken({ sub: 'u1', role: 'user' } as any, SECRET);
    await expect(verifyToken(token, 'a-different-secret')).rejects.toBeTruthy();
  });

  it('throws when the token has been tampered with', async () => {
    const token = await signToken({ sub: 'u1', role: 'user' } as any, SECRET);
    // Flip a character in the signature segment.
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a');
    await expect(verifyToken(parts.join('.'), SECRET)).rejects.toBeTruthy();
  });

  it('throws when the token is already expired', async () => {
    // Absolute exp in the past -> immediately invalid.
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await signToken({ sub: 'u1', role: 'user' } as any, SECRET, past as any);
    await expect(verifyToken(token, SECRET)).rejects.toBeTruthy();
  });
});

describe('extractBearer', () => {
  it('extracts the token from a Bearer header', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for missing / malformed headers', () => {
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer('')).toBeNull();
    expect(extractBearer('Token abc')).toBeNull();
    expect(extractBearer('bearer abc')).toBeNull(); // case-sensitive scheme
  });
});
