import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type FakeD1 } from './helpers/d1';

// ─── Isolate the referral money pipeline from realtime / rewards side effects ─
// pushCoinUpdate / notifyUser reach the NotificationHub DO and are internally
// best-effort (never throw), but stubbing them keeps the test hermetic and
// deterministic. bumpRewardProgress writes to reward tables we don't create
// here, so it MUST be stubbed or creditReferralInternal would throw after the
// coins were already credited.
vi.mock('../src/lib/realtime', () => ({
  pushCoinUpdate: vi.fn(async () => {}),
  notifyUser: vi.fn(async () => {}),
}));
vi.mock('../src/routes/rewards', () => ({
  bumpRewardProgress: vi.fn(async () => 0),
}));

import {
  recordReferral,
  maybeUnlockReferral,
  releaseExpiredReferralHolds,
  clawbackReferrals,
} from '../src/lib/referral';

// Exercises the REAL SQL of the referral anti-fraud pipeline against an actual
// SQLite engine (the same engine D1 is built on). These are the money- and
// abuse-sensitive paths: attribution, the genuine-value gate, payout holds,
// velocity review, and clawback-on-ban.

let db: FakeD1;

// Full schema slice touched by referral.ts. Column set mirrors every query in
// the module so the SQL runs exactly as it does in production.
const SCHEMA = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    coins INTEGER NOT NULL DEFAULT 0,
    coins_held INTEGER NOT NULL DEFAULT 0,
    device_id TEXT,
    phone TEXT,
    updated_at INTEGER
  );
  CREATE TABLE referral_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL
  );
  CREATE TABLE referral_uses (
    id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL,
    referred_id TEXT NOT NULL UNIQUE,
    code TEXT,
    coins_given INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    flagged INTEGER NOT NULL DEFAULT 0,
    flag_reason TEXT,
    referrer_reward INTEGER NOT NULL DEFAULT 0,
    new_user_reward INTEGER NOT NULL DEFAULT 0,
    unlocked_at INTEGER,
    reward_state TEXT,
    hold_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
  );
  CREATE TABLE coin_purchases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT,
    amount INTEGER
  );
  CREATE TABLE host_applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT
  );
  CREATE TABLE call_sessions (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL,
    status TEXT,
    coins_charged INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE coin_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT,
    ref_id TEXT
  );
`;

// Default config = integrity ON, 100/50 reward, 7-day hold, daily cap 25.
const DEFAULT_SETTINGS = `
  INSERT INTO app_settings (key, value) VALUES
    ('referral_active', '1'),
    ('referral_integrity_enabled', '1'),
    ('referrer_reward', '100'),
    ('new_user_reward', '50'),
    ('min_calls_to_unlock', '1'),
    ('referral_hold_days', '7'),
    ('referral_daily_unlock_cap', '25'),
    ('referral_total_cap', '0'),
    ('referral_risk_review_enabled', '0');
