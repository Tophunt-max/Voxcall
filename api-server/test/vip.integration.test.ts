import { describe, it, expect, beforeEach } from 'vitest';
import { getVipStatus, applyVipCallDiscount, NO_VIP } from '../src/lib/vip';
import { createTestDb, type FakeD1 } from './helpers/d1';

// Exercises the REAL SQL that resolves a user's live VIP perks (users ⋈
// vip_plans on the stored tier) against an actual SQLite engine. This is the
// single source of truth for "what does this subscriber actually get", so it
// must (a) hand a subscriber EVERY perk their plan defines, (b) reflect admin
// plan edits immediately (perks are read live, not snapshotted at purchase),
// and (c) fail closed to NO_VIP the instant the membership lapses.

let db: FakeD1;

const SCHEMA = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    vip_tier TEXT,
    vip_expires_at INTEGER
  );
  CREATE TABLE vip_plans (
    tier TEXT PRIMARY KEY,
    name TEXT,
    call_discount_pct INTEGER DEFAULT 0,
    daily_bonus_coins INTEGER DEFAULT 0,
    chat_unlock INTEGER DEFAULT 0,
    priority_matching INTEGER DEFAULT 0,
    priority_support INTEGER DEFAULT 0,
    profile_frame INTEGER DEFAULT 0,
    badge TEXT,
    color TEXT
  );
`;

const future = () => Math.floor(Date.now() / 1000) + 30 * 86400;
const past = () => Math.floor(Date.now() / 1000) - 3600;

beforeEach(() => {
  db = createTestDb();
  db.applySchema(SCHEMA);
});

describe('getVipStatus', () => {
  it('hands an active subscriber every perk their plan defines', async () => {
    db.applySchema(`
      INSERT INTO vip_plans (tier, name, call_discount_pct, daily_bonus_coins, chat_unlock, priority_matching, priority_support, profile_frame, badge, color)
        VALUES ('gold', 'Gold', 20, 50, 1, 1, 1, 1, '👑', '#FFD700');
      INSERT INTO users (id, vip_tier, vip_expires_at) VALUES ('u1', 'gold', ${future()});
    `);
    const s = await getVipStatus(db as any, 'u1');
    expect(s.isVip).toBe(true);
    expect(s.tier).toBe('gold');
    expect(s.planName).toBe('Gold');
    expect(s.callDiscountPct).toBe(20);
    expect(s.dailyBonusCoins).toBe(50);
    expect(s.chatUnlock).toBe(true);
    expect(s.priorityMatching).toBe(true);
    expect(s.prioritySupport).toBe(true);
    expect(s.profileFrame).toBe(true);
    expect(s.badge).toBe('👑');
    expect(s.color).toBe('#FFD700');
  });

  it('reflects admin plan edits immediately (perks read live, not snapshotted)', async () => {
    db.applySchema(`
      INSERT INTO vip_plans (tier, name, call_discount_pct, priority_support) VALUES ('silver', 'Silver', 10, 0);
      INSERT INTO users (id, vip_tier, vip_expires_at) VALUES ('u1', 'silver', ${future()});
    `);
    expect((await getVipStatus(db as any, 'u1')).callDiscountPct).toBe(10);
    expect((await getVipStatus(db as any, 'u1')).prioritySupport).toBe(false);

    // Admin bumps the discount and turns on priority support.
    db.applySchema("UPDATE vip_plans SET call_discount_pct = 35, priority_support = 1 WHERE tier = 'silver';");
    const after = await getVipStatus(db as any, 'u1');
    expect(after.callDiscountPct).toBe(35); // same subscriber, new perks — no re-purchase
    expect(after.prioritySupport).toBe(true);
  });

  it('returns NO_VIP the moment the membership expires', async () => {
    db.applySchema(`
      INSERT INTO vip_plans (tier, name, call_discount_pct) VALUES ('gold', 'Gold', 20);
      INSERT INTO users (id, vip_tier, vip_expires_at) VALUES ('u1', 'gold', ${past()});
    `);
    expect(await getVipStatus(db as any, 'u1')).toEqual(NO_VIP);
  });

  it('returns NO_VIP for a user who never subscribed', async () => {
    db.applySchema("INSERT INTO users (id, vip_tier, vip_expires_at) VALUES ('u1', NULL, NULL);");
    expect(await getVipStatus(db as any, 'u1')).toEqual(NO_VIP);
  });

  it('clamps an out-of-range admin discount to the safe 0–90 band', async () => {
    db.applySchema(`
      INSERT INTO vip_plans (tier, name, call_discount_pct) VALUES ('gold', 'Gold', 150);
      INSERT INTO users (id, vip_tier, vip_expires_at) VALUES ('u1', 'gold', ${future()});
    `);
    expect((await getVipStatus(db as any, 'u1')).callDiscountPct).toBe(90); // never a free/negative call
  });

  it('defaults chat_unlock to true when the plan leaves it NULL', async () => {
    db.applySchema(`
      INSERT INTO vip_plans (tier, name, chat_unlock) VALUES ('gold', 'Gold', NULL);
      INSERT INTO users (id, vip_tier, vip_expires_at) VALUES ('u1', 'gold', ${future()});
    `);
    expect((await getVipStatus(db as any, 'u1')).chatUnlock).toBe(true);
  });

  it('is active but perk-less when the tier has no matching plan row (orphan tier)', async () => {
    // Membership is paid (future expiry) but the plan was deleted — fail safe:
    // still VIP, but every perk defaults off rather than throwing.
    db.applySchema(`INSERT INTO users (id, vip_tier, vip_expires_at) VALUES ('u1', 'ghost', ${future()});`);
    const s = await getVipStatus(db as any, 'u1');
    expect(s.isVip).toBe(true);
    expect(s.planName).toBeNull();
    expect(s.callDiscountPct).toBe(0);
    expect(s.priorityMatching).toBe(false);
  });

  it('never throws on a missing schema — resolves to NO_VIP', async () => {
    const bare = createTestDb(); // no tables at all
    expect(await getVipStatus(bare as any, 'nobody')).toEqual(NO_VIP);
  });
});

describe('applyVipCallDiscount', () => {
  it('returns the base rate (clamped to the floor) when there is no discount', () => {
    expect(applyVipCallDiscount(20, 0, 5)).toBe(20);
    expect(applyVipCallDiscount(3, 0, 5)).toBe(5); // base below floor → floor
  });

  it('applies and rounds the discount', () => {
    expect(applyVipCallDiscount(20, 20, 5)).toBe(16); // 20 * 0.8
    expect(applyVipCallDiscount(25, 15, 5)).toBe(21); // round(21.25)
  });

  it('never drops below the loss-proof floor even at a steep discount', () => {
    expect(applyVipCallDiscount(20, 90, 5)).toBe(5); // 20*0.1=2 → floored to 5
  });
});
