// ============================================================================
// Call economics — Agora-cost-aware pricing model (single source of truth)
// ============================================================================
//
// Calls run on Agora RTC, which bills the PLATFORM per participant-minute:
//
//   Audio        $0.99 / 1,000 min      Video HD (≤720p)  $3.99 / 1,000 min
//   Video FHD    $8.99 / 1,000 min      (per participant — a 1:1 call = 2×)
//
// This module turns that into a per-minute ₹ cost, derives a LOSS-PROOF floor
// rate (coins/min the platform must charge so a call never loses money after
// the host's cut + the payment-gateway fee), and estimates the full P&L of a
// call for the admin margin dashboard.
//
// Everything is admin-tunable via app_settings (keys below) and fully
// self-defaulting — a fresh DB with none of these keys still gets sensible
// production values, so this never throws on a hot billing path.
//
// Money model (per spent coin):
//   • Revenue  = coin_purchase_inr   (₹ a user paid to acquire 1 coin ≈ ₹0.20)
//   • Host pay = coin_payout_inr      (₹ a host redeems 1 coin for ≈ ₹0.085)
//   • The buy/redeem spread + the platform's coin share are the profit levers;
//     Agora + gateway are the only hard cash COSTS.
// ============================================================================

export interface CallEconomicsConfig {
  /** Agora list price, USD per 1,000 minutes, per participant. */
  agoraAudioUsdPer1000: number;
  agoraVideoHdUsdPer1000: number;
  agoraVideoFhdUsdPer1000: number;
  /** ₹ per 1 USD (live FX, cron-refreshed via inr_to_usd_rate). */
  fxInrPerUsd: number;
  /** Participants whose minutes Agora bills (1:1 call = 2). */
  participantsPerCall: number;
  /** Payment-gateway fee on coin purchases, as a percentage (2 = 2%). */
  gatewayFeePct: number;
  /** ₹ a user effectively pays to buy 1 coin (revenue per spent coin). */
  coinPurchaseInr: number;
  /** ₹ a host redeems 1 coin for on withdrawal (real cash payout). */
  coinPayoutInr: number;
  /** Worst-case host share used for the loss-proof floor (top level). */
  floorMaxHostShare: number;
  /** Headroom above raw break-even for the floor (1.5 = +50% cushion). */
  floorSafetyMultiplier: number;
  /** Video billing/cost tier: '720p' (HD) or '1080p' (Full HD). */
  videoMaxResolution: '720p' | '1080p';
}

// Production defaults — verified against Agora's public pricing.
export const DEFAULT_CALL_ECONOMICS: CallEconomicsConfig = {
  agoraAudioUsdPer1000: 0.99,
  agoraVideoHdUsdPer1000: 3.99,
  agoraVideoFhdUsdPer1000: 8.99,
  fxInrPerUsd: 88,
  participantsPerCall: 2,
  gatewayFeePct: 2,
  coinPurchaseInr: 0.20,
  coinPayoutInr: 0.085,
  floorMaxHostShare: 0.80,
  floorSafetyMultiplier: 1.5,
  videoMaxResolution: '720p',
};

export type CallKind = 'audio' | 'video';