`;

function env() {
  return { DB: db } as any;
}

async function row(id: string) {
  return db.prepare('SELECT * FROM referral_uses WHERE referred_id = ?').bind(id).first<any>();
}
async function coins(id: string): Promise<number> {
  const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(id).first<{ coins: number }>();
  return u?.coins ?? -1;
}
async function held(id: string): Promise<number> {
  const u = await db.prepare('SELECT coins_held FROM users WHERE id = ?').bind(id).first<{ coins_held: number }>();
  return u?.coins_held ?? -1;
}

beforeEach(() => {
  db = createTestDb();
  db.applySchema(SCHEMA);
});

// ─── recordReferral — signup attribution + guards ────────────────────────────
describe('recordReferral', () => {
  beforeEach(() => {
    db.applySchema(`
      INSERT INTO users (id, device_id, phone) VALUES
        ('referrer', 'devREF', '9000000001'),
        ('newbie',   'devNEW', '9000000002');
      INSERT INTO referral_codes (code, user_id) VALUES ('FRIEND10', 'referrer');
    `);
  });

  it('creates a pending attribution row for a valid code', async () => {
    await recordReferral(db as any, 'friend10', 'newbie', 'devNEW'); // lower-case → normalized
    const r = await row('newbie');
    expect(r?.referrer_id).toBe('referrer');
    expect(r?.status).toBe('pending');
    expect(r?.coins_given).toBe(0);
    expect(r?.code).toBe('FRIEND10');
  });

  it('ignores an unknown code (no row)', async () => {
    await recordReferral(db as any, 'NOPE', 'newbie', 'devNEW');
    expect(await row('newbie')).toBeNull();
  });

  it('refuses self-referral by the user\'s own code', async () => {
    db.applySchema("INSERT INTO referral_codes (code, user_id) VALUES ('SELF', 'newbie');");
    await recordReferral(db as any, 'SELF', 'newbie', 'devNEW');
    expect(await row('newbie')).toBeNull();
  });

  it('blocks same-device attribution (Sybil guard)', async () => {
    // newbie signs up on the SAME device as the referrer.
    await recordReferral(db as any, 'FRIEND10', 'newbie', 'devREF');
    expect(await row('newbie')).toBeNull();
  });

  it('is idempotent — a user is attributed to at most one referrer', async () => {
    await recordReferral(db as any, 'FRIEND10', 'newbie', 'devNEW');
    // A second code attempt (even a different valid one) must not overwrite.
    db.applySchema("INSERT INTO users (id) VALUES ('other'); INSERT INTO referral_codes (code, user_id) VALUES ('OTHER', 'other');");
    await recordReferral(db as any, 'OTHER', 'newbie', 'devNEW');
    const all = await db.prepare('SELECT COUNT(*) AS n FROM referral_uses WHERE referred_id = ?').bind('newbie').first<{ n: number }>();
    expect(all?.n).toBe(1);
    expect((await row('newbie'))?.referrer_id).toBe('referrer'); // unchanged
  });

  it('no-ops on empty / null code', async () => {
    await recordReferral(db as any, '', 'newbie', 'devNEW');
    await recordReferral(db as any, null, 'newbie', 'devNEW');
    expect(await row('newbie')).toBeNull();
  });
});

// ─── maybeUnlockReferral — genuine gate, credit+hold, void, review ───────────
describe('maybeUnlockReferral', () => {
  beforeEach(() => {
    db.applySchema(`
      INSERT INTO users (id, device_id, phone, coins, coins_held) VALUES
        ('referrer', 'devREF', '9000000001', 0, 0),
        ('newbie',   'devNEW', '9000000002', 0, 0);
      INSERT INTO referral_codes (code, user_id) VALUES ('FRIEND10', 'referrer');
      INSERT INTO referral_uses (id, referrer_id, referred_id, code, status)
        VALUES ('ru1', 'referrer', 'newbie', 'FRIEND10', 'pending');
    ` + DEFAULT_SETTINGS);
  });

  it('stays pending when the referred user has shown no genuine value yet', async () => {
    await maybeUnlockReferral(env(), 'newbie');
    const r = await row('newbie');
    expect(r?.status).toBe('pending');
    expect(await coins('referrer')).toBe(0);
    expect(await coins('newbie')).toBe(0);
  });

  it('credits with a held payout once the referred user recharges (genuine)', async () => {
    db.applySchema("INSERT INTO coin_purchases (id, user_id, status, amount) VALUES ('p1', 'newbie', 'success', 500);");
    await maybeUnlockReferral(env(), 'newbie');
    const r = await row('newbie');
    expect(r?.status).toBe('unlocked');
    expect(r?.reward_state).toBe('held');
    expect(Number(r?.hold_until)).toBeGreaterThan(Math.floor(Date.now() / 1000)); // hold in the future
    // New user reward credited outright; referrer reward held (in coins AND coins_held).
    expect(await coins('newbie')).toBe(50);
    expect(await coins('referrer')).toBe(100);
    expect(await held('referrer')).toBe(100);
    // Ledger rows written for both.
    const led = await db.prepare('SELECT COUNT(*) AS n FROM coin_transactions').first<{ n: number }>();
    expect(led?.n).toBe(2);
  });

  it('counts a KYC-approved host as genuine (host referrals, no recharge)', async () => {
    db.applySchema("INSERT INTO host_applications (id, user_id, status) VALUES ('h1', 'newbie', 'approved');");
    await maybeUnlockReferral(env(), 'newbie');
    expect((await row('newbie'))?.status).toBe('unlocked');
    expect(await coins('referrer')).toBe(100);
  });

  it('counts >= min PAID calls as genuine (free-trial calls do NOT count)', async () => {
    // A free-trial call has coins_charged = 0 and must NOT satisfy the gate.
    db.applySchema("INSERT INTO call_sessions (id, caller_id, status, coins_charged) VALUES ('c0', 'newbie', 'ended', 0);");
    await maybeUnlockReferral(env(), 'newbie');
    expect((await row('newbie'))?.status).toBe('pending'); // still not genuine

    // A real paid call flips it genuine.
    db.applySchema("INSERT INTO call_sessions (id, caller_id, status, coins_charged) VALUES ('c1', 'newbie', 'ended', 40);");
    await maybeUnlockReferral(env(), 'newbie');
    expect((await row('newbie'))?.status).toBe('unlocked');
  });

  it('voids a self-referral detected by shared phone (last-10-digit match)', async () => {
    // Same phone (different country-code prefix) → self-referral.
    db.applySchema("UPDATE users SET phone = '+91 90000 00001' WHERE id = 'newbie';");
    db.applySchema("INSERT INTO coin_purchases (id, user_id, status, amount) VALUES ('p1', 'newbie', 'success', 500);");
    await maybeUnlockReferral(env(), 'newbie');
    const r = await row('newbie');
    expect(r?.status).toBe('void');
    expect(r?.flag_reason).toBe('same_phone');
    expect(await coins('referrer')).toBe(0); // never paid
  });

  it('sends a genuine referral to review when the referrer is over the daily cap', async () => {
    // Seed 25 already-unlocked referrals today for the referrer → at cap.
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 25; i++) {
      db.prepare(
        "INSERT INTO referral_uses (id, referrer_id, referred_id, status, unlocked_at) VALUES (?, 'referrer', ?, 'unlocked', ?)",
      ).bind(`seed${i}`, `seed_referred${i}`, now).run();
    }
    db.applySchema("INSERT INTO coin_purchases (id, user_id, status, amount) VALUES ('p1', 'newbie', 'success', 500);");
    await maybeUnlockReferral(env(), 'newbie');
    const r = await row('newbie');
    expect(r?.status).toBe('review');
    expect(r?.flagged).toBe(1);
    expect(r?.flag_reason).toBe('daily_cap');
    // Reward amounts frozen on the row but NOT credited.
    expect(r?.referrer_reward).toBe(100);
    expect(await coins('referrer')).toBe(0);
    expect(await coins('newbie')).toBe(0);
  });

  it('credits immediately with no hold when hold_days = 0', async () => {
    db.applySchema("UPDATE app_settings SET value = '0' WHERE key = 'referral_hold_days';");
    db.applySchema("INSERT INTO coin_purchases (id, user_id, status, amount) VALUES ('p1', 'newbie', 'success', 500);");
    await maybeUnlockReferral(env(), 'newbie');
    const r = await row('newbie');
    expect(r?.reward_state).toBe('released');
    expect(await coins('referrer')).toBe(100);
    expect(await held('referrer')).toBe(0); // nothing locked
  });

  it('does not double-credit on repeated triggers (idempotent unlock)', async () => {
    db.applySchema("INSERT INTO coin_purchases (id, user_id, status, amount) VALUES ('p1', 'newbie', 'success', 500);");
    await maybeUnlockReferral(env(), 'newbie');
    await maybeUnlockReferral(env(), 'newbie'); // second trigger — already unlocked
    expect(await coins('referrer')).toBe(100); // still just one payout
    expect(await coins('newbie')).toBe(50);
  });
});

// ─── releaseExpiredReferralHolds — cron hold release ─────────────────────────
describe('releaseExpiredReferralHolds', () => {
  beforeEach(() => {
    const now = Math.floor(Date.now() / 1000);
    db.applySchema(`
      INSERT INTO users (id, coins, coins_held) VALUES ('referrer', 200, 200);
      INSERT INTO referral_uses (id, referrer_id, referred_id, status, reward_state, referrer_reward, hold_until) VALUES
        ('due',    'referrer', 'a', 'unlocked', 'held', 100, ${now - 10}),
        ('notdue', 'referrer', 'b', 'unlocked', 'held', 100, ${now + 100000});
    `);
  });

  it('releases only holds whose window has elapsed and frees coins_held', async () => {
    await releaseExpiredReferralHolds(env());
    const due = await db.prepare("SELECT reward_state FROM referral_uses WHERE id = 'due'").first<{ reward_state: string }>();
    const notDue = await db.prepare("SELECT reward_state FROM referral_uses WHERE id = 'notdue'").first<{ reward_state: string }>();
    expect(due?.reward_state).toBe('released');
    expect(notDue?.reward_state).toBe('held');
    // Only the released 100 is freed; the still-held 100 stays locked.
    expect(await held('referrer')).toBe(100);
    expect(await coins('referrer')).toBe(200); // balance untouched — only lock freed
  });

  it('is idempotent — a second sweep changes nothing', async () => {
    await releaseExpiredReferralHolds(env());
    await releaseExpiredReferralHolds(env());
    expect(await held('referrer')).toBe(100);
  });
});

// ─── clawbackReferrals — reverse held rewards when a referred user is banned ──
describe('clawbackReferrals', () => {
  beforeEach(() => {
    db.applySchema(`
      INSERT INTO users (id, coins, coins_held) VALUES
        ('referrer', 100, 100),
        ('fraudster', 50, 0);
      INSERT INTO referral_uses (id, referrer_id, referred_id, status, reward_state, referrer_reward, new_user_reward) VALUES
        ('ru1', 'referrer', 'fraudster', 'unlocked', 'held', 100, 50);
    `);
  });

  it('reverses a still-held reward from both users and voids the row', async () => {
    await clawbackReferrals(env(), 'fraudster', 'ban');
    const r = await db.prepare("SELECT * FROM referral_uses WHERE id = 'ru1'").first<any>();
    expect(r?.reward_state).toBe('clawed_back');
    expect(r?.status).toBe('void');
    // Referrer: coins 100→0, coins_held 100→0. Referred: coins 50→0.
    expect(await coins('referrer')).toBe(0);
    expect(await held('referrer')).toBe(0);
    expect(await coins('fraudster')).toBe(0);
    // Reversal ledger row written.
    const adj = await db.prepare("SELECT amount FROM coin_transactions WHERE user_id = 'referrer' AND type = 'adjustment'").first<{ amount: number }>();
    expect(adj?.amount).toBe(-100);
  });

  it('leaves already-RELEASED rewards untouched (only held is clawed back)', async () => {
    db.applySchema("UPDATE referral_uses SET reward_state = 'released' WHERE id = 'ru1';");
    await clawbackReferrals(env(), 'fraudster', 'ban');
    const r = await db.prepare("SELECT reward_state, status FROM referral_uses WHERE id = 'ru1'").first<any>();
    expect(r?.reward_state).toBe('released'); // unchanged
    expect(r?.status).toBe('unlocked');
    expect(await coins('referrer')).toBe(100); // not reversed
  });

  it('is idempotent — a second clawback is a no-op', async () => {
    await clawbackReferrals(env(), 'fraudster', 'ban');
    await clawbackReferrals(env(), 'fraudster', 'ban');
    expect(await coins('referrer')).toBe(0);
    expect(await held('referrer')).toBe(0);
  });
});
