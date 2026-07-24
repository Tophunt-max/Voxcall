import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { checkRateLimit } from '../lib/rateLimit';
import { sendFCMPush } from '../lib/fcm';
import { applyLevelUp } from '../lib/levelService';
import { atomicGiftTransfer, reverseGiftTransfer } from '../lib/transfers';
import { bumpRewardProgress } from './rewards';
import type { Env, JWTPayload } from '../types';

// ============================================================================
// Chat gifts — monetized in-chat gifts (Model D)
// ============================================================================
// A gift is a special chat message: coins are debited from the sender and
// credited to the host (counting toward host earnings + levels, like tips),
// and a 'gift' message is persisted so it renders inline in both apps.
// Reuses the atomic all-or-nothing coin-transfer pattern from tips/billing.
// ============================================================================

const gifts = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
gifts.use('*', authMiddleware);

// Platform commission on gifts (percent, 0–90). Admin-set via
// app_settings.gift_commission_pct (Admin → Chat Gifts). Default 0 → host keeps
// 100% (historical behaviour) until an admin configures a cut.
async function getGiftCommissionPct(db: D1Database): Promise<number> {
  try {
    const r = await db.prepare("SELECT value FROM app_settings WHERE key = 'gift_commission_pct'").first<{ value: string }>();
    const pct = Number(r?.value);
    if (!Number.isFinite(pct)) return 0;
    return Math.min(90, Math.max(0, pct));
  } catch {
    return 0; // setting/table absent → no commission
  }
}

function serializeGift(g: any) {
  return {
    id: g.id,
    name: g.name,
    icon: g.icon,
    price_coins: Number(g.price_coins) || 0,
    sort_order: Number(g.sort_order) || 0,
  };
}

// GET /api/gifts — active gift catalog (for the in-chat picker).
gifts.get('/', async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      'SELECT * FROM gifts WHERE is_active = 1 ORDER BY sort_order ASC, price_coins ASC'
    ).all<any>();
    return c.json((rows.results ?? []).map(serializeGift));
  } catch (e: any) {
    // Pre-migration DB (gifts table absent) → empty catalog, feature hidden.
    if (/no such table/i.test(String(e?.message || ''))) return c.json([]);
    throw e;
  }
});

