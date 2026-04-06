import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const upload = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav',
  'video/mp4', 'video/webm', 'video/ogg',
]);
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;   // 5 MB
const MAX_MEDIA_SIZE  = 25 * 1024 * 1024;  // 25 MB

// ─── Magic-byte signatures ─────────────────────────────────────────────────────
// Security fix: WebP check now correctly validates RIFF at offset 0 AND "WEBP" at offset 8.
// Previously only RIFF was checked — WAV and AVI files (also RIFF-based) were accepted.
type Sig = {
  mime: string;
  magic: number[];
  offset?: number;
  extra?: { offset: number; magic: number[] };
};

const FILE_SIGNATURES: Sig[] = [
  { mime: 'image/jpeg', magic: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',  magic: [0x89, 0x50, 0x4E, 0x47] },
  {
    mime: 'image/webp',
    magic: [0x52, 0x49, 0x46, 0x46],                         // RIFF at byte 0
    extra: { offset: 8, magic: [0x57, 0x45, 0x42, 0x50] },  // WEBP at byte 8
  },
  { mime: 'image/gif', magic: [0x47, 0x49, 0x46] },
  { mime: 'audio/mpeg', magic: [0xFF, 0xFB] },
  { mime: 'audio/mpeg', magic: [0x49, 0x44, 0x33] },         // ID3
  { mime: 'audio/ogg',  magic: [0x4F, 0x67, 0x67, 0x53] },  // OggS
  { mime: 'audio/webm', magic: [0x1A, 0x45, 0xDF, 0xA3] },  // EBML (same as webm video)
  { mime: 'audio/mp4',  magic: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ftyp at byte 4
  {                                                            // WAV: RIFF header + WAVE marker
    mime: 'audio/wav',
    magic: [0x52, 0x49, 0x46, 0x46],                         // RIFF at byte 0
    extra: { offset: 8, magic: [0x57, 0x41, 0x56, 0x45] },  // WAVE at byte 8
  },
  { mime: 'video/webm', magic: [0x1A, 0x45, 0xDF, 0xA3] },
  { mime: 'video/mp4',  magic: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ftyp at byte 4
  { mime: 'video/ogg',  magic: [0x4F, 0x67, 0x67, 0x53] },  // OggS (same as audio/ogg)
];

function matchesSig(bytes: Uint8Array, sig: Sig): boolean {
  const start = sig.offset ?? 0;
  const mainMatch = sig.magic.every((b, i) => bytes[start + i] === b);
  if (!mainMatch) return false;
  if (sig.extra) {
    return sig.extra.magic.every((b, i) => bytes[sig.extra!.offset + i] === b);
  }
  return true;
}

async function validateFileType(file: File, allowed: Set<string>): Promise<string | null> {
  if (!allowed.has(file.type)) return `File type '${file.type}' is not allowed`;
  const buffer = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const matched = FILE_SIGNATURES.find(s => s.mime === file.type && matchesSig(bytes, s));
  if (!matched) return 'File content does not match its declared type';
  return null;
}

// ─── Upload routes — auth required ────────────────────────────────────────────
// Note: public file serving (R2) is handled by /api/files/:key in public.ts
upload.use('/avatar', authMiddleware);
upload.use('/media', authMiddleware);

// POST /api/upload/avatar — upload profile image to R2
upload.post('/avatar', async (c) => {
  const { sub } = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  if (file.size > MAX_AVATAR_SIZE) return c.json({ error: 'File too large. Max 5 MB for avatars.' }, 413);
  const typeError = await validateFileType(file, ALLOWED_IMAGE_TYPES);
  if (typeError) return c.json({ error: typeError }, 415);

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
  const key = `avatars/${sub}-${Date.now()}.${safeExt}`;
  await c.env.STORAGE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { userId: sub },
  });

  const url = `/api/files/${key}`;
  await c.env.DB.prepare('UPDATE users SET avatar_url = ?, updated_at = unixepoch() WHERE id = ?').bind(url, sub).run();
  return c.json({ url, key });
});

// POST /api/upload/media — upload chat media to R2
upload.post('/media', async (c) => {
  const { sub } = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  if (file.size > MAX_MEDIA_SIZE) return c.json({ error: 'File too large. Max 25 MB for media.' }, 413);

  // Security fix: validate magic bytes for media uploads (was missing before)
  const typeError = await validateFileType(file, ALLOWED_MEDIA_TYPES);
  if (typeError) return c.json({ error: typeError }, 415);

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 5);
  const key = `media/${sub}-${Date.now()}.${safeExt}`;
  await c.env.STORAGE.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const url = `/api/files/${key}`;
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video';
  return c.json({ url, key, type: kind });
});

export default upload;
