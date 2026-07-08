import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Save, Info, Calculator, TrendingUp, RefreshCw } from 'lucide-react';

// ============================================================================
// Settings — focused on the Agora calling economy.
// ============================================================================
// Only the coin economy + Agora call pricing/billing knobs live here. Legacy
// engagement/gamification toggles (streaks, re-engagement, random-match ranking,
// recommendation weights, custom-formula playground, seed presets) were removed
// to keep this page clean and product-focused. Any such keys still stored in the
// DB are preserved untouched (this page round-trips unknown keys on save).
// ============================================================================

const settingGroups = [
  {
    group: 'General',
    settings: [
      { key: 'app_name', label: 'App Name', type: 'text', hint: 'Name displayed in the mobile app' },
      { key: 'app_version', label: 'App Version', type: 'text', hint: 'Current version string (e.g. 1.0.0)' },
    ],
  },
  {
    group: 'Coin Economy',
    settings: [
      { key: 'coin_value_inr', label: 'Coin Payout Value (₹ per coin)', type: 'number', hint: 'What a host redeems 1 coin for on withdrawal (host cash payout). RECOMMENDED ₹0.085 so hosts keep ~30% of user spend. Admin sets in ₹; backend auto-converts to each host\'s currency.', step: '0.001' },
      { key: 'host_revenue_share', label: 'Host Revenue Share', type: 'number', hint: '0.70 means hosts receive 70% of coins charged per call. Platform keeps the rest. Per-level overrides live in Level System Configuration.', step: '0.01' },
      { key: 'min_withdrawal_coins', label: 'Minimum Withdrawal (Coins)', type: 'number', hint: 'Minimum coins a host must have to request a payout.', step: '1' },
    ],
  },
  {
    group: 'Call Rates (Agora)',
    settings: [
      { key: 'default_audio_rate', label: 'Default Audio Rate (Coins/min)', type: 'number', hint: 'Per-minute price for a VOICE call when a host has no explicit rate. RECOMMENDED 30 coins ≈ ₹6/min. A loss-proof floor is always enforced.', step: '1' },
      { key: 'default_video_rate', label: 'Default Video (HD) Rate (Coins/min)', type: 'number', hint: 'Per-minute price for an HD (≤720p) VIDEO call. RECOMMENDED 50 coins ≈ ₹10/min. Video is capped at 720p on clients so it always bills at Agora\'s cheaper HD tier.', step: '1' },
      { key: 'default_video_fhd_rate', label: 'Default Video (Full-HD) Rate (Coins/min)', type: 'number', hint: 'Premium per-minute price for Full-HD (1080p) video. RECOMMENDED 80 coins ≈ ₹16/min. Only used if Video Max Resolution = 1080p.', step: '1' },
    ],
  },

  {
    group: 'Agora Cost & Margins',
    settings: [
      { key: 'coin_purchase_inr', label: 'Coin Purchase Value (₹ per coin)', type: 'number', hint: 'What a user effectively pays to buy 1 coin (revenue side of the margin math). Coin plans keep their own authored prices — this drives the margin preview + loss-proof floor. RECOMMENDED ₹0.20.', step: '0.01' },
      { key: 'coin_payout_inr', label: 'Coin Payout Value override (₹ per coin)', type: 'number', hint: 'Optional override for the host payout used in the margin math. Leave equal to Coin Economy → Coin Payout Value. RECOMMENDED ₹0.085.', step: '0.001' },
      { key: 'payment_gateway_fee_pct', label: 'Payment Gateway Fee (%)', type: 'number', hint: 'Razorpay/Stripe fee on coin purchases, subtracted from platform revenue. Typically ~2%.', step: '0.1' },
      { key: 'video_max_resolution', label: 'Video Max Resolution', type: 'text', hint: '720p = Agora HD tier ($3.99/1k min, RECOMMENDED). 1080p = Full-HD tier ($8.99/1k min). Clients cap capture to this.' },
      { key: 'agora_audio_usd_per_1000', label: 'Agora Audio Cost ($/1000 min)', type: 'number', hint: 'Agora list price for audio, per participant. Default $0.99.', step: '0.01' },
      { key: 'agora_video_hd_usd_per_1000', label: 'Agora Video HD Cost ($/1000 min)', type: 'number', hint: 'Agora list price for HD (≤720p) video, per participant. Default $3.99.', step: '0.01' },
      { key: 'agora_video_fhd_usd_per_1000', label: 'Agora Video FHD Cost ($/1000 min)', type: 'number', hint: 'Agora list price for Full-HD (1080p) video, per participant. Default $8.99.', step: '0.01' },
      { key: 'call_participants', label: 'Billed Participants per Call', type: 'number', hint: 'Agora bills per participant. A 1:1 call = 2. Used for cost + margin math.', step: '1' },
      { key: 'floor_max_host_share', label: 'Floor: Max Host Share', type: 'number', hint: 'Worst-case host share (top level) used to compute the loss-proof rate floor. Default 0.80.', step: '0.01' },
      { key: 'call_floor_safety_multiplier', label: 'Floor: Safety Multiplier', type: 'number', hint: 'Headroom above raw break-even for the minimum enforced rate. 1.5 = floor is 50% above break-even.', step: '0.1' },
    ],
  },
  {
    group: 'Regional Pricing & Prepaid Hold',
    settings: [
      { key: 'regional_price_multiplier', label: 'Regional Price Multiplier (JSON)', type: 'text', hint: 'Purchasing-power markup applied ON TOP of FX-converted coin-plan prices, per currency. {} = pure FX. Example: {"USD":1.3,"EUR":1.3,"GBP":1.3,"AED":1.2}. INR (base) usually 1.' },
      { key: 'call_prepaid_hold_enabled', label: 'Prepaid Coin Hold (1=on, 0=off)', type: 'text', hint: 'When on, a caller\'s coins are RESERVED during an active call so they can\'t be double-spent on tips or a second call. Released automatically on end. Note: blocks tipping DURING a call. Recommended: 1.' },
    ],
  },
  {
    group: 'Billing & Free Trial',
    settings: [
      { key: 'billing_granularity_sec', label: 'Billing granularity — locked to per-minute', type: 'number', hint: 'PER-MINUTE round-up is enforced: any 1–60s call = 1 full minute (a 2-second call = 1 minute). Values below 60 are clamped server-side. Keep at 60.', step: '1' },
      { key: 'low_balance_warn_seconds', label: 'Low-balance warning threshold (seconds)', type: 'number', hint: 'Heartbeat pushes a call_low_balance event when the caller has fewer than this many seconds of coins left — drives the mid-call top-up modal.', step: '1' },
      { key: 'first_call_free_minutes', label: 'Free minutes for new signups', type: 'number', hint: 'Each newly registered user gets this many free call minutes. The host is paid in full; the platform absorbs the cost as customer acquisition. 0 disables.', step: '1' },
    ],
  },
];

