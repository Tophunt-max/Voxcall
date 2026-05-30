import { describe, it, expect } from 'vitest';
import {
  formatCoins,
  formatAmount,
  formatInr,
  sumBy,
  formatUnixDate,
  formatUnixDateTime,
} from './format';

describe('formatCoins', () => {
  it('passes finite numbers through toLocaleString', () => {
    expect(formatCoins(1234)).toBe((1234).toLocaleString());
    expect(formatCoins(0)).toBe('0');
  });

  it('renders 0 for missing / non-numeric values (never "NaN"/"undefined")', () => {
    expect(formatCoins(null)).toBe('0');
    expect(formatCoins(undefined)).toBe('0');
    expect(formatCoins(Number.NaN)).toBe('0');
  });
});

describe('formatAmount — 2dp, no symbol', () => {
  it('always shows two decimals', () => {
    expect(formatAmount(1234.5)).toBe('1234.50');
    expect(formatAmount(10)).toBe('10.00');
  });

  it('is null/NaN-safe', () => {
    expect(formatAmount(null)).toBe('0.00');
    expect(formatAmount(undefined)).toBe('0.00');
    expect(formatAmount(Number.NaN)).toBe('0.00');
  });
});

describe('formatInr — rupee symbol + 2dp', () => {
  it('prefixes the rupee symbol', () => {
    expect(formatInr(1234.5)).toBe('₹1234.50');
    expect(formatInr(0)).toBe('₹0.00');
  });

  it('is null/NaN-safe', () => {
    expect(formatInr(null)).toBe('₹0.00');
    expect(formatInr(undefined)).toBe('₹0.00');
  });
});

describe('sumBy', () => {
  it('sums a numeric field, ignoring missing/garbage entries', () => {
    const rows = [{ amt: 10 }, { amt: 5.5 }, { amt: null }, { amt: undefined }, {}];
    expect(sumBy(rows as any, 'amt')).toBe(15.5);
  });

  it('returns 0 for a non-array input', () => {
    expect(sumBy(null, 'amt' as never)).toBe(0);
    expect(sumBy(undefined, 'amt' as never)).toBe(0);
    expect(sumBy([], 'amt' as never)).toBe(0);
  });
});

describe('formatUnixDate / formatUnixDateTime', () => {
  it('renders an em dash for absent timestamps', () => {
    expect(formatUnixDate(null)).toBe('—');
    expect(formatUnixDate(undefined)).toBe('—');
    expect(formatUnixDate(0)).toBe('—');
    expect(formatUnixDateTime(null)).toBe('—');
  });

  it('formats a real timestamp (locale-agnostic equality with the same API)', () => {
    const ts = 1_700_000_000; // seconds
    expect(formatUnixDate(ts)).toBe(new Date(ts * 1000).toLocaleDateString());
    expect(formatUnixDateTime(ts)).toBe(new Date(ts * 1000).toLocaleString());
    expect(formatUnixDate(ts)).not.toBe('—');
  });
});
