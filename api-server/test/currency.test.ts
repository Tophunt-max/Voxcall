import { describe, it, expect } from 'vitest';
import {
  currencyForCountry,
  convertFromUSD,
  detectCountryFromRequest,
} from '../src/lib/currency';

describe('currencyForCountry', () => {
  it('maps known countries to their ISO currency', () => {
    expect(currencyForCountry('IN')).toBe('INR');
    expect(currencyForCountry('US')).toBe('USD');
    expect(currencyForCountry('DE')).toBe('EUR');
    expect(currencyForCountry('AE')).toBe('AED');
  });

  it('is case-insensitive on the country code', () => {
    expect(currencyForCountry('in')).toBe('INR');
    expect(currencyForCountry('gb')).toBe('GBP');
  });

  it('falls back to USD for unknown / missing countries', () => {
    expect(currencyForCountry('ZZ')).toBe('USD');
    expect(currencyForCountry(null)).toBe('USD');
    expect(currencyForCountry(undefined)).toBe('USD');
    expect(currencyForCountry('')).toBe('USD');
  });
});

describe('convertFromUSD', () => {
  it('returns the amount unchanged for USD (no FX noise)', () => {
    expect(convertFromUSD(9.99, 'USD')).toBe(9.99);
  });

  it('applies the hardcoded rate for known currencies', () => {
    expect(convertFromUSD(10, 'INR')).toBe(830); // 10 * 83
    expect(convertFromUSD(1, 'GBP')).toBeCloseTo(0.79, 5);
  });

  it('returns the original amount for an unknown currency', () => {
    expect(convertFromUSD(10, 'ZZZ')).toBe(10);
  });
});

describe('detectCountryFromRequest', () => {
  it('reads the CF-IPCountry header', () => {
    const req = new Request('https://example.com', {
      headers: { 'CF-IPCountry': 'IN' },
    });
    expect(detectCountryFromRequest(req)).toBe('IN');
  });

  it('prefers the cf.country property when present', () => {
    const req = new Request('https://example.com', {
      headers: { 'CF-IPCountry': 'US' },
    });
    (req as any).cf = { country: 'DE' };
    expect(detectCountryFromRequest(req)).toBe('DE');
  });

  it('ignores placeholder/anonymous country codes', () => {
    expect(
      detectCountryFromRequest(
        new Request('https://example.com', { headers: { 'CF-IPCountry': 'XX' } }),
      ),
    ).toBeNull();
    expect(
      detectCountryFromRequest(
        new Request('https://example.com', { headers: { 'CF-IPCountry': 'T1' } }),
      ),
    ).toBeNull();
  });

  it('returns null when no country signal is available', () => {
    expect(detectCountryFromRequest(new Request('https://example.com'))).toBeNull();
  });
});