// POST /api/gifts/send { room_id, gift_id } — send a gift inside a chat room.
gifts.post('/send', async (c) => {
  const { sub, name: senderName } = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({})) as { room_id?: string; host_id?: string; session_id?: string; gift_id?: string; idempotency_key?: string };
  if (!body.gift_id || (!body.room_id && !body.host_id)) {
    return c.json({ error: 'gift_id and (room_id or host_id) are required' }, 400);
  }
  // Idempotency: a client sends the same key for a send + any automatic retry
  // (network timeout, 401 refresh). A key that already produced a gift returns
  // that gift WITHOUT charging again.
  const idemKey = typeof body.idempotency_key === 'string' && body.idempotency_key.trim().length > 0
    ? body.idempotency_key.trim().slice(0, 100)
    : null;

  // Anti-spam: cap gift sends per user (fail-open if rate_limits is missing).
  const rl = await checkRateLimit(db, `gift-send:${sub}`, 30, 60);
  if (rl.limited) return c.json({ error: 'Too many gifts. Please slow down.', code: 'RATE_LIMITED' }, 429);

  // Idempotency fast-path — a retried send returns the original result, no charge.
  if (idemKey) {
    const prior = await db.prepare(
      'SELECT id, room_id, gift_icon, gift_name, gift_amount, created_at FROM messages WHERE idempotency_key = ? AND sender_id = ? LIMIT 1'
    ).bind(idemKey, sub).first<any>().catch(() => null);
    if (prior) {
      const bal = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
      return c.json({
        success: true,
        duplicate: true,
        message_id: prior.id,
        room_id: prior.room_id,
        gift: { id: body.gift_id, name: prior.gift_name, icon: prior.gift_icon, amount: Number(prior.gift_amount) || 0 },
        created_at: prior.created_at ?? Math.floor(Date.now() / 1000),
        new_balance: Number(bal?.coins) || 0,
      });
    }
  }

  // The sender must be the room's regular user; the recipient is the host.
  // (Gifts only flow user → host — a host can't gift coins to a user.)
  let room: any;
  if (body.room_id) {
    room = await db.prepare(
      `SELECT cr.id, cr.user_id, cr.host_id, h.user_id AS host_user_id
       FROM chat_rooms cr
       JOIN hosts h ON h.id = cr.host_id
       WHERE cr.id = ?`
    ).bind(body.room_id).first<any>();
  } else {
    // Gifting during a call: the client has the host id but may not have a chat
    // room yet. Resolve-or-create the (caller, host) room. The active call is
    // itself the unlock, so we intentionally bypass the chat_unlock_policy gate
    // (which normally requires a prior call before chatting).
    room = await db.prepare(
      `SELECT cr.id, cr.user_id, cr.host_id, h.user_id AS host_user_id
       FROM chat_rooms cr
       JOIN hosts h ON h.id = cr.host_id
       WHERE cr.user_id = ? AND cr.host_id = ?`
    ).bind(sub, body.host_id).first<any>();
    if (!room) {
      const hostRow = await db.prepare('SELECT id, user_id FROM hosts WHERE id = ?').bind(body.host_id).first<{ id: string; user_id: string }>();
      if (!hostRow) return c.json({ error: 'Host not found' }, 404);
      const newRoomId = crypto.randomUUID();
      // ON CONFLICT so two concurrent first-time gifts can't 500 on the
      // UNIQUE(user_id, host_id) constraint — then re-select the surviving row.
      await db.prepare('INSERT INTO chat_rooms (id, user_id, host_id) VALUES (?, ?, ?) ON CONFLICT(user_id, host_id) DO NOTHING')
        .bind(newRoomId, sub, body.host_id).run();
      const resolved = await db.prepare(
        `SELECT cr.id, cr.user_id, cr.host_id, h.user_id AS host_user_id
         FROM chat_rooms cr JOIN hosts h ON h.id = cr.host_id
         WHERE cr.user_id = ? AND cr.host_id = ?`
      ).bind(sub, body.host_id).first<any>();
      room = resolved ?? { id: newRoomId, user_id: sub, host_id: body.host_id, host_user_id: hostRow.user_id };
    }
  }
  if (!room) return c.json({ error: 'Room not found' }, 404);
  if (room.user_id !== sub) {
    return c.json({ error: 'Only the sender in this chat can send gifts' }, 403);
  }
  const roomId: string = room.id;
  const hostUserId: string = room.host_user_id;
  if (!hostUserId || hostUserId === sub) {
    return c.json({ error: 'Invalid gift recipient' }, 400);
  }

  // Resolve the gift from the active catalog.
  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ? AND is_active = 1')
    .bind(body.gift_id).first<any>();
  if (!gift) return c.json({ error: 'Gift not found or unavailable' }, 404);
  const amount = Math.max(0, Number(gift.price_coins) || 0);
  if (amount <= 0) return c.json({ error: 'Invalid gift price' }, 400);

  // Platform commission: the sender pays the full price; the host receives
  // amount − platformCut. The cut is the platform's margin (realized as fewer
  // host coins → less payout) and leaves circulation, exactly like the call
  // earning-share. Default 0% keeps the historical host-gets-100% behaviour.
  const commissionPct = await getGiftCommissionPct(db);
  const platformCut = Math.floor((amount * commissionPct) / 100);
  const hostShare = Math.max(0, amount - platformCut);

  // Atomic all-or-nothing transfer: debit sender the full price, credit host
  // their share — only if the sender can afford it (spendable = coins - held).
  const moved = await atomicGiftTransfer(db, { senderId: sub, hostUserId, amount, hostAmount: hostShare });
  if (!moved) {
    return c.json({ error: `Not enough coins. This gift costs ${amount} coins.`, code: 'INSUFFICIENT_COINS' }, 402);
  }

  const msgId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const preview = `🎁 ${gift.name}`;

  // ATOMIC persistence. The coins have already moved (atomicGiftTransfer), so
  // the gift MESSAGE + both ledger rows + host earnings MUST persist together —
  // previously the message and ledger were separate best-effort steps, so a
  // failure left the user charged with NO gift and/or a broken reconciliation
  // ledger. If this batch fails, we REVERSE the coin move so a sender is never
  // charged for a gift that didn't save. The idempotency_key makes a concurrent
  // duplicate collide on the UNIQUE index (caught below → reversed).
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO messages (id, room_id, sender_id, content, msg_kind, gift_icon, gift_name, gift_amount, idempotency_key)
         VALUES (?, ?, ?, ?, 'gift', ?, ?, ?, ?)`
      ).bind(msgId, roomId, sub, preview, gift.icon, gift.name, amount, idemKey),
      db.prepare('UPDATE chat_rooms SET last_message = ?, last_message_at = ? WHERE id = ?')
        .bind(preview, now, roomId),
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), sub, 'spend', -amount, `Gift sent: ${gift.name}`, msgId),
      db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), hostUserId, 'bonus', hostShare, `Gift received: ${gift.name}`, msgId),
      // Gifts count toward the host's lifetime earnings (feeds level-up) — the
      // host's NET share after platform commission. gifts_received is a
      // denormalized level metric (count of gifts + tips received); bumped in
      // the same atomic batch so it can never drift from the ledger.
      db.prepare('UPDATE hosts SET total_earnings = total_earnings + ?, gifts_received = COALESCE(gifts_received, 0) + 1 WHERE id = ?')
        .bind(hostShare, room.host_id),
    ]);
  } catch (e: any) {
    // Persist failed → refund the sender (and reverse the host credit) so the
    // charge never happens without a matching gift + ledger.
    await reverseGiftTransfer(db, { senderId: sub, hostUserId, amount, hostAmount: hostShare })
      .catch((re) => console.error('[gifts/send] CRITICAL: reversal after persist failure FAILED:', re));
    // A UNIQUE(idempotency_key) collision means a concurrent identical send
    // already recorded this gift — return that original (net single charge).
    if (idemKey && /unique|constraint/i.test(String(e?.message || ''))) {
      const prior = await db.prepare(
        'SELECT id, room_id, gift_icon, gift_name, gift_amount, created_at FROM messages WHERE idempotency_key = ? AND sender_id = ? LIMIT 1'
      ).bind(idemKey, sub).first<any>().catch(() => null);
      if (prior) {
        const bal = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
        return c.json({
          success: true,
          duplicate: true,
          message_id: prior.id,
          room_id: prior.room_id,
          gift: { id: body.gift_id, name: prior.gift_name, icon: prior.gift_icon, amount: Number(prior.gift_amount) || 0 },
          created_at: prior.created_at ?? now,
          new_balance: Number(bal?.coins) || 0,
        });
      }
    }
    console.error('[gifts/send] persist failed — coins refunded:', e);
    return c.json({ error: 'Could not send gift. Your coins were not charged.', code: 'GIFT_FAILED' }, 500);
  }

  // Reward progress: sending a gift ticks 'send_gifts' (+1) and 'spend_on_gifts'
  // (+coins spent) for the sender. Best-effort — never blocks the gift.
  c.executionCtx?.waitUntil?.(bumpRewardProgress(db, sub, 'send_gifts', 1).catch(() => {}));
  c.executionCtx?.waitUntil?.(bumpRewardProgress(db, sub, 'spend_on_gifts', amount).catch(() => {}));

  // A big gift can cross an earnings threshold — re-evaluate level in the
  // background (idempotent; no-op when no promotion is due).
  try {
    const promo = applyLevelUp(c.env, room.host_id, 'auto').catch(() => {});
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(promo);
    else await promo;
  } catch { /* never block a successful gift on level bookkeeping */ }

  // Live in-app delivery to the host (renders the gift bubble instantly) +
  // FCM push. Best-effort — the gift is already persisted.
  try {
    const stub = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(hostUserId));
    await stub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({
        type: 'chat_message',
        room_id: roomId,
        id: msgId,
        sender_id: sub,
        sender_name: senderName || 'User',
        content: preview,
        msg_kind: 'gift',
        gift_icon: gift.icon,
        gift_name: gift.name,
        gift_amount: amount,
        created_at: now,
      }),
    });
    // In-call gift → also fire a lightweight `call_gift` event so the host's
    // CALL screen (not the chat) plays the gift animation in real time.
    if (body.session_id) {
      await stub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call_gift',
          session_id: body.session_id,
          room_id: roomId,
          sender_name: senderName || 'User',
          gift_icon: gift.icon,
          gift_name: gift.name,
          gift_amount: amount,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    const recipient = await db.prepare('SELECT fcm_token FROM users WHERE id = ?').bind(hostUserId).first<{ fcm_token: string }>();
    if (recipient?.fcm_token) {
      await sendFCMPush(
        c.env.FIREBASE_SERVICE_ACCOUNT,
        recipient.fcm_token,
        `🎁 ${senderName || 'Someone'} sent you a gift!`,
        `You received a ${gift.name} ${gift.icon} — someone's thinking of you! 💛`,
        { type: 'chat_message', room_id: roomId },
        db,
      );
    }
  } catch (e) {
    console.warn('[gifts/send] delivery notify failed:', e);
  }

  // Persist an in-app notification so gifts show in the host's notifications
  // history. Live delivery + push are already handled by the chat_message
  // event + FCM above, so we insert the row only (no extra push/toast).
  try {
    await db.prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), hostUserId, 'gift', '🎁 You Received a Gift!', `${senderName || 'Someone'} sent you a ${gift.name} ${gift.icon} worth ${amount} coins! Someone really appreciates you. 💛`, now)
      .run();
  } catch (e) {
    console.warn('[gifts/send] notification row insert failed:', e);
  }

  const after = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  return c.json({
    success: true,
    message_id: msgId,
    room_id: roomId,
    gift: { id: gift.id, name: gift.name, icon: gift.icon, amount },
    created_at: now,
    new_balance: Number(after?.coins) || 0,
  });
});

export default gifts;
