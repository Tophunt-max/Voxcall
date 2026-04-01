import * as Localization from "expo-localization";

const INR_PER_FOREIGN: Record<string, number> = {
  INR: 1,
  USD: 83,
  EUR: 90,
  GBP: 105,
  AED: 22.6,
  SAR: 22.1,
  QAR: 22.8,
  KWD: 270,
  BHD: 220,
  OMR: 216,
  SGD: 62,
  AUD: 54,
  CAD: 61,
  NZD: 50,
  MYR: 18.5,
  HKD: 10.6,
  JPY: 0.55,
  CNY: 11.4,
  KRW: 0.062,
  THB: 2.3,
  IDR: 0.0052,
  PHP: 1.48,
  VND: 0.0034,
  BDT: 0.76,
  NPR: 0.62,
  LKR: 0.28,
  PKR: 0.30,
  ZAR: 4.5,
  NGN: 0.055,
  KES: 0.64,
  GHS: 5.5,
  EGP: 1.7,
  TRY: 2.5,
  BRL: 16.5,
  MXN: 4.8,
  ARG: 0.10,
  CHF: 94,
  SEK: 7.8,
  NOK: 7.8,
  DKK: 12.1,
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED ",
  SAR: "SAR ",
  QAR: "QAR ",
  KWD: "KD ",
  BHD: "BD ",
  OMR: "OMR ",
  SGD: "S$",
  AUD: "A$",
  CAD: "C$",
  NZD: "NZ$",
  MYR: "RM",
  HKD: "HK$",
  JPY: "¥",
  CNY: "¥",
  KRW: "₩",
  THB: "฿",
  IDR: "Rp",
  PHP: "₱",
  VND: "₫",
  BDT: "৳",
  NPR: "Rs",
  LKR: "Rs",
  PKR: "Rs",
  ZAR: "R",
  NGN: "₦",
  KES: "KSh",
  GHS: "₵",
  EGP: "E£",
  TRY: "₺",
  BRL: "R$",
  MXN: "MX$",
  ARG: "ARS ",
  CHF: "Fr",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
};

const REGION_TO_CURRENCY: Record<string, string> = {
  IN: "INR",
  US: "USD",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  IE: "EUR",
  FI: "EUR",
  GR: "EUR",
  AE: "AED",
  SA: "SAR",
  QA: "QAR",
  KW: "KWD",
  BH: "BHD",
  OM: "OMR",
  SG: "SGD",
  AU: "AUD",
  CA: "CAD",
  NZ: "NZD",
  MY: "MYR",
  HK: "HKD",
  JP: "JPY",
  CN: "CNY",
  KR: "KRW",
  TH: "THB",
  ID: "IDR",
  PH: "PHP",
  VN: "VND",
  BD: "BDT",
  NP: "NPR",
  LK: "LKR",
  PK: "PKR",
  ZA: "ZAR",
  NG: "NGN",
  KE: "KES",
  GH: "GHS",
  EG: "EGP",
  TR: "TRY",
  BR: "BRL",
  MX: "MXN",
  AR: "ARG",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
};

let _cachedCurrency: string | null = null;

export function detectCurrency(): string {
  if (_cachedCurrency) return _cachedCurrency;
  try {
    const locales = Localization.getLocales();
    const region = locales[0]?.regionCode;
    if (region && REGION_TO_CURRENCY[region]) {
      _cachedCurrency = REGION_TO_CURRENCY[region];
      return _cachedCurrency;
    }
    const languageTag = locales[0]?.languageTag ?? "";
    const parts = languageTag.split("-");
    const tag = parts[parts.length - 1]?.toUpperCase();
    if (tag && REGION_TO_CURRENCY[tag]) {
      _cachedCurrency = REGION_TO_CURRENCY[tag];
      return _cachedCurrency;
    }
  } catch {}
  _cachedCurrency = "INR";
  return "INR";
}

export function convertFromINR(inrAmount: number, toCurrency: string): number {
  const rate = INR_PER_FOREIGN[toCurrency] ?? 1;
  return inrAmount / rate;
}

export function formatPrice(inrAmount: number, overrideCurrency?: string): string {
  const currency = overrideCurrency ?? detectCurrency();
  const converted = convertFromINR(inrAmount, currency);
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + " ";

  if (currency === "INR" || ["JPY", "KRW", "VND", "IDR"].includes(currency)) {
    return `${symbol}${Math.round(converted).toLocaleString()}`;
  }
  return `${symbol}${converted.toFixed(2)}`;
}

export function getCurrencySymbol(overrideCurrency?: string): string {
  const currency = overrideCurrency ?? detectCurrency();
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

export function getCurrencyCode(): string {
  return detectCurrency();
}
