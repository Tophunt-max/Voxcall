import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { applyLevelUp } from '../lib/levelService';
import { notifyUser } from '../lib/realtime';
import { checkRateLimit } from '../lib/rateLimit';
import { atomicGiftTransfer, reverseGiftTransfer } from '../lib/transfers';
import type { Env, JWTPayload } from '../types';

const tip = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
tip.use('*', authMiddleware);

// Platform commission on tips (percent, 0–90). Admin-set via
// app_settings.tip_commission_pct (Admin → Settings → Gifts & Tips). Default 0
// → host keeps 100% (historical behaviour) until an admin configures a cut.
async function getTipCommissionPct(db: D1Database): Promise<number> {
  try {
    const r = await db.prepare("SELECT value FROM app_settings WHERE key = 'tip_commission_pct'").first<{ value: string }>();
    const pct = Number(r?.value);
    if (!Number.isFinite(pct)) return 0;
    return Math.min(90, Math.max(0, pct));
  } catch {
    return 0; // setting/table absent → no commission
  }
}

const sendTipSchema = z.object({
  host_id: z.string().min(1),
  amount: z.number().int().min(1).max(50000),
  message: z.string().max(200).optional(),
  call_session_id: z.string().optional(),
});

// POST /api/tips/send — send a tip (coins) to a host
tip.post('/send', zValidator('json', sendTipSchema), async (c) => {
  const { sub } = c.get('user');
  const body = c.req.valid('json');
  const db = c.env.DB;

  // Anti-spam / accidental double-tip guard: cap tip sends per user. Mirrors
  // the gift-send limiter. Without this, a laggy UI or a network retry could
  // fire /tips/send twice and charge the user for two tips. Fail-open if the
  // rate_limits table is missing (pre-migration DB).
  const rl = await checkRateLimit(db, `tip-send:${sub}`, 30, 60);
  if (rl.limited) {
    return c.json({ error: 'Too many tips. Please slow down.', code: 'RATE_LIMITED' }, 429);
  }

  // Lookup host
  const host = await db.prepare('SELECT id, user_id, display_name FROM hosts WHERE id = ?')
    .bind(body.host_id).first<{ id: string; user_id: string; display_name: string }>();
  if (!host) return c.json({ error: 'Host not found' }, 404);

  // Cannot tip yourself
  if (host.user_id === sub) {
    return c.json({ error: 'Cannot send a tip to yourself' }, 400);
  }

  // Platform commission on tips (admin-set, mirrors gifts). The sender pays the
  // full tip; the host receives amount − cut. The cut is the platform margin
  // and leaves circulation (same model as gifts + the call earning-share).
  const commissionPct = await getTipCommissionPct(db);
  const platformCut = Math.floor((body.amount * commissionPct) / 100);
  const hostShare = Math.max(0, body.amount - platformCut);

  // Atomic coin transfer: debit sender the full tip, credit host their share —
  // only if the sender can afford it (spendable = coins - held).
  const tipId = crypto.randomUUID();
  const moved = await atomicGiftTransfer(db, { senderId: sub, hostUserId: host.user_id, amount: body.amount, hostAmount: hostShare });
  if (!moved) {
    return c.json({ error: 'Insufficient coins' }, 402);
  }

  // ATOMIC persistence: the tip record + both ledger rows + host earnings must
  // persist together. If it fails, REVERSE the coin move so the sender is never
  // charged for a tip that didn't save (previously these were best-effort AFTER
  // the transfer, so a failure meant a silent charge + a broken reconciliation
  // ledger). Host bonus + earnings record the NET share after commission.
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO tips (id, sender_id, recipient_id, host_id, call_session_id, amount, message) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(tipId, sub, host.user_id, host.id, body.call_session_id ?? null, body.amount, body.message ?? null),
      db.prepare(
        'INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), sub, 'spend', -body.amount, `Tip to ${host.display_name || 'Host'}`, tipId),
      db.prepare(
        'INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), host.user_id, 'bonus', hostShare, `Tip received`, tipId),
      // Tips count toward the host's lifetime earnings (feeds level-up) — the
      // host's NET share after platform commission. gifts_received is a
      // denormalized level metric (count of gifts + tips received); bumped in
      // the same atomic batch so it can never drift from the ledger.
      db.prepare('UPDATE hosts SET total_earnings = total_earnings + ?, gifts_received = COALESCE(gifts_received, 0) + 1 WHERE id = ?')
        .bind(hostShare, host.id),
    ]);
  } catch (e) {
    await reverseGiftTransfer(db, { senderId: sub, hostUserId: host.user_id, amount: body.amount, hostAmount: hostShare })
      .catch((re) => console.error('[tip/send] CRITICAL: reversal after persist failure FAILED:', re));
    console.error('[tip/send] persist failed — coins refunded:', e);
    return c.json({ error: 'Could not send tip. Your coins were not charged.', code: 'TIP_FAILED' }, 500);
  }

  // A large tip can push the host across an earnings threshold — re-evaluate
  // their level immediately (idempotent; a no-op when no promotion is due).
  // Runs in the background so it never adds latency to the tip response.
  try {
    const promo = applyLevelUp(c.env, host.id, 'auto').catch(() => {});
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(promo);
    else await promo;
  } catch { /* never block a successful tip on level bookkeeping */ }

  // Notify host via WebSocket
  try {
    const sender = await db.prepare('SELECT name FROM users WHERE id = ?').bind(sub).first<{ name: string }>();
    const notifId = c.env.NOTIFICATION_HUB.idFromName(host.user_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({
        type: 'tip_received',
        amount: body.amount,
        sender_name: sender?.name ?? 'Someone',
        message: body.message ?? null,
        tip_id: tipId,
      }),
    });
    // Persist + offline push (realtime:false — the tip_received socket event
    // above already shows the live toast to online hosts, so we skip the extra
    // notification_new to avoid a double toast; the row + FCM still land).
    c.executionCtx?.waitUntil?.(notifyUser(
      c.env, host.user_id, 'Tip received 💝',
      `${sender?.name ?? 'Someone'} sent you ${body.amount} coins${body.message ? `: ${body.message}` : ''}`,
      'tip', { realtime: false },
    ));
  } catch (e) {
    console.warn('[tip/send] notification failed:', e);
  }

  const updatedBalance = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();

  return c.json({
    success: true,
    tip_id: tipId,
    amount: body.amount,
    new_balance: updatedBalance?.coins ?? 0,
  });
});

// GET /api/tips/sent — tips sent by the current user
tip.get('/sent', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  try {
    const result = await db.prepare(
      `SELECT t.*, h.display_name as host_name, u.avatar_url as host_avatar
       FROM tips t
       JOIN hosts h ON h.id = t.host_id
       JOIN users u ON u.id = t.recipient_id
       WHERE t.sender_id = ?
       ORDER BY t.created_at DESC LIMIT 50`
    ).bind(sub).all();
    return c.json(result.results ?? []);
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) return c.json([]);
    throw e;
  }
});

// GET /api/tips/received — tips received by the current host user
tip.get('/received', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  try {
    const result = await db.prepare(
      `SELECT t.*, u.name as sender_name, u.avatar_url as sender_avatar
       FROM tips t
       JOIN users u ON u.id = t.sender_id
       WHERE t.recipient_id = ?
       ORDER BY t.created_at DESC LIMIT 50`
    ).bind(sub).all();
    return c.json(result.results ?? []);
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) return c.json([]);
    throw e;
  }
});

export default tip;
