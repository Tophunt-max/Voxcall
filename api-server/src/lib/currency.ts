// Server-side currency mapping & conversion.
//
// Coin plan prices are authored in INR by default (coin_plans.currency
// defaults to 'INR' for this India-first product). When responding to
// /api/coins/plans we look up the user's currency (set at register/login from
// the Cloudflare CF-IPCountry header) and return the localized amount so the
// client can format with the right symbol without doing FX itself.
//
// The exchange rates are intentionally hardcoded — the variance over weeks
// is small enough that a manual quarterly bump is fine, and we avoid pulling
// in a paid live-rates API on the hot path. If the volatility ever matters
// (e.g. for Argentine peso), wire in a daily cache-warmed fetch later.

// ─── ISO 3166-1 alpha-2 → ISO 4217 ────────────────────────────────────────
export const COUNTRY_TO_CURRENCY: Record<string, string> = {
  IN: 'INR',
  US: 'USD',
  GB: 'GBP',
  // Eurozone — list explicitly so we don't accidentally include non-€ EU members
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR',
  PT: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR',
  EE: 'EUR', LT: 'EUR', LV: 'EUR', CY: 'EUR', MT: 'EUR', HR: 'EUR',
  // Gulf
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR',
  // East Asia
  SG: 'SGD', HK: 'HKD', JP: 'JPY', CN: 'CNY', KR: 'KRW', TW: 'TWD',
  // SE Asia
  MY: 'MYR', TH: 'THB', ID: 'IDR', PH: 'PHP', VN: 'VND',
  // South Asia
  BD: 'BDT', NP: 'NPR', LK: 'LKR', PK: 'PKR',
  // Oceania
  AU: 'AUD', NZ: 'NZD',
  // Africa
  ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS', EG: 'EGP',
  // Latin America
  BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  // Other Europe (non-€)
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK',
  HU: 'HUF', RO: 'RON', BG: 'BGN',
  // Misc
  TR: 'TRY', IL: 'ILS', RU: 'RUB', UA: 'UAH', CA: 'CAD',
};

// ─── USD → foreign currency (1 USD = X units of foreign) ──────────────────
// Last refreshed: see migration 0023 commit. Bump quarterly if rates drift.
export const USD_TO_FOREIGN: Record<string, number> = {
  USD: 1,
  INR: 83,
  EUR: 0.92,
  GBP: 0.79,
  AED: 3.67, SAR: 3.75, QAR: 3.64, KWD: 0.31, BHD: 0.38, OMR: 0.39,
  SGD: 1.34, HKD: 7.83, JPY: 152, CNY: 7.28, KRW: 1340, TWD: 32,
  MYR: 4.49, THB: 36.1, IDR: 16000, PHP: 56.1, VND: 24400,
  BDT: 110, NPR: 133, LKR: 297, PKR: 277,
  AUD: 1.54, NZD: 1.66,
  ZAR: 18.5, NGN: 1500, KES: 130, GHS: 15, EGP: 49,
  BRL: 5.05, MXN: 17.3, ARS: 1000, CLP: 950, COP: 4000, PEN: 3.7,
  CHF: 0.88, SEK: 10.6, NOK: 10.7, DKK: 6.85, PLN: 3.98,
  CZK: 22.7, HUF: 360, RON: 4.58, BGN: 1.8,
  TRY: 33.6, ILS: 3.65, RUB: 95, UAH: 41, CAD: 1.36,
};

/**
 * Resolve a currency code from a country code. Falls back to INR when the
 * country is unknown or null because Voxcall is an India-first app and all
 * internal/default pricing is authored in rupees.
 */
export function currencyForCountry(country: string | null | undefined): string {
  if (!country) return 'INR';
  return COUNTRY_TO_CURRENCY[country.toUpperCase()] ?? 'INR';
}

/**
 * Convert a USD amount to the target currency. Returns the original number
 * unchanged for USD so we never introduce floating-point noise on prices
 * that were already authored in USD.
 *
 * `overrides` (optional) lets callers pass live/cached rates (e.g. the cron-
 * refreshed `fx_rates_usd` blob from app_settings — see FIX #12) which take
 * precedence over the static fallback table below.
 */
export function convertFromUSD(
  usdAmount: number,
  toCurrency: string,
  overrides?: Record<string, number> | null,
): number {
  if (toCurrency === 'USD') return usdAmount;
  const rate = (overrides && overrides[toCurrency]) || USD_TO_FOREIGN[toCurrency];
  if (!rate) return usdAmount; // Unknown currency — return original; client will format with USD symbol
  return usdAmount * rate;
}

/**
 * Convert an amount between any two supported currencies, routing through USD.
 *
 *   fromCurrency → USD → toCurrency
 *
 * Coin plan prices are authored in the plan's own `currency` (INR for this
 * India-first product). When a user on a DIFFERENT currency views the plans we
 * convert here. Same-currency is returned unchanged (no FP noise). Unknown
 * currencies return the original amount so the response shape is always valid.
 *
 * `overrides` (optional) supplies live/cached USD-base rates (the cron-refreshed
 * `fx_rates_usd` blob) which take precedence over the static fallback table.
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  overrides?: Record<string, number> | null,
): number {
  if (!Number.isFinite(amount)) return 0;
  const from = (fromCurrency || 'USD').toUpperCase();
  const to = (toCurrency || 'USD').toUpperCase();
  if (from === to) return amount;
  const rateFrom = (overrides && overrides[from]) || USD_TO_FOREIGN[from];
  const rateTo = (overrides && overrides[to]) || USD_TO_FOREIGN[to];
  if (!rateFrom || !rateTo) return amount; // unknown currency — leave as-is
  // amount is in `from` units → USD → `to` units.
  const usd = amount / rateFrom;
  return usd * rateTo;
}

/**
 * Read the country code from the incoming request. Tries the Cloudflare cf
 * object first (most reliable in production), falls back to the CF-IPCountry
 * header (also works in wrangler dev with --remote flag). Returns null when
 * neither is present (local dev without --remote, tests, etc).
 */
export function detectCountryFromRequest(req: Request): string | null {
  // The `cf` property is added by the Cloudflare runtime — typed loosely so we
  // don't depend on the @cloudflare/workers-types `cf` shape here.
  const cfCountry = (req as any).cf?.country as string | undefined;
  if (cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1') return cfCountry;
  // Header fallback. CF sets this for every request in production.
  const headerCountry = req.headers.get('CF-IPCountry');
  if (headerCountry && headerCountry !== 'XX' && headerCountry !== 'T1') return headerCountry;
  return null;
}
