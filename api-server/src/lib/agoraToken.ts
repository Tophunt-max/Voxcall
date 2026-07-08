// ============================================================================
// Agora RTC token generator — legacy AccessToken "006" format.
// ============================================================================
//
// Implemented with the Web Crypto API (HMAC-SHA256) + a small pure-JS CRC32 and
// little-endian byte packer, so it runs on Cloudflare Workers with NO Node
// dependencies and NO zlib (the newer AccessToken2 "007" format uses zlib,
// which is why we use 006 here — both formats are fully accepted by the Agora
// RTC SDKs: agora-rtc-sdk-ng on web and react-native-agora on native).
//
// Reference: Agora's AccessToken (DynamicKey) 006 algorithm.
//   token = "006" + appId + base64( packString(signature)
//                                   + uint32LE(crc32(channel))
//                                   + uint32LE(crc32(uid))
//                                   + packString(message) )
//   signature = HMAC_SHA256(appCertificate, appId + channel + uid + message)
//   message   = uint32LE(salt) + uint32LE(ts) + map<uint16 priv, uint32 expireTs>
// ============================================================================

const VERSION = '006';

// RTC privileges.
const PRIVILEGE = {
  JOIN_CHANNEL: 1,
  PUBLISH_AUDIO: 2,
  PUBLISH_VIDEO: 3,
  PUBLISH_DATA: 4,
} as const;

// ── little-endian packing helpers ───────────────────────────────────────────
function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
// packString: uint16 length prefix + raw bytes.
function packBytes(bytes: Uint8Array): Uint8Array {
  return concat(u16(bytes.length), bytes);
}
// packMap: uint16 count + sorted [uint16 key, uint32 value] pairs.
function packMap(entries: Array<[number, number]>): Uint8Array {
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  let out = u16(sorted.length);
  for (const [k, v] of sorted) out = concat(out, u16(k), u32(v));
  return out;
}

// ── CRC32 (IEEE 802.3), unsigned ─────────────────────────────────────────────
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function hmacSha256(keyStr: string, msg: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, msg as unknown as ArrayBuffer);
  return new Uint8Array(sig);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // btoa is available in the Workers runtime.
  return btoa(s);
}

/**
 * Build an Agora RTC token (006) that grants join + publish (audio/video/data)
 * privileges on `channelName` for `uid`.
 *
 * Pass `uid = 0` to mint a token valid for ANY uid on the channel — convenient
 * for 1:1 calls where we let Agora auto-assign uids. The channel is a random
 * session id and the token is only handed to the two authorized participants,
 * so a uid-0 token is safe here.
 *
 * @param expireSeconds seconds from now until the token (and privileges) expire.
 */
export async function buildAgoraRtcToken(
  appId: string,
  appCertificate: string,
  channelName: string,
  uid: number,
  expireSeconds: number,
): Promise<string> {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = now + expireSeconds;
  // salt: random uint32 (>0). ts: the token's own expiry.
  const salt = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  const ts = privilegeExpiredTs;

  const message = concat(
    u32(salt),
    u32(ts),
    packMap([
      [PRIVILEGE.JOIN_CHANNEL, privilegeExpiredTs],
      [PRIVILEGE.PUBLISH_AUDIO, privilegeExpiredTs],
      [PRIVILEGE.PUBLISH_VIDEO, privilegeExpiredTs],
      [PRIVILEGE.PUBLISH_DATA, privilegeExpiredTs],
    ]),
  );

  // uid 0 → empty string (matches Agora's reference implementation).
  const uidStr = uid === 0 ? '' : String(uid);

  const toSign = concat(
    enc.encode(appId),
    enc.encode(channelName),
    enc.encode(uidStr),
    message,
  );
  const signature = await hmacSha256(appCertificate, toSign);

  const content = concat(
    packBytes(signature),
    u32(crc32(enc.encode(channelName))),
    u32(crc32(enc.encode(uidStr))),
    packBytes(message),
  );

  return VERSION + appId + base64(content);
}

/**
 * Whether Agora is configured on this Worker. Agora is the ONLY call transport,
 * so when this is false the /agora-token endpoint returns 500 and calls are
 * disabled until AGORA_APP_ID + AGORA_APP_CERTIFICATE are set. There is no
 * fallback transport.
 */
export function isAgoraConfigured(env: { AGORA_APP_ID?: string; AGORA_APP_CERTIFICATE?: string }): boolean {
  return !!(env.AGORA_APP_ID && env.AGORA_APP_ID.trim() && env.AGORA_APP_CERTIFICATE && env.AGORA_APP_CERTIFICATE.trim());
}
