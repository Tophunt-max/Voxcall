import { describe, it, expect } from 'vitest';
import { evaluatePromo } from '../src/routes/payment';

// Regression coverage for the promo eligibility rules used by
// /api/payment/initiate. The bug this guards: /initiate previously only
// checked `active = 1` and ignored expires_at + max_uses, so an expired or
// fully-redeemed promo still granted its bonus/discount through the gateway
// checkout flow (inconsistent with /api/coins/*). evaluatePromo is the shared
// chokepoint that enforces all three conditions.

const NOW = 1_700_000_000; // fixed reference time (unix seconds)

describe('evaluatePromo', () => {
  it('returns zeros for a missing promo', () => {
    expect(evaluatePromo(null, 100, NOW)).toEqual({ bonus: 0, discount: 0 });
    expect(evaluatePromo(undefined, 100, NOW)).toEqual({ bonus: 0, discount: 0 });
  });

  it('grants bonus coins for a valid bonus promo', () => {
    const promo = { type: 'bonus', bonus_coins: 50, max_uses: 10, used_count: 0, expires_at: NOW + 3600, active: 1 };
    expect(evaluatePromo(promo, 100, NOW)).toEqual({ bonus: 50, discount: 0 });
  });

  it('grants a percentage discount for a valid percent promo (rounded)', () => {
    const promo = { type: 'percent', discount_pct: 15, expires_at: null, active: 1 };
    // 15% of 99 = 14.85 → rounds to 15
    expect(evaluatePromo(promo, 99, NOW)).toEqual({ bonus: 0, discount: 15 });
  });

  it('does NOT grant a bonus once the promo has expired', () => {
    const promo = { type: 'bonus', bonus_coins: 50, expires_at: NOW - 1, active: 1 };
    expect(evaluatePromo(promo, 100, NOW)).toEqual({ bonus: 0, discount: 0 });
  });

  it('does NOT grant a discount once the promo has expired', () => {
    const promo = { type: 'percent', discount_pct: 20, expires_at: NOW - 1, active: 1 };
    expect(evaluatePromo(promo, 100, NOW)).toEqual({ bonus: 0, discount: 0 });
  });

  it('does NOT grant a bonus once max_uses is reached', () => {
    const promo = { type: 'bonus', bonus_coins: 50, max_uses: 5, used_count: 5, expires_at: null, active: 1 };
    expect(evaluatePromo(promo, 100, NOW)).toEqual({ bonus: 0, discount: 0 });
  });

  it('still grants while usage remains below the cap', () => {
    const promo = { type: 'bonus', bonus_coins: 50, max_uses: 5, used_count: 4, expires_at: null, active: 1 };
    expect(evaluatePromo(promo, 100, NOW)).toEqual({ bonus: 50, discount: 0 });
  });

  it('treats max_uses=null as unlimited', () => {
    const promo = { type: 'bonus', bonus_coins: 25, max_uses: null, used_count: 9999, expires_at: null, active: 1 };
    expect(evaluatePromo(promo, 100, NOW)).toEqual({ bonus: 25, discount: 0 });
  });

  it('returns zeros for an inactive promo', () => {
    const promo = { type: 'bonus', bonus_coins: 50, active: 0 };
    expect(evaluatePromo(promo, 100, NOW)).toEqual({ bonus: 0, discount: 0 });
  });

  it('returns zeros for an unknown promo type', () => {
    const promo = { type: 'mystery', bonus_coins: 50, discount_pct: 50, active: 1 };
    expect(evaluatePromo(promo, 100, NOW)).toEqual({ bonus: 0, discount: 0 });
  });
});



import { validatePromoInput } from '../src/routes/payment';

// Guards the admin promo-code create/update endpoints. The bug this prevents:
// previously POST/PATCH /api/admin/promo-codes had NO validation, so an admin
// could persist a "500% off" or negative-bonus code that flows into the
// coin-credit money path.
describe('validatePromoInput', () => {
  it('accepts a valid percent promo on create', () => {
    expect(validatePromoInput({ code: 'SAVE20', type: 'percent', discount_pct: 20 }, { create: true })).toEqual({ ok: true });
  });

  it('accepts a valid bonus promo on create', () => {
    expect(validatePromoInput({ code: 'WELCOME', type: 'bonus', bonus_coins: 50 }, { create: true })).toEqual({ ok: true });
  });

  it('defaults type to percent on create (requires discount_pct)', () => {
    expect(validatePromoInput({ code: 'X', discount_pct: 10 }, { create: true })).toEqual({ ok: true });
    expect(validatePromoInput({ code: 'X' }, { create: true }).ok).toBe(false);
  });

  it('requires a code on create', () => {
    expect(validatePromoInput({ type: 'percent', discount_pct: 10 }, { create: true }).ok).toBe(false);
    expect(validatePromoInput({ code: '   ', discount_pct: 10 }, { create: true }).ok).toBe(false);
  });

  it('rejects a discount above 100% (the "500% off" bug)', () => {
    expect(validatePromoInput({ code: 'X', type: 'percent', discount_pct: 500 }, { create: true }).ok).toBe(false);
    expect(validatePromoInput({ discount_pct: 0 }).ok).toBe(false);
    expect(validatePromoInput({ discount_pct: -5 }).ok).toBe(false);
  });

  it('rejects a negative or non-integer bonus (the "deduct coins" bug)', () => {
    expect(validatePromoInput({ code: 'X', type: 'bonus', bonus_coins: -100 }, { create: true }).ok).toBe(false);
    expect(validatePromoInput({ bonus_coins: 1.5 }).ok).toBe(false);
    expect(validatePromoInput({ bonus_coins: 0 }).ok).toBe(false);
  });

  it('rejects a non-positive max_uses but allows null (unlimited)', () => {
    expect(validatePromoInput({ max_uses: 0 }).ok).toBe(false);
    expect(validatePromoInput({ max_uses: -1 }).ok).toBe(false);
    expect(validatePromoInput({ max_uses: null }).ok).toBe(true);
    expect(validatePromoInput({ max_uses: 100 }).ok).toBe(true);
  });

  it('rejects an unknown promo type', () => {
    expect(validatePromoInput({ code: 'X', type: 'mystery', discount_pct: 10 }, { create: true }).ok).toBe(false);
  });

  it('rejects an invalid expires_at but allows null', () => {
    expect(validatePromoInput({ expires_at: 0 }).ok).toBe(false);
    expect(validatePromoInput({ expires_at: -1 }).ok).toBe(false);
    expect(validatePromoInput({ expires_at: null }).ok).toBe(true);
    expect(validatePromoInput({ expires_at: 1_900_000_000 }).ok).toBe(true);
  });

  it('allows a partial update with only one field (no create requirements)', () => {
    expect(validatePromoInput({ active: 1 })).toEqual({ ok: true });
    expect(validatePromoInput({ discount_pct: 30 })).toEqual({ ok: true });
  });
});