const DEFAULTS: Record<string, string> = {
  app_name: 'VoxLink',
  app_version: '1.0.0',
  // Coin economy — RECOMMENDED (host keeps ~30% of user spend).
  coin_value_inr: '0.085',
  coin_to_usd_rate: '0.001024', // ≈ coin_value_inr ÷ 83 — overwritten by live values on load
  host_revenue_share: '0.70',
  min_withdrawal_coins: '100',
  // Call rates.
  default_audio_rate: '30',
  default_video_rate: '50',
  default_video_fhd_rate: '80',
  // Agora cost + margin knobs.
  coin_purchase_inr: '0.20',
  coin_payout_inr: '0.085',
  payment_gateway_fee_pct: '2',
  video_max_resolution: '720p',
  agora_audio_usd_per_1000: '0.99',
  agora_video_hd_usd_per_1000: '3.99',
  agora_video_fhd_usd_per_1000: '8.99',
  call_participants: '2',
  floor_max_host_share: '0.80',
  call_floor_safety_multiplier: '1.5',
  // Regional + hold.
  regional_price_multiplier: '{}',
  call_prepaid_hold_enabled: '1',
  // Billing + free trial.
  billing_granularity_sec: '60',
  low_balance_warn_seconds: '60',
  first_call_free_minutes: '5',
};

