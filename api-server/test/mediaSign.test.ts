import { describe, it, expect } from 'vitest';
import {
  isPrivateKey,
  extractFileKey,
  signMediaKey,
  signedFileUrl,
  resignIfPrivate,
  verifyMediaSig,
} from '../src/lib/mediaSign';

const SECRET = 'test-jwt-secret-value';
const NOW = 1_800_000_000;

describe('isPrivateKey', () => {
  it('flags chat-media/ and kyc/ as private', () => {
    expect(isPrivateKey('chat-media/u1-123.jpg')).toBe(true);
    expect(isPrivateKey('kyc/u1-123.jpg')).toBe(true);
  });
  it('treats public prefixes as NOT private', () => {
    expect(isPrivateKey('media/u1-123.jpg')).toBe(false);
    expect(isPrivateKey('avatars/u1.jpg')).toBe(false);
    expect(isPrivateKey('banners/x.jpg')).toBe(false);
  });
});

describe('extractFileKey', () => {
  it('pulls the key from an absolute URL (stripping query)', () => {
    expect(extractFileKey('https://api.example.com/api/files/chat-media/u1-1.jpg?exp=1&sig=ab')).toBe('chat-media/u1-1.jpg');
  });
  it('pulls the key from a relative path', () => {
    expect(extractFileKey('/api/files/kyc/u1-1.jpg')).toBe('kyc/u1-1.jpg');
  });
  it('accepts a bare key', () => {
    expect(extractFileKey('chat-media/u1-1.jpg')).toBe('chat-media/u1-1.jpg');
  });
  it('returns null for empty / unrecognised input', () => {
    expect(extractFileKey(null)).toBeNull();
    expect(extractFileKey(undefined)).toBeNull();
    expect(extractFileKey('')).toBeNull();
    expect(extractFileKey('https://evil.com/other/path')).toBeNull();
  });
});

describe('signMediaKey / verifyMediaSig', () => {
  it('round-trips a valid signature', async () => {
    const key = 'chat-media/u1-123.jpg';
    const { exp, sig } = await signMediaKey(key, SECRET, 3600, NOW);
    expect(exp).toBe(NOW + 3600);
    expect(await verifyMediaSig(key, exp, sig, SECRET, NOW)).toBe(true);
  });

  it('rejects a tampered key', async () => {
    const { exp, sig } = await signMediaKey('chat-media/u1-123.jpg', SECRET, 3600, NOW);
    expect(await verifyMediaSig('chat-media/ATTACKER-file.jpg', exp, sig, SECRET, NOW)).toBe(false);
  });

  it('rejects a tampered expiry (extending the window)', async () => {
    const key = 'chat-media/u1-123.jpg';
    const { exp, sig } = await signMediaKey(key, SECRET, 3600, NOW);
    expect(await verifyMediaSig(key, exp + 10_000, sig, SECRET, NOW)).toBe(false);
  });

  it('rejects an expired signature', async () => {
    const key = 'kyc/u1-1.jpg';
    const { exp, sig } = await signMediaKey(key, SECRET, 100, NOW);
    expect(await verifyMediaSig(key, exp, sig, SECRET, NOW + 200)).toBe(false); // 200s later
  });

  it('rejects a wrong secret', async () => {
    const key = 'chat-media/u1-1.jpg';
    const { exp, sig } = await signMediaKey(key, SECRET, 3600, NOW);
    expect(await verifyMediaSig(key, exp, sig, 'other-secret', NOW)).toBe(false);
  });

  it('fails closed on missing exp / sig', async () => {
    expect(await verifyMediaSig('chat-media/u1.jpg', null, 'abc', SECRET, NOW)).toBe(false);
    expect(await verifyMediaSig('chat-media/u1.jpg', NOW + 10, null, SECRET, NOW)).toBe(false);
    expect(await verifyMediaSig('chat-media/u1.jpg', 'not-a-number', 'abc', SECRET, NOW)).toBe(false);
  });
});

describe('signedFileUrl', () => {
  it('builds a verifiable /api/files URL with exp+sig', async () => {
    const url = await signedFileUrl('chat-media/u1-1.jpg', SECRET, 3600, NOW);
    expect(url.startsWith('/api/files/chat-media/u1-1.jpg?exp=')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    const key = extractFileKey(url)!;
    expect(await verifyMediaSig(key, params.get('exp'), params.get('sig'), SECRET, NOW)).toBe(true);
  });
});

describe('resignIfPrivate', () => {
  it('re-signs a private absolute URL into a fresh verifiable signed URL', async () => {
    const stored = 'https://api.example.com/api/files/chat-media/u1-1.jpg?exp=1&sig=old';
    const fresh = await resignIfPrivate(stored, SECRET, 7 * 86400, NOW);
    expect(fresh).toBeTruthy();
    const params = new URLSearchParams(String(fresh).split('?')[1]);
    expect(await verifyMediaSig('chat-media/u1-1.jpg', params.get('exp'), params.get('sig'), SECRET, NOW)).toBe(true);
  });

  it('leaves a public/legacy URL unchanged', async () => {
    const stored = 'https://api.example.com/api/files/media/u1-1.jpg';
    expect(await resignIfPrivate(stored, SECRET, 3600, NOW)).toBe(stored);
  });

  it('normalises empty input to null (safe for nullable DB fields)', async () => {
    expect(await resignIfPrivate(null, SECRET, 3600, NOW)).toBeNull();
    expect(await resignIfPrivate(undefined, SECRET, 3600, NOW)).toBeNull();
  });
});
