import { describe, it, expect } from 'vitest';
import { selfReferralReason, referralOutcome, computeHold } from '../src/lib/referral';

describe('selfReferralReason', () => {
  it('flags same device', () => {
    expect(selfReferralReason({ deviceId: 'dev1' }, { deviceId: 'dev1' })).toBe('same_device');
  });

  it('flags same phone on last-10-digits (ignores country code)', () => {
    expect(selfReferralReason({ phone: '+91 98765 43210' }, { phone: '9876543210' })).toBe('same_phone');
    expect(selfReferralReason({ phone: '00919876543210' }, { phone: '+919876543210' })).toBe('same_phone');
  });

  it('returns null for distinct device + phone', () => {
    expect(selfReferralReason({ deviceId: 'a', phone: '9000000001' }, { deviceId: 'b', phone: '9000000002' })).toBeNull();
  });

  it('does not false-positive on missing/short data', () => {
    expect(selfReferralReason({}, {})).toBeNull();
    expect(selfReferralReason({ deviceId: null, phone: null }, { deviceId: null, phone: null })).toBeNull();
    // Too-short "phones" must never match (avoids empty-string collisions).
    expect(selfReferralReason({ phone: '123' }, { phone: '123' })).toBeNull();
    // Same device only counts when both are present.
    expect(selfReferralReason({ deviceId: '' }, { deviceId: '' })).toBeNull();
  });

  it('prioritizes device over phone reason', () => {
    expect(selfReferralReason({ deviceId: 'x', phone: '9000000001' }, { deviceId: 'x', phone: '9000000002' })).toBe('same_device');
  });
});

describe('referralOutcome', () => {
  const base = {
    selfReferral: false,
    genuine: true,
    integrityEnabled: true,
    dailyUnlockCount: 0,
    dailyCap: 25,
    totalUnlockCount: 0,
    totalCap: 0,
    riskTier: null as 'low' | 'medium' | 'high' | null,
  };

  it('voids a self-referral regardless of other signals', () => {
    expect(referralOutcome({ ...base, selfReferral: true, genuine: true }).action).toBe('void');
  });

  it('skips when not genuine yet', () => {
    expect(referralOutcome({ ...base, genuine: false }).action).toBe('skip');
  });

  it('credits a genuine referral within limits', () => {
    const r = referralOutcome(base);
    expect(r.action).toBe('credit');
    expect(r.reason).toBe('genuine');
  });

  it('sends to review at/over the daily cap', () => {
    expect(referralOutcome({ ...base, dailyUnlockCount: 25, dailyCap: 25 }).action).toBe('review');
    expect(referralOutcome({ ...base, dailyUnlockCount: 26, dailyCap: 25 }).action).toBe('review');
    expect(referralOutcome({ ...base, dailyUnlockCount: 24, dailyCap: 25 }).action).toBe('credit');
  });

  it('daily cap of 0 means unlimited (never reviews on volume)', () => {
    expect(referralOutcome({ ...base, dailyUnlockCount: 9999, dailyCap: 0 }).action).toBe('credit');
  });

  it('sends to review at/over the total cap', () => {
    expect(referralOutcome({ ...base, totalUnlockCount: 100, totalCap: 100 }).action).toBe('review');
    expect(referralOutcome({ ...base, totalUnlockCount: 99, totalCap: 100 }).action).toBe('credit');
  });

  it('sends high-risk referred accounts to review', () => {
    expect(referralOutcome({ ...base, riskTier: 'high' }).action).toBe('review');
    expect(referralOutcome({ ...base, riskTier: 'medium' }).action).toBe('credit');
    expect(referralOutcome({ ...base, riskTier: 'low' }).action).toBe('credit');
  });

  it('with integrity disabled, credits genuine referrals ignoring caps/risk', () => {
    expect(referralOutcome({ ...base, integrityEnabled: false, dailyUnlockCount: 999, dailyCap: 25, riskTier: 'high' }).action).toBe('credit');
  });

  it('self-referral takes precedence over not-genuine', () => {
    expect(referralOutcome({ ...base, selfReferral: true, genuine: false }).action).toBe('void');
  });
});

describe('computeHold', () => {
  const NOW = 1_700_000_000;

  it('holds for the configured number of days', () => {
    expect(computeHold(NOW, 7)).toEqual({ rewardState: 'held', holdUntil: NOW + 7 * 86400 });
    expect(computeHold(NOW, 1)).toEqual({ rewardState: 'held', holdUntil: NOW + 86400 });
  });

  it('releases immediately when hold is 0 or negative', () => {
    expect(computeHold(NOW, 0)).toEqual({ rewardState: 'released', holdUntil: NOW });
    expect(computeHold(NOW, -3)).toEqual({ rewardState: 'released', holdUntil: NOW });
  });

  it('floors fractional days and tolerates junk input', () => {
    expect(computeHold(NOW, 2.9)).toEqual({ rewardState: 'held', holdUntil: NOW + 2 * 86400 });
    expect(computeHold(NOW, NaN)).toEqual({ rewardState: 'released', holdUntil: NOW });
  });
});
