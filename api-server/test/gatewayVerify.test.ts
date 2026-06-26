import { describe, it, expect } from 'vitest';
import {
  sha256Hex,
  hmacSha256Hex,
  verifyRazorpaySignature,
  verifyStripeSignature,
  verifyPhonePeXVerify,
  verifyPhonePeAuthorization,
  verifyPaytmChecksum,
  paytmParamString,
} from '../src/lib/gatewayVerify';

const encoder = new TextEncoder();

// ─── Test helpers that GENERATE valid signatures the same way each provider
//     does, so a successful verify proves the verifier matches the algorithm.

function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

async function makePaytmChecksum(
  params: Record<string, any>,
  key: string,
  salt = 'abcd',
): Promise<string> {
  const dataString = `${paytmParamString(params)}|${salt}`;
  const hash = (await sha256Hex(dataString)) + salt;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: encoder.encode('@@@@&&&&####$$$$') },
    cryptoKey,
    encoder.encode(hash),
  );
  return Buffer.from(new Uint8Array(cipher)).toString('base64');
}

describe('Razorpay signature', () => {
  it('verifies a valid HMAC and rejects a forged one', async () => {
    const secret = 'rzp_test_secret';
    const body = JSON.stringify({ event: 'payment.captured', id: 'pay_123' });
    const sig = await hmacSha256Hex(secret, body);
    expect(await verifyRazorpaySignature(body, sig, secret)).toBe(true);
    expect(await verifyRazorpaySignature(body, sig, 'wrong_secret')).toBe(false);
    expect(await verifyRazorpaySignature(body, 'deadbeef', secret)).toBe(false);
    expect(await verifyRazorpaySignature(body, '', secret)).toBe(false);
  });
});

describe('Stripe signature', () => {
  it('verifies a fresh signature and rejects stale / forged', async () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ type: 'payment_intent.succeeded' });
    const now = 1_700_000_000;
    const v1 = await hmacSha256Hex(secret, `${now}.${body}`);
    const header = `t=${now},v1=${v1}`;
    expect(await verifyStripeSignature(body, header, secret, now)).toBe(true);
    // Stale (older than tolerance)
    expect(await verifyStripeSignature(body, header, secret, now + 10_000)).toBe(false);
    // Forged signature
    expect(await verifyStripeSignature(body, `t=${now},v1=deadbeef`, secret, now)).toBe(false);
    // Malformed header
    expect(await verifyStripeSignature(body, 'garbage', secret, now)).toBe(false);
  });
});

describe('PhonePe X-VERIFY (legacy S2S)', () => {
  it('verifies sha256(base64Response + saltKey)###index', async () => {
    const saltKey = 'phonepe_salt_key';
    const saltIndex = '1';
    const responseObj = { code: 'PAYMENT_SUCCESS', data: { merchantTransactionId: 'ORDER1' } };
    const base64Response = b64(JSON.stringify(responseObj));
    const hash = await sha256Hex(base64Response + saltKey);
    const header = `${hash}###${saltIndex}`;
    expect(await verifyPhonePeXVerify(base64Response, header, saltKey)).toBe(true);
    expect(await verifyPhonePeXVerify(base64Response, header, 'wrong_salt')).toBe(false);
    expect(await verifyPhonePeXVerify(base64Response, 'bad###1', saltKey)).toBe(false);
    expect(await verifyPhonePeXVerify(base64Response, '', saltKey)).toBe(false);
  });
});

describe('PhonePe Authorization (Standard Checkout webhook)', () => {
  it('verifies sha256(username:password)', async () => {
    const user = 'webhook_user';
    const pass = 'webhook_pass';
    const auth = await sha256Hex(`${user}:${pass}`);
    expect(await verifyPhonePeAuthorization(auth, user, pass)).toBe(true);
    expect(await verifyPhonePeAuthorization(`SHA256 ${auth}`, user, pass)).toBe(true);
    expect(await verifyPhonePeAuthorization(auth, user, 'wrong')).toBe(false);
    expect(await verifyPhonePeAuthorization('', user, pass)).toBe(false);
  });
});

describe('Paytm checksum (AES-128-CBC + SHA256)', () => {
  it('verifies a checksum generated with the documented algorithm', async () => {
    const key = '1234567890123456'; // 16-byte merchant key
    const params = { ORDERID: 'ORDER1', STATUS: 'TXN_SUCCESS', TXNID: 'TXN42' };
    const checksum = await makePaytmChecksum(params, key);
    expect(await verifyPaytmChecksum(params, key, checksum)).toBe(true);
    // Tampered param → fails
    expect(
      await verifyPaytmChecksum({ ...params, STATUS: 'TXN_FAILURE' }, key, checksum),
    ).toBe(false);
    // Wrong key → fails (decrypt yields garbage / padding error)
    expect(await verifyPaytmChecksum(params, '6543210987654321', checksum)).toBe(false);
    // Missing checksum → fails
    expect(await verifyPaytmChecksum(params, key, '')).toBe(false);
  });

  it('ignores CHECKSUMHASH key and sorts params deterministically', () => {
    expect(paytmParamString({ b: '2', a: '1', CHECKSUMHASH: 'x' })).toBe('1|2');
    expect(paytmParamString({ a: '1', z: null, m: 'mid' })).toBe('1|mid|');
  });
});


