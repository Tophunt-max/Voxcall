import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const upload = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
upload.use('*', authMiddleware);

// POST /api/upload/avatar — upload profile image to R2
upload.post('/avatar', async (c) => {
  const { sub } = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const ext = file.name.split('.').pop() || 'jpg';
  const key = `avatars/${sub}-${Date.now()}.${ext}`;
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

  const ext = file.name.split('.').pop() || 'bin';
  const key = `media/${sub}-${Date.now()}.${ext}`;
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
