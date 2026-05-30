import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  timingSafeEqual,
  generateOTP,
  generateId,
} from '../src/lib/hash';

// Reproduce the legacy (pre-PBKDF2) hash format so we can prove backward
// compatibility: unsalted base64(SHA-256(password)).
async function legacySha256Base64(password: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

describe('hashPassword / verifyPassword (PBKDF2)', () => {
  it('produces a salted pbkdf2 hash in the expected format', async () => {
    const stored = await hashPassword('hunter2');
    expect(stored.startsWith('pbkdf2:100000:')).toBe(true);
    expect(stored.split(':')).toHaveLength(4);
  });

  it('verifies the correct password and rejects the wrong one', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('uses a random salt — same password hashes differently each time', async () => {
    const a = await hashPassword('samePass');
    const b = await hashPassword('samePass');
    expect(a).not.toBe(b);
    // ...yet both still verify
    expect(await verifyPassword('samePass', a)).toBe(true);
    expect(await verifyPassword('samePass', b)).toBe(true);
  });

  it('still verifies legacy unsalted SHA-256 hashes (backward compat)', async () => {
    const legacy = await legacySha256Base64('oldUserPassword');
    expect(await verifyPassword('oldUserPassword', legacy)).toBe(true);
    expect(await verifyPassword('nope', legacy)).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('returns true only for identical equal-length strings', () => {
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });

  it('returns false immediately for differing lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });
});

describe('generateOTP', () => {
  it('always returns a 6-digit numeric string', () => {
    for (let i = 0; i < 200; i++) {
      const otp = generateOTP();
      expect(otp).toMatch(/^\d{6}$/);
      const n = Number(otp);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});

describe('generateId', () => {
  it('returns a 16-char hex id with no dashes', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });
});