function num(v: unknown, fallback: number, min = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Load the economics config from app_settings, falling back to
 * {@link DEFAULT_CALL_ECONOMICS} for any missing/invalid key. The host payout
 * (`coin_payout_inr`) falls back to the canonical `coin_value_inr` economy key
 * before the hard default, so it tracks whatever the admin set on the Settings
 * page without a duplicate knob.
 */
export async function getCallEconomicsConfig(db: D1Database): Promise<CallEconomicsConfig> {
  const d = DEFAULT_CALL_ECONOMICS;
  try {
    const rows = await db
      .prepare(
        `SELECT key, value FROM app_settings WHERE key IN (
          'agora_audio_usd_per_1000','agora_video_hd_usd_per_1000','agora_video_fhd_usd_per_1000',
          'inr_to_usd_rate','fx_rates_usd','call_participants','payment_gateway_fee_pct',
          'coin_purchase_inr','coin_payout_inr','coin_value_inr',
          'floor_max_host_share','call_floor_safety_multiplier','video_max_resolution'
        )`,
      )
      .all<{ key: string; value: string }>();
    const m: Record<string, string> = {};
    for (const r of rows.results || []) m[r.key] = r.value;

    // Live FX: the cron refreshes `fx_rates_usd` (a { CUR: units-per-USD } blob)
    // every 12h. INR units-per-USD IS ₹/USD, exactly what the Agora cost needs.
    // We prefer this live value; `inr_to_usd_rate` is a computed field that is
    // NOT persisted as its own row, so it would otherwise never be found here.
    let fxInrPerUsd = num(m.inr_to_usd_rate, 0, 1);
    if (fxInrPerUsd <= 0 && m.fx_rates_usd) {
      try {
        const blob = JSON.parse(m.fx_rates_usd);
        const inr = Number(blob?.INR);
        if (Number.isFinite(inr) && inr > 0) fxInrPerUsd = inr;
      } catch { /* malformed blob — fall back to default below */ }
    }
    if (fxInrPerUsd <= 0) fxInrPerUsd = d.fxInrPerUsd;

    return {
      agoraAudioUsdPer1000: num(m.agora_audio_usd_per_1000, d.agoraAudioUsdPer1000),
      agoraVideoHdUsdPer1000: num(m.agora_video_hd_usd_per_1000, d.agoraVideoHdUsdPer1000),
      agoraVideoFhdUsdPer1000: num(m.agora_video_fhd_usd_per_1000, d.agoraVideoFhdUsdPer1000),
      fxInrPerUsd,
      participantsPerCall: num(m.call_participants, d.participantsPerCall, 1),
      gatewayFeePct: num(m.payment_gateway_fee_pct, d.gatewayFeePct),
      // coin_purchase_inr is a new, economics-only knob (revenue side). It does
      // NOT change actual coin-plan prices — those are authored per plan.
      coinPurchaseInr: num(m.coin_purchase_inr, d.coinPurchaseInr, 0.0001),
      // Prefer explicit coin_payout_inr, else the live economy value, else default.
      coinPayoutInr: num(m.coin_payout_inr, num(m.coin_value_inr, d.coinPayoutInr, 0.0001), 0.0001),
      floorMaxHostShare: Math.min(0.95, num(m.floor_max_host_share, d.floorMaxHostShare, 0.1)),
      floorSafetyMultiplier: num(m.call_floor_safety_multiplier, d.floorSafetyMultiplier, 1),
      videoMaxResolution: m.video_max_resolution === '1080p' ? '1080p' : d.videoMaxResolution,
    };
  } catch {
    return d;
  }
}

/**
 * Agora media cost for ONE wall-clock minute of a 1:1 call, in ₹.
 * Video uses the configured resolution tier (HD by default). Audio-only calls
 * bill at the audio rate; video calls include audio in the video price.
 */
export function agoraCostPerMinInr(kind: CallKind, cfg: CallEconomicsConfig): number {
  const usdPer1000 =
    kind === 'audio'
      ? cfg.agoraAudioUsdPer1000
      : cfg.videoMaxResolution === '1080p'
        ? cfg.agoraVideoFhdUsdPer1000
        : cfg.agoraVideoHdUsdPer1000;
  // (usd/1000min) × participants × ₹/usd → ₹ per wall-clock minute.
  return (usdPer1000 / 1000) * cfg.participantsPerCall * cfg.fxInrPerUsd;
}

/**
 * The loss-proof minimum rate (coins/min) for a call kind. Derived so that,
 * even at the highest host share, the platform's per-minute cash never goes
 * negative after the payment-gateway fee and Agora cost:
 *
 *   platformNet = rate·purchase·(1−fee) − rate·maxHostShare·payout − agoraCost ≥ 0
 *   ⇒ rate ≥ agoraCost / (purchase·(1−fee) − maxHostShare·payout)
 *
 * Then multiplied by the safety cushion and rounded up. Returns 0 if the money
 * model is degenerate (host would earn more cash per coin than the coin sells
 * for), which should never happen with sane config.
 */
export function floorRatePerMinCoins(kind: CallKind, cfg: CallEconomicsConfig): number {
  const agoraCost = agoraCostPerMinInr(kind, cfg);
  const marginPerCoin =
    cfg.coinPurchaseInr * (1 - cfg.gatewayFeePct / 100) - cfg.floorMaxHostShare * cfg.coinPayoutInr;
  if (marginPerCoin <= 0) return 0; // degenerate config — don't clamp
  const breakEven = agoraCost / marginPerCoin;
  return Math.ceil(breakEven * cfg.floorSafetyMultiplier);
}

export interface CallMargin {
  userPaysInr: number;
  hostPayoutInr: number;
  agoraCostInr: number;
  gatewayFeeInr: number;
  platformNetInr: number;
  /** Platform net as a % of what the user paid. */
  marginPct: number;
}

/**
 * Full per-call P&L in ₹. `hostShare` is the fraction (0–1) for this host's
 * level. Used by the admin margin dashboard and the pricing preview.
 */
export function estimateCallMargin(params: {
  ratePerMin: number;
  minutes: number;
  hostShare: number;
  cfg: CallEconomicsConfig;
  kind: CallKind;
}): CallMargin {
  const { ratePerMin, minutes, hostShare, cfg, kind } = params;
  const coins = Math.max(0, ratePerMin) * Math.max(0, minutes);
  const userPaysInr = coins * cfg.coinPurchaseInr;
  const hostPayoutInr = Math.floor(coins * hostShare) * cfg.coinPayoutInr;
  const gatewayFeeInr = userPaysInr * (cfg.gatewayFeePct / 100);
  const agoraCostInr = agoraCostPerMinInr(kind, cfg) * Math.max(0, minutes);
  const platformNetInr = userPaysInr - gatewayFeeInr - hostPayoutInr - agoraCostInr;
  const marginPct = userPaysInr > 0 ? (platformNetInr / userPaysInr) * 100 : 0;
  return {
    userPaysInr,
    hostPayoutInr,
    agoraCostInr,
    gatewayFeeInr,
    platformNetInr,
    marginPct,
  };
}
