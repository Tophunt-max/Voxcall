// PBKDF2-based password hashing (production-grade, salted + iterated)
// Backward compatible: legacy SHA-256 passwords still verify correctly
// New passwords use format: pbkdf2:<iterations>:<saltHex>:<hashHex>

const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2Hash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const toHex = (buf: Uint8Array) =>
    Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(derived))}`;
}

export async function hashPassword(password: string): Promise<string> {
  return pbkdf2Hash(password);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2:')) {
    const [, itersStr, saltHex, expectedHash] = stored.split(':');
    const iterations = parseInt(itersStr, 10);
    const salt = new Uint8Array(saltHex.match(/../g)!.map(h => parseInt(h, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const hashHex = Array.from(new Uint8Array(derived))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    // SECURITY FIX: Use constant-time comparison to prevent timing attacks
    return timingSafeEqual(hashHex, expectedHash);
  }
  // Legacy backward-compat: plain SHA-256 without salt (existing users)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  const legacyHash = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return timingSafeEqual(legacyHash, stored);
}

// Constant-time string comparison to prevent timing attacks on password/OTP verification
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function generateOTP(): string {
  // SECURITY FIX: Use crypto.getRandomValues() instead of Math.random()
  // Math.random() is not cryptographically secure for OTP generation
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
