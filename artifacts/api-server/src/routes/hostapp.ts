// Host Application & KYC routes
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const hostapp = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
hostapp.use('*', authMiddleware);

// GET /api/host-app/status — check own application status
hostapp.get('/status', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  const app = await db
    .prepare('SELECT * FROM host_applications WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1')
    .bind(sub)
    .first<any>();

  if (!app) return c.json({ applied: false });

  return c.json({
    applied: true,
    id: app.id,
    status: app.status,           // pending | under_review | approved | rejected
    rejection_reason: app.rejection_reason ?? null,
    reviewed_at: app.reviewed_at ?? null,
    submitted_at: app.submitted_at,
    display_name: app.display_name,
    specialties: JSON.parse(app.specialties || '[]'),
    aadhar_front_url: app.aadhar_front_url,
    aadhar_back_url: app.aadhar_back_url,
    verification_video_url: app.verification_video_url,
  });
});

// POST /api/host-app/submit — submit or update the KYC application
hostapp.post('/submit', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<any>();

  // Check if already approved — cannot re-apply
  const existing = await db
    .prepare("SELECT id, status FROM host_applications WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1")
    .bind(sub)
    .first<any>();

  if (existing?.status === 'approved') {
    return c.json({ error: 'Application already approved' }, 409);
  }

  const id = existing?.id ?? ('ha_' + crypto.randomUUID());
  const {
    display_name, date_of_birth, gender, phone, bio,
    specialties, languages, experience,
    audio_rate, video_rate,
    aadhar_front_url, aadhar_back_url, verification_video_url,
  } = body;

  if (!aadhar_front_url || !aadhar_back_url) {
    return c.json({ error: 'Aadhar front and back photos required' }, 400);
  }

  if (existing) {
    await db.prepare(
      `UPDATE host_applications SET
        display_name=?, date_of_birth=?, gender=?, phone=?, bio=?,
        specialties=?, languages=?, experience=?,
        audio_rate=?, video_rate=?,
        aadhar_front_url=?, aadhar_back_url=?, verification_video_url=?,
        status='pending', rejection_reason=NULL,
        submitted_at=unixepoch(), updated_at=unixepoch()
       WHERE id=?`
    ).bind(
      display_name ?? null, date_of_birth ?? null, gender ?? null, phone ?? null, bio ?? null,
      JSON.stringify(specialties ?? []), JSON.stringify(languages ?? ['English']), experience ?? null,
      audio_rate ?? 5, video_rate ?? 8,
      aadhar_front_url, aadhar_back_url, verification_video_url ?? null,
      id
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO host_applications
        (id, user_id, display_name, date_of_birth, gender, phone, bio,
         specialties, languages, experience, audio_rate, video_rate,
         aadhar_front_url, aadhar_back_url, verification_video_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, sub,
      display_name ?? null, date_of_birth ?? null, gender ?? null, phone ?? null, bio ?? null,
      JSON.stringify(specialties ?? []), JSON.stringify(languages ?? ['English']), experience ?? null,
      audio_rate ?? 5, video_rate ?? 8,
      aadhar_front_url, aadhar_back_url, verification_video_url ?? null
    ).run();
  }

  return c.json({ success: true, application_id: id, status: 'pending' });
});

export default hostapp;
