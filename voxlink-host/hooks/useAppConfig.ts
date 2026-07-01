// useAppConfig — single source of truth for admin-controlled app settings.
//
// Fetches GET /api/app-config (economy values + operator settings the admin
// panel manages: maintenance_mode, maintenance_message, support_email,
// terms_url, privacy_url, app_name, min_withdrawal_coins, ...). The result is
// cached in a module-level singleton so every consumer (MaintenanceGate, Help
// Center, About) shares ONE network round-trip instead of each re-fetching.
//
// REAL-TIME UPDATES: Also listens to WebSocket for coin value changes.
// When admin updates coin_to_usd_rate, all connected hosts get immediate
// notification and the app updates without refresh.
//
// All reads are best-effort: a network error keeps the last good cache (or an
// empty object), so the app never blocks on this.
import { useEffect, useState, useRef } from "react";
import { API } from "@/services/api";
import { setCoinToUsdRate, setCoinValueInr } from "@/utils/currency";

export type AppConfig = Record<string, string>;

let _cache: AppConfig | null = null;
let _inflight: Promise<AppConfig> | null = null;
let _listeners: Array<(cfg: AppConfig) => void> = [];

// Push the admin-controlled coin value into the currency module so EVERY
// coins→money conversion in the app reflects the admin's settings.
// coin_value_inr (₹/coin PAYOUT value) is the INR-base source of truth; we
// also keep the legacy coin_to_usd_rate in sync for back-compat.
function applyConfigSideEffects(cfg: AppConfig): void {
  if (cfg && cfg.coin_value_inr != null) setCoinValueInr(cfg.coin_value_inr);
  if (cfg && cfg.coin_to_usd_rate != null) setCoinToUsdRate(cfg.coin_to_usd_rate);
}

/**
 * Update the config cache and notify all listeners.
 * Called when WebSocket receives app_settings_update message.
 */
export function updateConfigCache(newSettings: Partial<AppConfig>): void {
  if (_cache) {
    const next: AppConfig = { ..._cache };
    Object.entries(newSettings).forEach(([key, value]) => {
      if (value != null) next[key] = value;
    });
    _cache = next;
    applyConfigSideEffects(next);
    _listeners.forEach(listener => listener(next));
  }
}

/**
 * Subscribe to config changes (for components that need real-time updates).
 */
export function subscribeToConfigChanges(listener: (cfg: AppConfig) => void): () => void {
  _listeners.push(listener);
  return () => {
    _listeners = _listeners.filter(l => l !== listener);
  };
}

/**
 * Fetch the app config, de-duplicating concurrent calls. Pass `force` to
 * bypass the cache (used by the maintenance gate's periodic re-check).
 */
export async function fetchAppConfig(force = false): Promise<AppConfig> {
  if (_cache && !force) return _cache;
  if (_inflight) return _inflight;
  _inflight = API.getAppConfig()
    .then((cfg) => {
      const normalized: AppConfig = {};
      if (cfg && typeof cfg === "object") {
        Object.entries(cfg).forEach(([key, value]) => {
          if (value != null) normalized[key] = String(value);
        });
      }
      _cache = normalized;
      applyConfigSideEffects(_cache);
      return _cache;
    })
    .catch(() => _cache ?? {})
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(_cache ?? {});
  const [loading, setLoading] = useState(!_cache);

  // Subscribe to real-time config changes
  useEffect(() => {
    let active = true;
    
    // Initial fetch
    fetchAppConfig().then((cfg) => {
      if (!active) return;
      setConfig(cfg);
      setLoading(false);
    });
    
    // Subscribe to real-time updates
    const unsubscribe = subscribeToConfigChanges((newCfg) => {
      if (!active) return;
      setConfig(newCfg);
    });
    
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { config, loading };
}

/**
 * Hook for components that need to react to coin value changes specifically.
 * Returns the current coin value and a flag when it changes.
 */
export function useCoinValue() {
  const { config } = useAppConfig();
  const [coinValueChanged, setCoinValueChanged] = useState(false);
  const prevCoinValue = useRef(config.coin_to_usd_rate);
  
  useEffect(() => {
    if (config.coin_to_usd_rate && config.coin_to_usd_rate !== prevCoinValue.current) {
      prevCoinValue.current = config.coin_to_usd_rate;
      setCoinValueChanged(true);
      // Reset flag after 3 seconds
      const timer = setTimeout(() => setCoinValueChanged(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [config.coin_to_usd_rate]);
  
  return {
    coinValue: parseFloat(config.coin_to_usd_rate || '0.0006'),
    coinValueChanged,
    coinToUsdRate: config.coin_to_usd_rate
  };
}
