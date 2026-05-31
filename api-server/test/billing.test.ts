import { describe, it, expect } from 'vitest';
import { billedMinutes, coinsForCall, hostShareOf, affordableCoins } from '../src/lib/billing';

describe('billedMinutes — minutes are rounded UP, any started minute is billed', () => {
  it('bills 0 for non-positive / invalid durations', () => {
    expect(billedMinutes(0)).toBe(0);
    expect(billedMinutes(-30)).toBe(0);
    expect(billedMinutes(Number.NaN)).toBe(0);
    expect(billedMinutes(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('rounds any partial minute up to the next whole minute', () => {
    expect(billedMinutes(1)).toBe(1); // 1 second still bills a full minute
    expect(billedMinutes(30)).toBe(1);
    expect(billedMinutes(59)).toBe(1);
    expect(billedMinutes(60)).toBe(1); // exactly one minute
    expect(billedMinutes(61)).toBe(2); // one second over rolls to 2
    expect(billedMinutes(119)).toBe(2);
    expect(billedMinutes(120)).toBe(2);
    expect(billedMinutes(121)).toBe(3);
  });
});

describe('coinsForCall — only active calls with real duration cost coins', () => {
  it('charges nothing for a call that never connected (pending)', () => {
    expect(coinsForCall({ status: 'pending', durationSec: 120, ratePerMinute: 5 })).toBe(0);
    expect(coinsForCall({ status: 'ended', durationSec: 120, ratePerMinute: 5 })).toBe(0);
  });

  it('charges nothing when an active call had zero duration', () => {
    expect(coinsForCall({ status: 'active', durationSec: 0, ratePerMinute: 5 })).toBe(0);
  });

  it('charges billedMinutes * rate for an active call', () => {
    expect(coinsForCall({ status: 'active', durationSec: 60, ratePerMinute: 5 })).toBe(5);
    expect(coinsForCall({ status: 'active', durationSec: 90, ratePerMinute: 5 })).toBe(10); // 2 min * 5
    expect(coinsForCall({ status: 'active', durationSec: 61, ratePerMinute: 8 })).toBe(16); // 2 min * 8
  });

  it('treats a non-positive rate as free (defensive)', () => {
    expect(coinsForCall({ status: 'active', durationSec: 120, ratePerMinute: 0 })).toBe(0);
    expect(coinsForCall({ status: 'active', durationSec: 120, ratePerMinute: -5 })).toBe(0);
  });
});

describe('hostShareOf — host cut always rounds DOWN, never pays a coin not collected', () => {
  it('floors the share', () => {
    expect(hostShareOf(100, 0.7)).toBe(70);
    expect(hostShareOf(101, 0.7)).toBe(70); // 70.7 -> 70
    expect(hostShareOf(99, 0.72)).toBe(71); // 71.28 -> 71
  });

  it('returns 0 for no charge or no/zero share', () => {
    expect(hostShareOf(0, 0.8)).toBe(0);
    expect(hostShareOf(-50, 0.8)).toBe(0);
    expect(hostShareOf(100, 0)).toBe(0);
    expect(hostShareOf(100, Number.NaN)).toBe(0);
  });
});

describe('affordableCoins — partial billing caps the charge at the caller balance (FIX #1)', () => {
  it('charges the full amount when the caller can afford it', () => {
    expect(affordableCoins(50, 100)).toBe(50);
    expect(affordableCoins(100, 100)).toBe(100);
  });

  it('caps at the balance when the caller overran (so host still gets paid)', () => {
    expect(affordableCoins(300, 50)).toBe(50); // owed 300, only has 50
    expect(affordableCoins(10, 0)).toBe(0);
  });

  it('is defensive against invalid inputs', () => {
    expect(affordableCoins(0, 100)).toBe(0);
    expect(affordableCoins(-5, 100)).toBe(0);
    expect(affordableCoins(Number.NaN, 100)).toBe(0);
    expect(affordableCoins(100, -10)).toBe(0);
  });
});
