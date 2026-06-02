// useAppConfig — single source of truth for admin-controlled app settings.
//
// Fetches GET /api/app-config (economy values + operator settings the admin
// panel manages: maintenance_mode, maintenance_message, support_email,
// terms_url, privacy_url, app_name, min_coins_for_call, ...). The result is
// cached in a module-level singleton so every consumer (MaintenanceGate, Help
// Center, About, call-start checks) shares ONE network round-trip instead of
// each screen re-fetching.
//
// All reads are best-effort: a network error keeps the last good cache (or an
// empty object), so the app never blocks on this.
import { useEffect, useState } from "react";
import { API } from "@/services/api";
import { setCoinToUsdRate } from "@/utils/currency";

export type AppConfig = Record<string, string>;

let _cache: AppConfig | null = null;
let _inflight: Promise<AppConfig> | null = null;

// Push the admin-controlled coin value into the currency module so EVERY
// coins→money conversion in the app (coinsToLocalCurrency) reflects the
// admin's app_settings.coin_to_usd_rate. Called every time config resolves.
function applyConfigSideEffects(cfg: AppConfig): void {
  if (cfg && cfg.coin_to_usd_rate != null) setCoinToUsdRate(cfg.coin_to_usd_rate);
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
      _cache = cfg && typeof cfg === "object" ? cfg : {};
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

  useEffect(() => {
    let active = true;
    fetchAppConfig().then((cfg) => {
      if (!active) return;
      setConfig(cfg);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { config, loading };
}
