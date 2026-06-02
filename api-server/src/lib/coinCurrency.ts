// Multi-currency Coin Value System
// 
// Admin sets coin value in INR (₹) - the base currency for this India-first product
// Backend automatically converts to USD for storage and to user's currency on API calls
//
// Flow:
// 1. Admin sets: 1 coin = ₹0.05 INR
// 2. Backend stores: coin_to_usd_rate = 0.0006 (₹0.05 / 83 = $0.0006)
// 3. US user sees: 1 coin = $0.0006
// 4. UK user sees: 1 coin = £0.00047
// 5. UAE user sees: 1 coin = د.إ0.0022

import { USD_TO_FOREIGN, COUNTRY_TO_CURRENCY } from './currency';

// INR is the base currency for admin panel
export const BASE_CURRENCY = 'INR';

// Default INR to USD rate (will be updated from fx_rates_usd in app_settings)
const DEFAULT_INR_TO_USD = 1 / 83;

/**
 * Convert INR coin value to USD for storage
 * Admin enters: 1 coin = ₹0.05
 * We store: coin_to_usd_rate = 0.0006
 */
export function inrCoinValueToUsd(inrValue: number, inrToUsdRate?: number): number {
  const rate = inrToUsdRate || DEFAULT_INR_TO_USD;
  return inrValue * rate;
}

/**
 * Convert USD coin value to INR for admin display
 * Stored: coin_to_usd_rate = 0.0006
 * Admin sees: 1 coin = ₹0.05
 */
export function usdCoinValueToInr(usdValue: number, inrToUsdRate?: number): number {
  const rate = inrToUsdRate || DEFAULT_INR_TO_USD;
  return usdValue / rate;
}

/**
 * Get coin value in user's local currency
 * Used by /api/app-config and /api/coins/plans
 */
export function getCoinValueInCurrency(
  coinToUsdRate: number,
  targetCurrency: string,
  fxOverrides?: Record<string, number> | null
): number {
  if (targetCurrency === 'USD') return coinToUsdRate;
  
  const usdRate = (fxOverrides && fxOverrides[targetCurrency]) || USD_TO_FOREIGN[targetCurrency];
  if (!usdRate) return coinToUsdRate; // Unknown currency, return USD value
  
  return coinToUsdRate * usdRate;
}

/**
 * Format coin value for display in admin panel (always INR)
 */
export function formatCoinValueForAdmin(coinToUsdRate: number, inrToUsdRate?: number): string {
  const inrValue = usdCoinValueToInr(coinToUsdRate, inrToUsdRate);
  return `₹${inrValue.toFixed(4)}`;
}

/**
 * Get currency symbol for a currency code
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£',
    AED: 'د.إ',
    SAR: '﷼',
    SGD: 'S$',
    HKD: 'HK$',
    JPY: '¥',
    CNY: '¥',
    KRW: '₩',
    AUD: 'A$',
    CAD: 'C$',
    CHF: 'CHF',
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
    PLN: 'zł',
    TRY: '₺',
    RUB: '₽',
    BRL: 'R$',
    MXN: '$',
    PHP: '₱',
    THB: '฿',
    IDR: 'Rp',
    MYR: 'RM',
    VND: '₫',
    BDT: '৳',
    PKR: '₨',
    LKR: 'Rs',
    NPR: 'Rs',
    KES: 'KSh',
    NGN: '₦',
    ZAR: 'R',
    EGP: 'E£',
    ILS: '₪',
  };
  return symbols[currency] || currency;
}

/**
 * Get all supported currencies with their current rates
 * Used by admin panel to show conversion preview
 */
export function getSupportedCurrenciesWithRates(
  fxOverrides?: Record<string, number> | null
): Array<{ code: string; symbol: string; rate: number; name: string }> {
  const currencyNames: Record<string, string> = {
    INR: 'Indian Rupee',
    USD: 'US Dollar',
    EUR: 'Euro',
    GBP: 'British Pound',
    AED: 'UAE Dirham',
    SAR: 'Saudi Riyal',
    SGD: 'Singapore Dollar',
    HKD: 'Hong Kong Dollar',
    JPY: 'Japanese Yen',
    CNY: 'Chinese Yuan',
    KRW: 'South Korean Won',
    AUD: 'Australian Dollar',
    CAD: 'Canadian Dollar',
    CHF: 'Swiss Franc',
    SEK: 'Swedish Krona',
    NOK: 'Norwegian Krone',
    DKK: 'Danish Krone',
    PLN: 'Polish Zloty',
    TRY: 'Turkish Lira',
    RUB: 'Russian Ruble',
    BRL: 'Brazilian Real',
    MXN: 'Mexican Peso',
    PHP: 'Philippine Peso',
    THB: 'Thai Baht',
    IDR: 'Indonesian Rupiah',
    MYR: 'Malaysian Ringgit',
    VND: 'Vietnamese Dong',
    BDT: 'Bangladeshi Taka',
    PKR: 'Pakistani Rupee',
    LKR: 'Sri Lankan Rupee',
    NPR: 'Nepalese Rupee',
    KES: 'Kenyan Shilling',
    NGN: 'Nigerian Naira',
    ZA: 'South African Rand',
    EGP: 'Egyptian Pound',
    ILS: 'Israeli Shekel',
  };
  
  const inrRate = (fxOverrides && fxOverrides['INR']) || USD_TO_FOREIGN['INR'] || 83;
  
  return Object.entries(USD_TO_FOREIGN)
    .filter(([code]) => code !== 'USD')
    .map(([code, usdRate]) => {
      const liveRate = (fxOverrides && fxOverrides[code]) || usdRate;
      // Rate relative to INR (not USD)
      const inrRelativeRate = liveRate / inrRate;
      return {
        code,
        symbol: getCurrencySymbol(code),
        rate: inrRelativeRate,
        name: currencyNames[code] || code,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
