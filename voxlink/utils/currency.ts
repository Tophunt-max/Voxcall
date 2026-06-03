// Client-side currency formatting.
//
// The server now authors default plan prices in INR and returns:
//   - users.country  (ISO 3166-1 alpha-2, set from CF-IPCountry at login)
//   - users.currency (ISO 4217, derived from country)
//   - coin_plans.price_local + coin_plans.currency on /api/coins/plans
//
// This module's job is purely cosmetic: take a USD amount and return a
// nicely-formatted local-currency string. We honor a user-selected currency
// (from auth context, hydrated from the server) before falling back to the
// device locale via expo-localization.
//
// INR remains the app default/base currency. Server-detected country currency
// still wins when available so international users see localized amounts.

import * as Localization from "expo-localization";

// 1 USD = X foreign-currency units. Bump quarterly if rates drift materially.
// Mirror of api-server/src/lib/currency.ts USD_TO_FOREIGN — keep them in sync.
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

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", INR: "₹", EUR: "€", GBP: "£",
  AED: "AED ", SAR: "SAR ", QAR: "QAR ", KWD: "KD ", BHD: "BD ", OMR: "OMR ",
  SGD: "S$", AUD: "A$", CAD: "C$", NZD: "NZ$",
  MYR: "RM", HKD: "HK$", JPY: "¥", CNY: "¥", KRW: "₩", TWD: "NT$",
  THB: "฿", IDR: "Rp", PHP: "₱", VND: "₫",
  BDT: "৳", NPR: "Rs", LKR: "Rs", PKR: "Rs",
  ZAR: "R", NGN: "₦", KES: "KSh", GHS: "₵", EGP: "E£",
  BRL: "R$", MXN: "MX$", ARS: "ARS ", CLP: "CLP ", COP: "COP ", PEN: "S/",
  CHF: "Fr", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł",
  CZK: "Kč", HUF: "Ft", RON: "lei", BGN: "лв",
  TRY: "₺", ILS: "₪", RUB: "₽", UAH: "₴",
};

const REGION_TO_CURRENCY: Record<string, string> = {
  IN: "INR", US: "USD", GB: "GBP",
  DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", BE: "EUR", AT: "EUR",
  PT: "EUR", IE: "EUR", FI: "EUR", GR: "EUR", LU: "EUR", SK: "EUR", SI: "EUR",
  EE: "EUR", LT: "EUR", LV: "EUR", CY: "EUR", MT: "EUR", HR: "EUR",
  AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", BH: "BHD", OM: "OMR",
  SG: "SGD", HK: "HKD", JP: "JPY", CN: "CNY", KR: "KRW", TW: "TWD",
  MY: "MYR", TH: "THB", ID: "IDR", PH: "PHP", VN: "VND",
  BD: "BDT", NP: "NPR", LK: "LKR", PK: "PKR",
  AU: "AUD", NZ: "NZD",
  ZA: "ZAR", NG: "NGN", KE: "KES", GH: "GHS", EG: "EGP",
  BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK",
  HU: "HUF", RO: "RON", BG: "BGN",
  TR: "TRY", IL: "ILS", RU: "RUB", UA: "UAH", CA: "CAD",
};

// Server-priority override. The auth context calls setServerCurrency() after
// login so every subsequent format call uses the same value the server used
// to localize coin_plans.price_local. Without this, the device locale could
// disagree with the server (VPN, traveler, etc.) and prices would jump
// between buy / confirmation screens.
let _serverCurrency: string | null = null;

export function setServerCurrency(currency: string | null | undefined): void {
  _serverCurrency = currency && USD_TO_FOREIGN[currency] ? currency : null;
}

// ─── Admin-controlled coin value (single source of truth) ──────────────────
// The money-worth of 1 coin in USD. The admin sets this once in the panel
// (app_settings.coin_to_usd_rate) and the apps fetch it via /api/app-config on
// launch, then call setCoinToUsdRate(). EVERY coins→money conversion in the app
// (coinsToLocalCurrency) reads this, so changing it in the admin panel updates
// the displayed value everywhere — no hardcoded coin price anywhere.
const DEFAULT_COIN_TO_USD = 0.01;
let _coinToUsdRate = DEFAULT_COIN_TO_USD;

