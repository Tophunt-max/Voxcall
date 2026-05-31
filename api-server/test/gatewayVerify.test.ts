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
