import { describe, it, expect } from 'vitest';
import {
  inrCoinValueToUsd,
  usdCoinValueToInr,
  getCoinValueInCurrency,
  formatCoinValueForAdmin,
  getCurrencySymbol,
  getSupportedCurrenciesWithRates,
} from '../src/lib/coinCurrency';

describe('inrCoinValueToUsd', () => {
  it('converts INR coin value to USD using the default rate', () => {
    // Default rate is 1/83 ≈ 0.01205
    const result = inrCoinValueToUsd(0.05);
    expect(result).toBeCloseTo(0.05 / 83, 8);
  });

  it('uses a custom INR-to-USD rate when provided', () => {
    const result = inrCoinValueToUsd(1, 0.012);
    expect(result).toBeCloseTo(0.012, 8);
  });

  it('returns 0 for a 0 INR value', () => {
    expect(inrCoinValueToUsd(0)).toBe(0);
  });
});

describe('usdCoinValueToInr', () => {
  it('converts USD coin value back to INR using the default rate', () => {
    const usd = 0.05 / 83;
    const result = usdCoinValueToInr(usd);
    expect(result).toBeCloseTo(0.05, 6);
  });

  it('uses a custom rate when provided', () => {
    const result = usdCoinValueToInr(0.012, 0.012);
    expect(result).toBeCloseTo(1, 6);
  });

  it('round-trips with inrCoinValueToUsd', () => {
    const inr = 0.20;
    const rate = 1 / 83;
    const usd = inrCoinValueToUsd(inr, rate);
    const backToInr = usdCoinValueToInr(usd, rate);
    expect(backToInr).toBeCloseTo(inr, 6);
  });
});

describe('getCoinValueInCurrency', () => {
  it('returns the USD rate directly when targetCurrency is USD', () => {
    expect(getCoinValueInCurrency(0.001, 'USD')).toBe(0.001);
  });

  it('multiplies by the FX rate for a known currency', () => {
    // INR rate is 83 in USD_TO_FOREIGN
    const result = getCoinValueInCurrency(0.001, 'INR');
    expect(result).toBeCloseTo(0.001 * 83, 6);
  });

  it('uses fxOverrides when provided for the target currency', () => {
    const result = getCoinValueInCurrency(0.001, 'INR', { INR: 85 });
    expect(result).toBeCloseTo(0.001 * 85, 6);
  });

  it('falls back to coinToUsdRate for unknown currencies', () => {
    expect(getCoinValueInCurrency(0.001, 'UNKNOWN')).toBe(0.001);
  });
});

describe('formatCoinValueForAdmin', () => {
  it('formats the coin value as INR with ₹ symbol and 4 decimal places', () => {
    // 1/83 USD → 1.0000 INR (approximately)
    const usdRate = 1 / 83;
    const result = formatCoinValueForAdmin(usdRate);
    expect(result).toBe('₹1.0000');
  });

  it('accepts a custom INR-to-USD rate', () => {
    const result = formatCoinValueForAdmin(0.01, 0.01);
    // 0.01 / 0.01 = 1
    expect(result).toBe('₹1.0000');
  });
});

describe('getCurrencySymbol', () => {
  it('returns the correct symbol for known currencies', () => {
    expect(getCurrencySymbol('INR')).toBe('₹');
    expect(getCurrencySymbol('USD')).toBe('$');
    expect(getCurrencySymbol('EUR')).toBe('€');
    expect(getCurrencySymbol('GBP')).toBe('£');
    expect(getCurrencySymbol('JPY')).toBe('¥');
    expect(getCurrencySymbol('AED')).toBe('د.إ');
  });

  it('returns the currency code itself for unknown currencies', () => {
    expect(getCurrencySymbol('XYZ')).toBe('XYZ');
    expect(getCurrencySymbol('UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('getSupportedCurrenciesWithRates', () => {
  it('returns an array of currency objects sorted by name', () => {
    const result = getSupportedCurrenciesWithRates();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    // Verify sorted by name
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].name.localeCompare(result[i].name)).toBeLessThanOrEqual(0);
    }
  });

  it('each entry has code, symbol, rate, and name', () => {
    const result = getSupportedCurrenciesWithRates();
    for (const entry of result) {
      expect(typeof entry.code).toBe('string');
      expect(typeof entry.symbol).toBe('string');
      expect(typeof entry.rate).toBe('number');
      expect(typeof entry.name).toBe('string');
      expect(entry.rate).toBeGreaterThan(0);
    }
  });

  it('excludes USD from the list', () => {
    const result = getSupportedCurrenciesWithRates();
    const usdEntry = result.find((e) => e.code === 'USD');
    expect(usdEntry).toBeUndefined();
  });

  it('uses fxOverrides when provided', () => {
    const base = getSupportedCurrenciesWithRates();
    const overridden = getSupportedCurrenciesWithRates({ GBP: 0.9 });
    const baseGBP = base.find((e) => e.code === 'GBP');
    const overGBP = overridden.find((e) => e.code === 'GBP');
    // With a different FX rate, the rate-relative-to-INR should differ
    expect(baseGBP).toBeDefined();
    expect(overGBP).toBeDefined();
    if (baseGBP && overGBP) {
      expect(overGBP.rate).not.toBeCloseTo(baseGBP.rate, 4);
    }
  });
});