/** Set the platform coin→USD value (from admin app_settings.coin_to_usd_rate). */
export function setCoinToUsdRate(rate: number | string | null | undefined): void {
  const n = typeof rate === "string" ? parseFloat(rate) : rate;
  if (typeof n === "number" && Number.isFinite(n) && n > 0) _coinToUsdRate = n;
}

/** The current platform coin→USD value (admin-set, defaults to 0.01). */
export function getCoinToUsdRate(): number {
  return _coinToUsdRate;
}

let _localeCurrency: string | null = null;
function detectFromLocale(): string {
  if (_localeCurrency) return _localeCurrency;
  try {
    const locales = Localization.getLocales();
    const region = locales[0]?.regionCode;
    if (region && REGION_TO_CURRENCY[region]) {
      _localeCurrency = REGION_TO_CURRENCY[region];
      return _localeCurrency;
    }
    // Fall back to languageTag's region suffix (e.g. "en-IN" → "IN")
    const tag = locales[0]?.languageTag ?? "";
    const suffix = tag.split("-").pop()?.toUpperCase();
    if (suffix && REGION_TO_CURRENCY[suffix]) {
      _localeCurrency = REGION_TO_CURRENCY[suffix];
      return _localeCurrency;
    }
  } catch { /* expo-localization may not be available on web */ }
  _localeCurrency = "INR";
  return "INR";
}

/**
 * Return the active currency code. Server-detected (via auth context) wins
 * over device locale so buy / checkout / receipt screens show consistent
 * values even on a VPN or traveling device.
 */
export function getCurrencyCode(): string {
  return _serverCurrency ?? detectFromLocale();
}

/**
 * Return the symbol for the active currency (or the optional override).
 */
export function getCurrencySymbol(overrideCurrency?: string): string {
  const c = overrideCurrency ?? getCurrencyCode();
  return CURRENCY_SYMBOLS[c] ?? `${c} `;
}

/**
 * Format a USD price as a localized string.
 * Source-of-truth note: the server already returns plan.price_local on
 * /api/coins/plans, so when displaying server-provided plans you should pass
 * `plan.price_local` with `plan.currency` (no FX needed). Use this helper
 * when the source amount is in USD (e.g. legacy plan.price, hardcoded values).
 */
export function formatPrice(usdAmount: number, overrideCurrency?: string): string {
  const currency = overrideCurrency ?? getCurrencyCode();
  const rate = USD_TO_FOREIGN[currency] ?? 1;
  const local = usdAmount * rate;
  return formatLocalAmount(local, currency);
}

/**
 * Format an already-localized amount with the right symbol + rounding.
 * Use this when the server has already converted (e.g. plan.price_local).
 */
export function formatLocalAmount(amount: number, currency?: string): string {
  const c = currency ?? getCurrencyCode();
  const symbol = CURRENCY_SYMBOLS[c] ?? `${c} `;
  // Currencies whose smallest unit is whole — no decimals
  const noDecimals = ["INR", "JPY", "KRW", "VND", "IDR", "CLP", "ARS", "COP", "HUF"];
  if (noDecimals.includes(c)) {
    return `${symbol}${Math.round(amount).toLocaleString()}`;
  }
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Convert in-app coins to a localized fiat string. Useful for showing host
 * earnings or "you'll receive ~₹X" hints. Uses the admin-controlled
 * platform coin → USD value (app_settings.coin_to_usd_rate), set once on
 * launch via setCoinToUsdRate(). Defaults to $0.01/coin until config loads.
 */
export function coinsToLocalCurrency(coins: number, currency?: string): string {
  const usd = coins * _coinToUsdRate;
  return formatPrice(usd, currency);
}

/**
 * Detect the user's currency. Kept for backward compatibility — new code
 * should use getCurrencyCode().
 */
export function detectCurrency(): string {
  return getCurrencyCode();
}