const INR_PER_USD_FALLBACK = 83;
function inrPerUsd(s: Record<string, string>): number {
  const live = parseFloat(s.inr_to_usd_rate || '');
  return Number.isFinite(live) && live > 0 ? live : INR_PER_USD_FALLBACK;
}


export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calcCoins, setCalcCoins] = useState('1000');

  useEffect(() => {
    api.settings()
      // Preserve any keys not shown on this page (round-tripped on save).
      .then((d) => setSettings({ ...DEFAULTS, ...d }))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      const fresh = await api.settings();
      setSettings({ ...DEFAULTS, ...fresh });
      toast.success('Settings saved successfully');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const inrRate = inrPerUsd(settings);
  const coinValueInr = parseFloat(settings.coin_value_inr || '0.085');
  const fxLastUpdated = settings.fx_rates_last_updated
    ? new Date(parseInt(settings.fx_rates_last_updated) * 1000).toLocaleString()
    : 'Not yet fetched';
  // Live-preview the $/coin rate from the ₹ value being typed (matches the
  // backend INR→USD conversion done on save).
  const coinRate = (() => {
    const fx = Number.isFinite(inrRate) && inrRate > 0 ? inrRate : 83;
    if (Number.isFinite(coinValueInr) && coinValueInr > 0) return coinValueInr / fx;
    return parseFloat(settings.coin_to_usd_rate || '0.001024');
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }


  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Call & Economy Settings</h2>
          <p className="text-sm text-muted-foreground">Agora calling, coin economy, pricing &amp; margins</p>
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 shadow-sm">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={15} />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {settingGroups.map(group => (
        <div key={group.group} className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-secondary/30">
            <h3 className="font-bold text-sm">{group.group}</h3>
          </div>
          <div className="divide-y divide-border">
            {group.settings.map(s => (
              <div key={s.key} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{s.label}</p>
                  {s.hint && (
                    <div className="flex items-start gap-1 mt-0.5">
                      <Info size={11} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">{s.hint}</p>
                    </div>
                  )}
                </div>
                <input
                  type={s.type} step={(s as any).step}
                  value={settings[s.key] ?? ''}
                  onChange={e => setSettings(prev => ({ ...prev, [s.key]: e.target.value }))}
                  className="w-full sm:w-48 border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            ))}
          </div>
          {group.group === 'Coin Economy' && (
            <div className="px-5 py-3 bg-blue-50/50 dark:bg-blue-950/20 border-t border-border">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-muted-foreground">Live FX Rate:</span>
                  <strong className="text-blue-600 dark:text-blue-400">1 USD = ₹{inrRate.toFixed(2)}</strong>
                </div>
                <span className="text-muted-foreground">Updated: {fxLastUpdated}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                <strong>1 coin = ₹{coinValueInr > 0 ? coinValueInr.toFixed(coinValueInr < 0.01 ? 4 : 3) : '—'}</strong>
                <span className="ml-1">= ${coinRate.toFixed(6)}/coin</span>
                &nbsp;·&nbsp; 100 coins = ₹{(coinValueInr * 100).toFixed(2)}
              </div>
            </div>
          )}
        </div>
      ))}


      {/* Quick coin calculator (live, unsaved-aware) */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-3">
          <Calculator size={13} /> Quick calculator
        </label>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <input type="number" min="0" value={calcCoins} onChange={e => setCalcCoins(e.target.value)}
              className="w-32 px-3 py-2 border border-border rounded-xl text-sm font-bold bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="text-sm text-muted-foreground">coins =</span>
          </div>
          {(() => {
            const coins = parseFloat(calcCoins) || 0;
            const share = parseFloat(settings.host_revenue_share || '0.70');
            const purchase = parseFloat(settings.coin_purchase_inr || '0.20');
            const Chip = ({ label, value, color }: { label: string; value: string; color: string }) => (
              <div className="flex-1 min-w-[110px] rounded-xl border border-border bg-background px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={`font-bold text-base ${color}`}>{value}</p>
              </div>
            );
            return (
              <div className="flex flex-1 flex-wrap gap-2">
                <Chip label="User buy value" value={`₹${(coins * purchase).toFixed(2)}`} color="text-green-600" />
                <Chip label={`Host cash (${Math.round(share * 100)}%)`} value={`₹${(coins * share * coinValueInr).toFixed(2)}`} color="text-amber-600" />
                <Chip label="In USD" value={`$${(coins * coinRate).toFixed(4)}`} color="text-blue-600" />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Agora cost + per-minute margin preview */}
      <MarginPreview settings={settings} inrRate={inrRate} />

      {/* Database maintenance */}
      <MigrationsCard />
    </div>
  );
}


// ─── Agora cost + margin preview ─────────────────────────────────────────────
// Mirrors api-server/src/lib/callEconomics.ts so the admin sees the exact
// per-minute P&L (user pays, host cash, Agora cost, gateway fee, platform net,
// margin %) + the loss-proof floor rate — live, as they edit rates above.
function MarginPreview({ settings, inrRate }: { settings: Record<string, string>; inrRate: number }) {
  const num = (k: string, d: number) => {
    const n = parseFloat(settings[k] ?? '');
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const fx = Number.isFinite(inrRate) && inrRate > 0 ? inrRate : 88;
  const cfg = {
    audioUsd: num('agora_audio_usd_per_1000', 0.99),
    hdUsd: num('agora_video_hd_usd_per_1000', 3.99),
    fhdUsd: num('agora_video_fhd_usd_per_1000', 8.99),
    participants: num('call_participants', 2),
    gatewayPct: num('payment_gateway_fee_pct', 2),
    purchase: num('coin_purchase_inr', 0.20),
    payout: num('coin_payout_inr', num('coin_value_inr', 0.085)),
    maxShare: Math.min(0.95, num('floor_max_host_share', 0.80)),
    safety: num('call_floor_safety_multiplier', 1.5),
    res: settings.video_max_resolution === '1080p' ? '1080p' : '720p',
    hostShare: Math.min(0.95, num('host_revenue_share', 0.70)),
    audioRate: num('default_audio_rate', 30),
    videoRate: num('default_video_rate', 50),
    videoFhdRate: num('default_video_fhd_rate', 80),
  };

  const agoraCostPerMin = (kind: 'audio' | 'video') => {
    const usd = kind === 'audio' ? cfg.audioUsd : cfg.res === '1080p' ? cfg.fhdUsd : cfg.hdUsd;
    return (usd / 1000) * cfg.participants * fx;
  };
  const floorRate = (kind: 'audio' | 'video') => {
    const marginPerCoin = cfg.purchase * (1 - cfg.gatewayPct / 100) - cfg.maxShare * cfg.payout;
    if (marginPerCoin <= 0) return 0;
    return Math.ceil((agoraCostPerMin(kind) / marginPerCoin) * cfg.safety);
  };
  const estimate = (rate: number, kind: 'audio' | 'video') => {
    const userPays = rate * cfg.purchase;
    const hostPayout = Math.floor(rate * cfg.hostShare) * cfg.payout;
    const gatewayFee = userPays * (cfg.gatewayPct / 100);
    const agoraCost = agoraCostPerMin(kind);
    const net = userPays - gatewayFee - hostPayout - agoraCost;
    const margin = userPays > 0 ? (net / userPays) * 100 : 0;
    const hostPctOfSpend = userPays > 0 ? (hostPayout / userPays) * 100 : 0;
    return { userPays, hostPayout, agoraCost, gatewayFee, net, margin, hostPctOfSpend };
  };


  const videoLabel = cfg.res === '1080p' ? 'Video (Full-HD)' : 'Video (HD)';
  const videoRate = cfg.res === '1080p' ? cfg.videoFhdRate : cfg.videoRate;
  const rows: { label: string; rate: number; kind: 'audio' | 'video' }[] = [
    { label: 'Audio', rate: cfg.audioRate, kind: 'audio' },
    { label: videoLabel, rate: videoRate, kind: 'video' },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-secondary/30 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
          <TrendingUp size={13} className="text-emerald-600" />
        </div>
        <div>
          <h3 className="font-bold text-sm">Agora Cost &amp; Per-Minute Margins</h3>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            Live P&amp;L per minute at the default rates
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
          </p>
        </div>
      </div>
      <div className="p-5 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 pr-3 font-semibold">Call type</th>
              <th className="py-2 px-3 font-semibold">Rate</th>
              <th className="py-2 px-3 font-semibold">User pays</th>
              <th className="py-2 px-3 font-semibold">Host cash</th>
              <th className="py-2 px-3 font-semibold">Agora</th>
              <th className="py-2 px-3 font-semibold">Gateway</th>
              <th className="py-2 px-3 font-semibold">Platform net</th>
              <th className="py-2 px-3 font-semibold">Margin</th>
              <th className="py-2 pl-3 font-semibold">Floor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = estimate(r.rate, r.kind);
              const floor = floorRate(r.kind);
              const belowFloor = r.rate < floor;
              return (
                <tr key={r.label} className="border-b border-border/50">
                  <td className="py-2.5 pr-3 font-semibold">{r.label}</td>
                  <td className="py-2.5 px-3">{r.rate} c/min</td>
                  <td className="py-2.5 px-3 text-green-600 font-semibold">₹{e.userPays.toFixed(2)}</td>
                  <td className="py-2.5 px-3 text-amber-600">₹{e.hostPayout.toFixed(2)} <span className="text-muted-foreground">({e.hostPctOfSpend.toFixed(0)}%)</span></td>
                  <td className="py-2.5 px-3 text-muted-foreground">₹{e.agoraCost.toFixed(3)}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">₹{e.gatewayFee.toFixed(2)}</td>
                  <td className="py-2.5 px-3 font-bold text-primary">₹{e.net.toFixed(2)}</td>
                  <td className="py-2.5 px-3 font-semibold">{e.margin.toFixed(0)}%</td>
                  <td className={`py-2.5 pl-3 ${belowFloor ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>
                    {floor} c/min{belowFloor ? ' ⚠️' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
          <p>
            <strong>Host cash %</strong> = host's cut of what the user actually paid (coins ×{' '}
            {Math.round(cfg.hostShare * 100)}% share × ₹{cfg.payout}/coin ÷ ₹{cfg.purchase}/coin).
            RECOMMENDED target ≈ 30%.
          </p>
          <p>
            <strong>Floor</strong> = loss-proof minimum rate enforced at call start (Agora + gateway break-even ×{' '}
            {cfg.safety} safety, at worst-case {Math.round(cfg.maxShare * 100)}% host share). ⚠️ means the default
            rate is below the floor and calls will be auto-raised to it.
          </p>
          <p>
            Agora video tier: <strong>{cfg.res}</strong> (@ ${cfg.res === '1080p' ? cfg.fhdUsd : cfg.hdUsd}/1k min ×{' '}
            {cfg.participants} participants, FX ₹{fx}/$). Clients cap capture to this so cost stays predictable.
          </p>
        </div>
      </div>
    </div>
  );
}

function MigrationsCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await api.runMigrations();
      const total = res?.total ?? 0;
      const skipped = (res?.results as string[] ?? []).filter((r: string) => r.startsWith('SKIP')).length;
      const applied = total - skipped;
      setResult({ ok: true, msg: `Done — ${applied} new columns/tables applied, ${skipped} already existed.` });
    } catch (e: any) {
      setResult({ ok: false, msg: e.message || 'Migration failed.' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-secondary/20">
        <h3 className="font-bold text-base">Database Maintenance</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Apply missing DB columns and tables to the production database</p>
      </div>
      <div className="px-5 py-5 space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Run this after every backend update to ensure all new columns (e.g. <code className="bg-secondary px-1 rounded text-xs">agora_cost_est</code>, <code className="bg-secondary px-1 rounded text-xs">coins_held</code>, <code className="bg-secondary px-1 rounded text-xs">coins_reserved</code>) exist in the production database.
          Safe to run multiple times — existing tables/columns are never overwritten.
        </p>
        {result && (
          <div className={`text-sm px-4 py-2.5 rounded-xl ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {result.msg}
          </div>
        )}
        <button onClick={run} disabled={running}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Running migrations…' : 'Run Migrations'}
        </button>
      </div>
    </div>
  );
}