// ─── Additional edge-case coverage (Task 4 hardening) ────────────────────────
// These pin down behaviour that protects the money path: replay windows,
// header normalisation, and defensive handling of malformed provider input.

describe('Stripe signature — replay / clock-skew edges', () => {
  it('rejects a timestamp implausibly far in the future (clock skew / forged)', async () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ type: 'charge.succeeded' });
    const now = 1_700_000_000;
    // Sign for a timestamp 60s in the future — beyond the -10s future allowance.
    const future = now + 60;
    const v1 = await hmacSha256Hex(secret, `${future}.${body}`);
    expect(await verifyStripeSignature(body, `t=${future},v1=${v1}`, secret, now)).toBe(false);
  });

  it('accepts a signature within the tolerance window', async () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ type: 'charge.succeeded' });
    const now = 1_700_000_000;
    const signedAt = now - 120; // 2 min old, within default 300s tolerance
    const v1 = await hmacSha256Hex(secret, `${signedAt}.${body}`);
    expect(await verifyStripeSignature(body, `t=${signedAt},v1=${v1}`, secret, now)).toBe(true);
  });

  it('rejects a header missing the v1 component', async () => {
    const secret = 'whsec_test';
    const body = '{}';
    const now = 1_700_000_000;
    expect(await verifyStripeSignature(body, `t=${now}`, secret, now)).toBe(false);
  });
});

describe('PhonePe X-VERIFY — salt index variations', () => {
  it('verifies regardless of the salt index suffix value', async () => {
    const saltKey = 'salt_key_99';
    const base64Response = b64(JSON.stringify({ code: 'PAYMENT_SUCCESS' }));
    const hash = await sha256Hex(base64Response + saltKey);
    // Different merchants are assigned different salt indices — the verifier
    // only cares about the hash portion before "###".
    for (const idx of ['1', '2', '99']) {
      expect(await verifyPhonePeXVerify(base64Response, `${hash}###${idx}`, saltKey)).toBe(true);
    }
  });

  it('rejects when the base64 response body is tampered', async () => {
    const saltKey = 'salt_key_99';
    const original = b64(JSON.stringify({ code: 'PAYMENT_SUCCESS' }));
    const tampered = b64(JSON.stringify({ code: 'PAYMENT_ERROR' }));
    const hash = await sha256Hex(original + saltKey);
    expect(await verifyPhonePeXVerify(tampered, `${hash}###1`, saltKey)).toBe(false);
  });
});

describe('PhonePe Authorization — header normalisation', () => {
  it('is case-insensitive on the hex token and tolerates a scheme prefix', async () => {
    const user = 'wh_user';
    const pass = 'wh_pass';
    const auth = await sha256Hex(`${user}:${pass}`);
    expect(await verifyPhonePeAuthorization(auth.toUpperCase(), user, pass)).toBe(true);
    expect(await verifyPhonePeAuthorization(`Basic ${auth}`, user, pass)).toBe(true);
  });

  it('rejects when username or password are empty (misconfigured webhook)', async () => {
    const auth = await sha256Hex('a:b');
    expect(await verifyPhonePeAuthorization(auth, '', 'b')).toBe(false);
    expect(await verifyPhonePeAuthorization(auth, 'a', '')).toBe(false);
  });
});

describe('Paytm checksum — defensive input handling', () => {
  it('returns false (never throws) on a non-base64 / garbage checksum', async () => {
    const key = '1234567890123456';
    const params = { ORDERID: 'O1', STATUS: 'TXN_SUCCESS' };
    expect(await verifyPaytmChecksum(params, key, '!!!not-base64!!!')).toBe(false);
  });

  it('returns false when the merchant key is not 16 bytes (AES-128 guard)', async () => {
    const params = { ORDERID: 'O1', STATUS: 'TXN_SUCCESS' };
    const checksum = await makePaytmChecksum(params, '1234567890123456');
    // 8-byte key → AES-128 import/decrypt fails → verifier swallows + returns false.
    expect(await verifyPaytmChecksum(params, '12345678', checksum)).toBe(false);
  });

  it('renders the string "null" and undefined params as empty in the param string', () => {
    // 4 keys (a,b,c,d) sorted → 4 values joined by 3 pipes. b="null" and
    // c=undefined both render as empty strings.
    expect(paytmParamString({ a: '1', b: 'null', c: undefined, d: '4' })).toBe('1|||4');
  });
});
