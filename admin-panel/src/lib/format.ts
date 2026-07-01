// ============================================================================
// Display formatters for money / coins / dates
// ============================================================================
//
// These were previously inlined (and re-implemented slightly differently) in
// every finance page — e.g. `(x || 0).toLocaleString()`, `₹${(x||0).toFixed(2)}`,
// `new Date(ts*1000).toLocaleDateString()`. That inconsistency is risky for an
// admin panel where these numbers drive real payout decisions: a stray `null`
// or `NaN` would render "NaN"/"undefined" next to a Mark-Paid button.
//
// Centralizing them guarantees every screen treats missing/garbage values the
// same safe way, and makes the formatting unit-testable (see format.test.ts).
// ============================================================================

/** Coerce to a finite number, falling back to 0 for null/undefined/NaN. */
function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Thousands-separated coin count. Null/NaN-safe (renders "0"). */
export function formatCoins(value: number | null | undefined): string {
  return toFiniteNumber(value).toLocaleString();
}

/** A money amount with exactly 2 decimals, no currency symbol ("1234.50"). */
export function formatAmount(value: number | null | undefined): string {
  return toFiniteNumber(value).toFixed(2);
}

/** An INR amount with the rupee symbol ("₹1234.50"). Null/NaN-safe. */
export function formatInr(value: number | null | undefined): string {
  return `₹${formatAmount(value)}`;
}

/** Symbols for the currencies hosts can be paid in (mirror of the apps). */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', INR: '₹', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', SGD: 'S$',
  AED: 'AED ', SAR: 'SAR ', QAR: 'QAR ', KWD: 'KD ', BHD: 'BD ', OMR: 'OMR ',
  MYR: 'RM', HKD: 'HK$', JPY: '¥', CNY: '¥', KRW: '₩', THB: '฿', IDR: 'Rp',
  PHP: '₱', VND: '₫', BDT: '৳', NPR: 'Rs', LKR: 'Rs', PKR: 'Rs', ZAR: 'R',
  NGN: '₦', BRL: 'R$', MXN: 'MX$', TRY: '₺', RUB: '₽',
};
// Currencies whose smallest unit is whole — displayed with no decimals.
const NO_DECIMAL_CURRENCIES = ['INR', 'JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ARS', 'COP', 'HUF'];

/**
 * Format a money amount in the given currency with the right symbol + rounding.
 * Used for host payouts, which can be in INR (default) or an international
 * host's own currency. Null/NaN-safe, unknown currency falls back to a code prefix.
 */
export function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  const c = (currency || 'INR').toUpperCase();
  const symbol = CURRENCY_SYMBOLS[c] ?? `${c} `;
  const amt = toFiniteNumber(value);
  if (NO_DECIMAL_CURRENCIES.includes(c)) return `${symbol}${Math.round(amt).toLocaleString()}`;
  return `${symbol}${amt.toFixed(2)}`;
}

/**
 * Sum a numeric field across rows, ignoring missing/non-numeric entries.
 * Safe against null/undefined row arrays. Used for the payout/withdrawal
 * StatCard totals.
 */
export function sumBy<T>(rows: T[] | null | undefined, key: keyof T): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce<number>((acc, row) => acc + toFiniteNumber(row?.[key]), 0);
}

/**
 * Format a Unix-seconds timestamp as a locale date, or an em dash when the
 * value is absent/zero. Mirrors the `ts ? new Date(ts*1000)... : '—'` pattern
 * used across the finance tables.
 */
export function formatUnixDate(tsSeconds: number | null | undefined): string {
  if (!tsSeconds) return '—';
  const d = new Date(tsSeconds * 1000);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

/** Like formatUnixDate but includes the time component. */
export function formatUnixDateTime(tsSeconds: number | null | undefined): string {
  if (!tsSeconds) return '—';
  const d = new Date(tsSeconds * 1000);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
