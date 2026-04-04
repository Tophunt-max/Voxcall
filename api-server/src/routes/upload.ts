import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const upload = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
upload.use('*', authMiddleware);

// FIX #4: Magic-byte file validation — prevents malicious file uploads disguised as images
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_MEDIA_SIZE = 25 * 1024 * 1024; // 25 MB

const FILE_SIGNATURES: Array<{ magic: number[]; mime: string }> = [
  { magic: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },
  { magic: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png' },
  { magic: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' }, // RIFF...WEBP
  { magic: [0x47, 0x49, 0x46], mime: 'image/gif' },
  { magic: [0x1A, 0x45, 0xDF, 0xA3], mime: 'video/webm' },
  { magic: [0x00, 0x00, 0x00], mime: 'video/mp4' }, // simplified — mp4 header varies
];

async function validateFileType(file: File, allowedTypes: Set<string>): Promise<string | null> {
  if (!allowedTypes.has(file.type)) {
    return `File type '${file.type}' is not allowed`;
  }
  // Read first 12 bytes for magic number check
  const slice = file.slice(0, 12);
  const buffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const matched = FILE_SIGNATURES.find(sig =>
    sig.magic.every((b, i) => bytes[i] === b)
  );
  if (!matched) return 'File content does not match a recognized format';
  return null;
}

// POST /api/upload/avatar — upload profile image to R2
upload.post('/avatar', async (c) => {
  const { sub } = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  // FIX #4: Size + magic byte validation
  if (file.size > MAX_AVATAR_SIZE) return c.json({ error: 'File too large. Max 5MB for avatars.' }, 413);
  const typeError = await validateFileType(file, ALLOWED_MIME_TYPES);
  if (typeError) return c.json({ error: typeError }, 415);

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
  const key = `avatars/${sub}-${Date.now()}.${safeExt}`;
  await c.env.STORAGE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { userId: sub },
  });

  // Return the public URL pattern (configure R2 custom domain in production)
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

  // FIX #4: Size validation for media
  if (file.size > MAX_MEDIA_SIZE) return c.json({ error: 'File too large. Max 25MB for media.' }, 413);

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 5);
  const key = `media/${sub}-${Date.now()}.${safeExt}`;
  await c.env.STORAGE.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const url = `/api/files/${key}`;
  return c.json({ url, key, type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video' });
});

// GET /api/files/:key* — serve files from R2
upload.get('/files/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'File not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000');
  return new Response(obj.body, { headers });
});

export default upload;
