import { useEffect, useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Save, Info, Calculator, TrendingUp, RefreshCw, Wifi, AlertTriangle, Activity } from 'lucide-react';

// ============================================================================
// Settings — focused on the Agora calling economy.
// ============================================================================
// Only the coin economy + Agora call pricing/billing knobs live here. Legacy
// engagement/gamification toggles (streaks, re-engagement, random-match ranking,
// recommendation weights, custom-formula playground, seed presets) were removed
// to keep this page clean and product-focused. Any such keys still stored in the
// DB are preserved untouched (this page round-trips unknown keys on save).
// ============================================================================

// ── Live-preview kinds ────────────────────────────────────────────────────
// `preview` on a setting tells the row renderer which chip layout to attach
// beside the input. See the CoinChips component further down for how each
// kind is rendered. Keeping this as string metadata (rather than key-matching
// inside the renderer) makes it obvious at a glance which fields have live
// price hints — and easy to extend when new coin-linked knobs are added.
//   • inr_per_coin_user  → "1 coin = ₹X · 100 = ₹Y · 1000 = ₹Z" (green)
//   • inr_per_coin_host  → same layout, amber (host payout side)
//   • coins_absolute     → treats value as a raw coin count and shows the
//                          ₹ user-cost + ₹ host-payout equivalents
//   • coins_per_min      → treats value as coins/min for a call and shows
//                          ₹/min user cost, ₹/min host earns, ₹/hour host
//   • usd_per_1000_min   → Agora cost fields; shows $/min, ₹/min per user,
//                          and total ₹/min including all billed participants
//   • pct_of_purchase    → gateway fee %; shows ₹ fee for common purchase
//                          amounts (₹100 / ₹500 / ₹1000)
//   • share_ratio        → 0–1 ratio; shows both sides as percentages
//                          (e.g. host 70% / platform 30%)
//   • floor_multiplier   → headroom multiplier; shows "+X% above break-even"
//   • participants_count → integer; shows "1:1 = 2 · 1:2 = 3 · group = N"
const settingGroups: Array<{
  group: string;
  settings: Array<{
    key: string;
    label: string;
    type: string;
    hint?: string;
    step?: string;
    preview?:
      | 'inr_per_coin_user'
      | 'inr_per_coin_host'
      | 'coins_absolute'
      | 'coins_per_min'
      | 'usd_per_1000_min'
      | 'pct_of_purchase'
      | 'share_ratio'
      | 'floor_multiplier'
      | 'participants_count';
  }>;
}> = [
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
      { key: 'coin_purchase_inr', label: '💰 Coin Purchase Value (₹ per coin) — user buys', type: 'number', hint: 'What a user pays to BUY 1 coin. RECOMMENDED ₹0.20 (so ₹1 = 5 coins, 100 coins = ₹20). This is the revenue side — see the live calculator below.', step: '0.01', preview: 'inr_per_coin_user' },
      { key: 'coin_value_inr', label: '💸 Coin Payout Value (₹ per coin) — host redeems', type: 'number', hint: 'What a host redeems 1 coin for on withdrawal (host cash payout). RECOMMENDED ₹0.085. The gap vs the purchase value is the platform spread. Backend auto-converts to each host\'s currency.', step: '0.001', preview: 'inr_per_coin_host' },
      { key: 'host_revenue_share', label: 'Host Revenue Share', type: 'number', hint: '0.70 means hosts receive 70% of coins charged per call. Platform keeps the rest. Per-level overrides live in Level System Configuration.', step: '0.01', preview: 'share_ratio' },
      { key: 'min_withdrawal_coins', label: 'Minimum Withdrawal (Coins)', type: 'number', hint: 'Minimum coins a host must have to request a payout.', step: '1', preview: 'coins_absolute' },
    ],
  },
  {
    group: 'Gifts & Tips Commission',
    settings: [
      { key: 'gift_commission_pct', label: 'Gift Platform Commission (%)', type: 'number', hint: 'Platform keeps this % of every gift a user sends; the host receives the rest. 0 = host keeps 100%. Also editable on the Chat Gifts page. Range 0–90.', step: '0.5' },
      { key: 'tip_commission_pct', label: 'Tip Platform Commission (%)', type: 'number', hint: 'Platform keeps this % of every tip a user sends a host; the host receives the rest. 0 = host keeps 100%. Range 0–90.', step: '0.5' },
    ],
  },
  {
    group: 'Call Rates (Agora)',
    settings: [
      { key: 'default_audio_rate', label: 'Default Audio Rate (Coins/min)', type: 'number', hint: 'Per-minute price for a VOICE call when a host has no explicit rate. RECOMMENDED 30 coins ≈ ₹6/min. A loss-proof floor is always enforced.', step: '1', preview: 'coins_per_min' },
      { key: 'default_video_rate', label: 'Default Video (HD) Rate (Coins/min)', type: 'number', hint: 'Per-minute price for an HD (≤720p) VIDEO call. RECOMMENDED 50 coins ≈ ₹10/min. Video is capped at 720p on clients so it always bills at Agora\'s cheaper HD tier.', step: '1', preview: 'coins_per_min' },
      { key: 'default_video_fhd_rate', label: 'Default Video (Full-HD) Rate (Coins/min)', type: 'number', hint: 'Premium per-minute price for Full-HD (1080p) video. RECOMMENDED 80 coins ≈ ₹16/min. Only used if Video Max Resolution = 1080p.', step: '1', preview: 'coins_per_min' },
    ],
  },

  {
    group: 'Agora Cost & Margins',
    settings: [
      { key: 'payment_gateway_fee_pct', label: 'Payment Gateway Fee (%)', type: 'number', hint: 'Razorpay/Stripe fee on coin purchases, subtracted from platform revenue. Typically ~2%. (Coin purchase/payout ₹ values are in Coin Economy above.)', step: '0.1', preview: 'pct_of_purchase' },
      { key: 'video_max_resolution', label: 'Video Max Resolution', type: 'text', hint: '720p = Agora HD tier ($3.99/1k min, RECOMMENDED). 1080p = Full-HD tier ($8.99/1k min). Clients cap capture to this.' },
      { key: 'agora_audio_usd_per_1000', label: 'Agora Audio Cost ($/1000 min)', type: 'number', hint: 'Agora list price for audio, per participant. Default $0.99.', step: '0.01', preview: 'usd_per_1000_min' },
      { key: 'agora_video_hd_usd_per_1000', label: 'Agora Video HD Cost ($/1000 min)', type: 'number', hint: 'Agora list price for HD (≤720p) video, per participant. Default $3.99.', step: '0.01', preview: 'usd_per_1000_min' },
      { key: 'agora_video_fhd_usd_per_1000', label: 'Agora Video FHD Cost ($/1000 min)', type: 'number', hint: 'Agora list price for Full-HD (1080p) video, per participant. Default $8.99.', step: '0.01', preview: 'usd_per_1000_min' },
      { key: 'call_participants', label: 'Billed Participants per Call', type: 'number', hint: 'Agora bills per participant. A 1:1 call = 2. Used for cost + margin math.', step: '1', preview: 'participants_count' },
      { key: 'floor_max_host_share', label: 'Floor: Max Host Share', type: 'number', hint: 'Worst-case host share (top level) used to compute the loss-proof rate floor. Default 0.80.', step: '0.01', preview: 'share_ratio' },
      { key: 'call_floor_safety_multiplier', label: 'Floor: Safety Multiplier', type: 'number', hint: 'Headroom above raw break-even for the minimum enforced rate. 1.5 = floor is 50% above break-even.', step: '0.1', preview: 'floor_multiplier' },
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
      { key: 'daily_free_minutes_all', label: 'Daily free minutes (all users)', type: 'number', hint: 'Recurring reward every user can claim once per day (like the VIP daily bonus, for everyone). Drives daily return + free-call trials. 0 disables.', step: '1' },
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
  // Gift + tip platform commission (percent). 0 = host keeps 100%.
  gift_commission_pct: '0',
  tip_commission_pct: '0',
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
  daily_free_minutes_all: '0',
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
  const [calcInr, setCalcInr] = useState('100');
  // ── Real-time sync ────────────────────────────────────────────────────────
  // `dirty` = fields the admin is editing (protected from background sync so a
  // live refresh never clobbers unsaved edits). `lastSynced` drives the "live"
  // indicator. Sync pulls every 12s + on window focus, so the FX cron's rate
  // updates AND other admins' saves appear here automatically. On save, the
  // backend already broadcasts app_settings_update over WebSocket, so the user
  // + host apps pick up new rates/coin value instantly (no app refresh).
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [lastSynced, setLastSynced] = useState(0);
  const [now, setNow] = useState(Date.now());
  const dirtyRef = useRef<Record<string, boolean>>({});
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const syncFromServer = useCallback(async (initial = false) => {
    try {
      const d = await api.settings();
      setSettings((prev) => {
        const next: Record<string, string> = { ...DEFAULTS, ...prev };
        // Merge server values, but NEVER overwrite a field being edited.
        for (const [k, v] of Object.entries(d)) {
          if (!dirtyRef.current[k]) next[k] = String(v);
        }
        return next;
      });
      setLastSynced(Date.now());
    } catch {
      if (initial) toast.error('Failed to load settings');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    syncFromServer(true);
    const sync = setInterval(() => syncFromServer(false), 12_000);
    // Tick every second so the "synced Xs ago" label stays live.
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onFocus = () => syncFromServer(false);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(sync); clearInterval(tick); window.removeEventListener('focus', onFocus); };
  }, [syncFromServer]);

  const setField = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  const dirtyCount = Object.keys(dirty).length;
  const syncedAgo = lastSynced ? Math.max(0, Math.round((now - lastSynced) / 1000)) : null;

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      const fresh = await api.settings();
      setSettings({ ...DEFAULTS, ...fresh });
      setDirty({});
      setLastSynced(Date.now());
      toast.success('Saved — pushed live to all apps');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const inrRate = inrPerUsd(settings);
  const coinValueInr = parseFloat(settings.coin_value_inr || '0.085');   // host payout ₹/coin
  const coinPurchaseInr = parseFloat(settings.coin_purchase_inr || '0.20'); // user buy ₹/coin
  const hostShare = parseFloat(settings.host_revenue_share || '0.70');
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-lg">Call & Economy Settings</h2>
          <p className="text-sm text-muted-foreground">Agora calling, coin economy, pricing &amp; margins</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live sync indicator — the page auto-pulls the server every 12s. */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Live — auto-syncs from the server; other admins' changes + FX rate updates appear here automatically">
            <Wifi size={13} className="text-green-500" />
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              {syncedAgo === null ? 'Live' : syncedAgo < 3 ? 'Synced just now' : `Synced ${syncedAgo}s ago`}
            </span>
          </div>
          <button onClick={save} disabled={saving || dirtyCount === 0}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 shadow-sm">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={15} />}
            {saving ? 'Saving...' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'Saved'}
          </button>
        </div>
      </div>

      {/* Live platform-economics dashboard — sits at the top so admin sees
        the money impact of every knob BEFORE scrolling to change one. */}
      <PlatformEconomicsDashboard settings={settings} inrRate={inrRate} />

      {settingGroups.map(group => (
        <div key={group.group} className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-secondary/30">
            <h3 className="font-bold text-sm">{group.group}</h3>
          </div>
          <div className="divide-y divide-border">
            {group.settings.map(s => (
              <div key={s.key} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    {s.label}
                    {dirty[s.key] && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved change" />}
                  </p>
                  {s.hint && (
                    <div className="flex items-start gap-1 mt-0.5">
                      <Info size={11} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">{s.hint}</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                  <input
                    type={s.type} step={(s as any).step}
                    value={settings[s.key] ?? ''}
                    onChange={e => setField(s.key, e.target.value)}
                    className={`w-full sm:w-32 border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 ${dirty[s.key] ? 'border-amber-400' : 'border-border'}`}
                  />
                  {/* Inline live preview — shows the ₹ equivalent right next to
                    the input so admin sees the money impact while typing (no
                    scrolling to the summary panel). All variants react live to
                    the coin_purchase_inr / coin_value_inr / host_revenue_share
                    fields, so editing one field updates every dependent chip. */}
                  {s.preview && (
                    <CoinChips
                      kind={s.preview}
                      rawValue={settings[s.key] ?? ''}
                      coinPurchaseInr={coinPurchaseInr}
                      coinValueInr={coinValueInr}
                      hostShare={hostShare}
                      inrRate={inrRate}
                      callParticipants={parseFloat(settings.call_participants || '2') || 2}
                    />
                  )}
                </div>
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
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white/60 dark:bg-black/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">User buys</p>
                  <p className="font-bold text-green-600">1 coin = ₹{coinPurchaseInr > 0 ? coinPurchaseInr.toFixed(coinPurchaseInr < 0.01 ? 4 : 2) : '—'}</p>
                  <p className="text-[10px] text-muted-foreground">₹1 = {coinPurchaseInr > 0 ? Math.round(1 / coinPurchaseInr) : '—'} coins · 100 coins = ₹{(coinPurchaseInr * 100).toFixed(0)}</p>
                </div>
                <div className="rounded-lg bg-white/60 dark:bg-black/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Host redeems (payout)</p>
                  <p className="font-bold text-amber-600">1 coin = ₹{coinValueInr > 0 ? coinValueInr.toFixed(coinValueInr < 0.01 ? 4 : 3) : '—'}</p>
                  <p className="text-[10px] text-muted-foreground">= ${coinRate.toFixed(6)}/coin · 100 coins = ₹{(coinValueInr * 100).toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}


      {/* Coin ↔ INR calculator — bidirectional, live (reacts to unsaved edits) */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-1.5">
          <Calculator size={14} className="text-violet-600" />
          <h3 className="font-bold text-sm">Coin ↔ INR Calculator</h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-green-600 ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
          </span>
        </div>

        {/* Coins → INR */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <input type="number" min="0" value={calcCoins} onChange={e => setCalcCoins(e.target.value)}
              className="w-28 px-3 py-2 border border-border rounded-xl text-sm font-bold bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="text-sm text-muted-foreground whitespace-nowrap">coins =</span>
          </div>
          {(() => {
            const coins = parseFloat(calcCoins) || 0;
            const Chip = ({ label, value, color }: { label: string; value: string; color: string }) => (
              <div className="flex-1 min-w-[110px] rounded-xl border border-border bg-background px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={`font-bold text-base ${color}`}>{value}</p>
              </div>
            );
            return (
              <div className="flex flex-1 flex-wrap gap-2">
                <Chip label="User pays" value={`₹${(coins * coinPurchaseInr).toFixed(2)}`} color="text-green-600" />
                <Chip label={`Host gets (${Math.round(hostShare * 100)}%)`} value={`₹${(coins * hostShare * coinValueInr).toFixed(2)}`} color="text-amber-600" />
                <Chip label="In USD" value={`$${(coins * coinRate).toFixed(4)}`} color="text-blue-600" />
              </div>
            );
          })()}
        </div>

        {/* INR → Coins */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">₹</span>
            <input type="number" min="0" value={calcInr} onChange={e => setCalcInr(e.target.value)}
              className="w-28 px-3 py-2 border border-border rounded-xl text-sm font-bold bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="text-sm text-muted-foreground whitespace-nowrap">=</span>
          </div>
          {(() => {
            const inr = parseFloat(calcInr) || 0;
            const Chip = ({ label, value, color }: { label: string; value: string; color: string }) => (
              <div className="flex-1 min-w-[130px] rounded-xl border border-border bg-background px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={`font-bold text-base ${color}`}>{value}</p>
              </div>
            );
            return (
              <div className="flex flex-1 flex-wrap gap-2">
                <Chip label="Coins user gets" value={`${coinPurchaseInr > 0 ? Math.round(inr / coinPurchaseInr).toLocaleString() : '—'} coins`} color="text-green-600" />
                <Chip label="Coins for host payout" value={`${coinValueInr > 0 ? Math.round(inr / coinValueInr).toLocaleString() : '—'} coins`} color="text-amber-600" />
              </div>
            );
          })()}
        </div>

        {/* Quick conversion table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground bg-secondary/40">
                <th className="py-2 px-3 font-semibold">Coins</th>
                <th className="py-2 px-3 font-semibold text-green-600">User pays (₹)</th>
                <th className="py-2 px-3 font-semibold text-amber-600">Host payout (₹)</th>
              </tr>
            </thead>
            <tbody>
              {[10, 50, 100, 500, 1000, 5000].map((c) => (
                <tr key={c} className="border-t border-border/50">
                  <td className="py-1.5 px-3 font-semibold">{c.toLocaleString()}</td>
                  <td className="py-1.5 px-3 text-green-600">₹{(c * coinPurchaseInr).toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-amber-600">₹{(c * coinValueInr).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Updates live as you edit <strong>Coin Purchase Value</strong> (user buys) and <strong>Coin Payout Value</strong> (host redeems) above.
          The gap between them is the platform's coin spread.
        </p>
      </div>

      {/* Database maintenance */}
      <MigrationsCard />

      {/* Sticky unsaved-changes bar — appears only when there are edits. */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-4 flex justify-center z-10">
          <div className="bg-foreground text-background text-sm px-5 py-3 rounded-full shadow-xl flex items-center gap-3">
            <span>{dirtyCount} unsaved change{dirtyCount > 1 ? 's' : ''}</span>
            <button onClick={save} disabled={saving}
              className="bg-white text-black px-4 py-1.5 rounded-full text-xs font-bold hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & push live'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Agora cost + margin preview ─────────────────────────────────────────────
// Mirrors api-server/src/lib/callEconomics.ts so the admin sees the exact
// ─── CoinChips ────────────────────────────────────────────────────────────
// Compact ₹-preview chips rendered next to any coin-linked setting input.
// Four preview kinds are supported (see SettingGroup `preview` metadata):
//
//   inr_per_coin_user  1 coin = ₹X · 100 = ₹Y · 1000 = ₹Z          (green)
//     Used for `coin_purchase_inr` — the user-facing coin price.
//     Shows how many rupees a caller pays for common coin amounts.
//
//   inr_per_coin_host  1 coin = ₹X · 100 = ₹Y · 1000 = ₹Z          (amber)
//     Used for `coin_value_inr` — the host redemption value.
//     Shows how many rupees a host cashes out for common coin amounts.
//
//   coins_absolute     = ₹Y user pays · ₹Z host receives           (both)
//     Used for raw coin counts (e.g. min_withdrawal_coins). Shows the
//     ₹ equivalent from BOTH sides so admin can see the revenue and
//     the payout footprint of the threshold at a glance.
//
//   coins_per_min      = ₹A/min user · ₹B/min host · ₹C/hr host    (green+amber+blue)
//     Used for call-rate coin/min fields. The most business-relevant chip:
//     it factors in host_revenue_share so admin sees the real host take
//     home per minute AND per hour, alongside the user-side revenue.
//
// All chips read from the same live-computed values used by the summary
// panel below, so updates to any dependency (coin_purchase_inr,
// coin_value_inr, host_revenue_share) propagate instantly.
function CoinChips({
  kind, rawValue, coinPurchaseInr, coinValueInr, hostShare, inrRate, callParticipants,
}: {
  kind:
    | 'inr_per_coin_user'
    | 'inr_per_coin_host'
    | 'coins_absolute'
    | 'coins_per_min'
    | 'usd_per_1000_min'
    | 'pct_of_purchase'
    | 'share_ratio'
    | 'floor_multiplier'
    | 'participants_count';
  rawValue: string;
  coinPurchaseInr: number;
  coinValueInr: number;
  hostShare: number;
  inrRate: number;
  callParticipants: number;
}) {
  const raw = parseFloat(String(rawValue ?? '0'));
  const val = Number.isFinite(raw) && raw > 0 ? raw : 0;

  // Semantic colour classes — matched to the summary panel so the whole
  // page speaks one visual language for user-revenue (green) vs
  // host-payout (amber) vs pure-info (neutral) numbers.
  const chip = 'rounded-lg border px-2 py-1 text-[11px] whitespace-nowrap';
  const chipGreen = `${chip} border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20`;
  const chipAmber = `${chip} border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20`;
  const chipNeutral = `${chip} border-border bg-secondary/40`;
  const green = 'text-green-600 dark:text-green-400 font-semibold';
  const amber = 'text-amber-600 dark:text-amber-400 font-semibold';
  const blue = 'text-blue-600 dark:text-blue-400 font-semibold';
  const dim = 'text-muted-foreground';

  const inr = (n: number, decimals = 2) => `₹${n.toFixed(decimals)}`;
  const inrCompact = (n: number) => (n < 1 ? inr(n, n < 0.01 ? 4 : 2) : inr(n, n < 10 ? 2 : 0));

  if (kind === 'inr_per_coin_user' || kind === 'inr_per_coin_host') {
    const isHost = kind === 'inr_per_coin_host';
    const primaryChip = isHost ? chipAmber : chipGreen;
    const accent = isHost ? amber : green;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={primaryChip}>
          <span className={dim}>1 coin = </span>
          <span className={accent}>{val > 0 ? inrCompact(val) : '—'}</span>
        </span>
        <span className={chipNeutral}>
          <span className={dim}>100 = </span>
          <span className={accent}>{val > 0 ? inr(val * 100, isHost ? 2 : 0) : '—'}</span>
        </span>
        <span className={chipNeutral}>
          <span className={dim}>1000 = </span>
          <span className={accent}>{val > 0 ? inr(val * 1000, isHost ? 2 : 0) : '—'}</span>
        </span>
      </div>
    );
  }

  if (kind === 'coins_absolute') {
    // val is a raw coin count. Show both sides so admin sees "at this
    // threshold, user spent ₹X to buy the coins and host will receive ₹Y".
    const userCost = val * coinPurchaseInr;
    const hostPayout = val * coinValueInr;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chipGreen}>
          <span className={dim}>User cost </span>
          <span className={green}>{val > 0 ? inrCompact(userCost) : '—'}</span>
        </span>
        <span className={chipAmber}>
          <span className={dim}>Host payout </span>
          <span className={amber}>{val > 0 ? inrCompact(hostPayout) : '—'}</span>
        </span>
      </div>
    );
  }

  if (kind === 'coins_per_min') {
    // coins_per_min — the call-rate case. val is coins/min charged to the
    // caller. Host actually receives coins × hostShare × coinValueInr per
    // minute (revenue share applied then payout ₹ conversion).
    const perMinUser = val * coinPurchaseInr;
    const perMinHost = val * hostShare * coinValueInr;
    const perHourHost = perMinHost * 60;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chipGreen}>
          <span className={dim}>User </span>
          <span className={green}>{val > 0 ? inrCompact(perMinUser) : '—'}</span>
          <span className={dim}>/min</span>
        </span>
        <span className={chipAmber}>
          <span className={dim}>Host </span>
          <span className={amber}>{val > 0 ? inrCompact(perMinHost) : '—'}</span>
          <span className={dim}>/min</span>
        </span>
        <span className={chipNeutral}>
          <span className={dim}>Host </span>
          <span className={blue}>{val > 0 ? inrCompact(perHourHost) : '—'}</span>
          <span className={dim}>/hr</span>
        </span>
      </div>
    );
  }

  if (kind === 'usd_per_1000_min') {
    // Agora list prices are quoted as $/1000 min per PARTICIPANT. A 1:1
    // voice call bills 2 participants → double the cost. The chip strip
    // makes the real per-minute economics visible: $/min, ₹/min per
    // participant, and the full call-level ₹/min for the default
    // participant count so admin sees Agora's actual bite of a minute.
    const usdPerMin = val / 1000;
    const inrPerMinPerPart = usdPerMin * inrRate;
    const inrPerMinCall = inrPerMinPerPart * callParticipants;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chipNeutral}>
          <span className={dim}>$/min </span>
          <span className={blue}>{val > 0 ? `$${usdPerMin.toFixed(5)}` : '—'}</span>
        </span>
        <span className={chipNeutral}>
          <span className={dim}>₹/min </span>
          <span className={blue}>{val > 0 ? inrCompact(inrPerMinPerPart) : '—'}</span>
        </span>
        <span className={chipAmber}>
          <span className={dim}>Full call ({callParticipants}p) </span>
          <span className={amber}>{val > 0 ? inrCompact(inrPerMinCall) : '—'}</span>
          <span className={dim}>/min</span>
        </span>
      </div>
    );
  }

  if (kind === 'pct_of_purchase') {
    // Gateway fee lives as a percentage but its impact is felt as a rupee
    // subtraction from the platform's revenue. Show what the fee costs
    // on common purchase amounts so admin sees the real drag.
    const feeOn = (amount: number) => (amount * val) / 100;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chipNeutral}>
          <span className={dim}>₹100 → </span>
          <span className={amber}>{val > 0 ? inr(feeOn(100), 2) : '—'}</span>
          <span className={dim}> fee</span>
        </span>
        <span className={chipNeutral}>
          <span className={dim}>₹500 → </span>
          <span className={amber}>{val > 0 ? inr(feeOn(500), 2) : '—'}</span>
        </span>
        <span className={chipNeutral}>
          <span className={dim}>₹1000 → </span>
          <span className={amber}>{val > 0 ? inr(feeOn(1000), 0) : '—'}</span>
        </span>
      </div>
    );
  }

  if (kind === 'share_ratio') {
    // Ratio 0–1. Show both sides as percentages so admin never has to
    // do the "1 − 0.7" math in their head. Also flags out-of-range
    // values so a fat-fingered 7.0 → 700% is obvious at a glance.
    const isValid = val > 0 && val <= 1;
    const hostPct = val * 100;
    const platformPct = (1 - val) * 100;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chipAmber}>
          <span className={dim}>Host </span>
          <span className={amber}>{isValid ? `${hostPct.toFixed(0)}%` : '—'}</span>
        </span>
        <span className={chipGreen}>
          <span className={dim}>Platform </span>
          <span className={green}>{isValid ? `${platformPct.toFixed(0)}%` : '—'}</span>
        </span>
        {val > 1 && (
          <span className={`${chip} border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 text-red-600 dark:text-red-400 font-semibold`}>
            must be ≤ 1
          </span>
        )}
      </div>
    );
  }

  if (kind === 'floor_multiplier') {
    // 1.0 = no headroom, 1.5 = +50%, 2.0 = +100%. Rendered as the
    // percentage cushion above break-even because that's how the
    // finance mental model works ("we want 50% margin over cost").
    const headroom = (val - 1) * 100;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chipNeutral}>
          <span className={dim}>= </span>
          <span className={blue}>{val > 0 ? `${headroom >= 0 ? '+' : ''}${headroom.toFixed(0)}%` : '—'}</span>
          <span className={dim}> above break-even</span>
        </span>
      </div>
    );
  }

  // participants_count — small integer, only meaningful as a label.
  const rounded = Math.max(1, Math.round(val));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={chipNeutral}>
        <span className={dim}>= </span>
        <span className={blue}>
          {val > 0
            ? rounded === 2 ? '1:1 call' : rounded === 3 ? '1:2 call' : `group of ${rounded}`
            : '—'}
        </span>
      </span>
    </div>
  );
}

// ─── PlatformEconomicsDashboard ──────────────────────────────────────────
// Top-of-page live P&L dashboard. Mirrors api-server/src/lib/callEconomics.ts
// so the admin sees the EXACT per-minute economics the backend will enforce.
//
// Sections (top → bottom):
//   1. Header bar
//        • Title + Live indicator
//        • HEALTH PILL (right): PROFITABLE / MARGINAL / LOSING MONEY
//          Aggregated verdict — one glance tells the admin whether their
//          current settings are safe to save.
//
//   2. Per-call P&L cards (grid of 3: Audio / Video HD / Video FHD)
//        For each call type shows:
//          User pays  −  Host cash  −  Agora  −  Gateway = Platform net
//          Margin %                                      Floor status pill
//        Cards are colour-graded by margin: red < 0, amber < 10 %, green ≥ 10 %.
//
//   3. Economics strip — 5 one-liners on a single row:
//        Coin spread ₹ (spread %)  |  Take rate %  |  Free-trial cost ₹/signup
//        |  Min withdrawal ₹  |  Break-even audio (seconds)
//
//   4. Conditional warning banners
//        Rendered only when a real problem is detected — silent when healthy
//        so the page doesn't cry wolf. Handles:
//          • Any call type net < 0
//          • Any rate < loss-proof floor
//          • host_revenue_share > 1
//          • Any margin < 10 %
//          • Free-trial cost > ₹100/signup (soft threshold, marked amber)
//
// Everything reads directly from the `settings` state map — so as soon as
// admin edits ANY dependent input above, this whole dashboard recomputes
// in the same render tick. No debounce, no manual "recalculate" button.
function PlatformEconomicsDashboard({ settings, inrRate }: { settings: Record<string, string>; inrRate: number }) {
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
    payout: num('coin_value_inr', num('coin_payout_inr', 0.085)),
    maxShare: Math.min(0.95, num('floor_max_host_share', 0.80)),
    safety: num('call_floor_safety_multiplier', 1.5),
    // hostShare is a ratio — we DON'T clamp with num() (which would coerce
    // 1.2 back to 0.7 because it's "invalid"), we let it through raw so the
    // warning banner below can flag it.
    hostShareRaw: parseFloat(settings.host_revenue_share || '0.70'),
    audioRate: num('default_audio_rate', 30),
    videoRate: num('default_video_rate', 50),
    videoFhdRate: num('default_video_fhd_rate', 80),
    // Downstream inputs used only in the economics strip
    minWithdraw: num('min_withdrawal_coins', 100),
    freeMinutes: parseFloat(settings.first_call_free_minutes || '0'),
  };
  const hostShare = Math.min(0.95, Math.max(0, cfg.hostShareRaw));

  // Per-participant → full-call ₹/min Agora cost.
  const agoraCostPerMin = (usdPer1000: number) =>
    (usdPer1000 / 1000) * cfg.participants * fx;

  // Loss-proof floor — the minimum coin rate the backend WILL charge.
  // Derived from the platform's per-coin margin (after gateway) minus the
  // worst-case host cut, then scaled by the safety multiplier for headroom.
  const floorRate = (usdPer1000: number) => {
    const marginPerCoin = cfg.purchase * (1 - cfg.gatewayPct / 100) - cfg.maxShare * cfg.payout;
    if (marginPerCoin <= 0) return 0;
    return Math.ceil((agoraCostPerMin(usdPer1000) / marginPerCoin) * cfg.safety);
  };

  const estimate = (rate: number, usdPer1000: number) => {
    const userPays = rate * cfg.purchase;
    // Host is paid in coins, so the payout ₹ is floor(rate × host_share)
    // × payout — matches the backend integer coin accounting.
    const hostPayout = Math.floor(rate * hostShare) * cfg.payout;
    const gatewayFee = userPays * (cfg.gatewayPct / 100);
    const agoraCost = agoraCostPerMin(usdPer1000);
    const net = userPays - gatewayFee - hostPayout - agoraCost;
    const margin = userPays > 0 ? (net / userPays) * 100 : 0;
    const floor = floorRate(usdPer1000);
    return { userPays, hostPayout, agoraCost, gatewayFee, net, margin, floor };
  };

  const calls = [
    { key: 'audio', label: 'Audio',       rate: cfg.audioRate,    usd: cfg.audioUsd },
    { key: 'hd',    label: 'Video (HD)',  rate: cfg.videoRate,    usd: cfg.hdUsd    },
    { key: 'fhd',   label: 'Video (FHD)', rate: cfg.videoFhdRate, usd: cfg.fhdUsd   },
  ] as const;
  const rows = calls.map((c) => ({ ...c, est: estimate(c.rate, c.usd) }));

  // ── Economics-strip figures ───────────────────────────────────────────
  const coinSpread = cfg.purchase - cfg.payout;
  const spreadPct = cfg.purchase > 0 ? (coinSpread / cfg.purchase) * 100 : 0;
  // Take rate = platform's share of every ₹ a user spends, after paying
  // gateway AND the host their cut of the coins burned in a call. It's
  // a synthetic-but-directional number computed from the AUDIO baseline.
  const audioTakeRate = rows[0].est.userPays > 0
    ? (rows[0].est.net / rows[0].est.userPays) * 100
    : 0;
  // Free-trial cost = free minutes × host payout ₹/min (host is paid in
  // full, platform absorbs). Uses default audio rate as the benchmark.
  const freeTrialCost = cfg.freeMinutes > 0 ? cfg.freeMinutes * rows[0].est.hostPayout : 0;
  const minWithdrawInr = cfg.minWithdraw * cfg.payout;
  // Break-even seconds for audio — how long a call must run before the
  // platform recovers gateway+Agora costs on the caller's first minute.
  const audioBreakEvenSec = rows[0].est.userPays > 0
    ? Math.max(0, Math.min(60, Math.round((rows[0].est.gatewayFee + rows[0].est.agoraCost) / (rows[0].est.userPays / 60))))
    : 0;

  // ── Health aggregator ─────────────────────────────────────────────────
  const belowFloor  = rows.some((r) => r.rate < r.est.floor);
  const anyLoss     = rows.some((r) => r.est.net < 0);
  const anyMarginal = rows.some((r) => r.est.margin < 10);
  const hostShareInvalid = cfg.hostShareRaw > 1 || cfg.hostShareRaw <= 0;
  const health: { tone: 'ok' | 'warn' | 'bad'; label: string } =
    anyLoss || hostShareInvalid
      ? { tone: 'bad',  label: 'LOSING MONEY' }
      : belowFloor || anyMarginal
      ? { tone: 'warn', label: 'MARGINAL' }
      : { tone: 'ok',   label: 'PROFITABLE' };

  const healthClass = {
    ok:   'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-400',
    warn: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400',
    bad:  'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400',
  }[health.tone];

  const marginColour = (m: number, net: number) =>
    net < 0 ? 'text-red-600 dark:text-red-400' :
    m < 10  ? 'text-amber-600 dark:text-amber-400' :
              'text-green-600 dark:text-green-400';

  // ── Warnings list ─────────────────────────────────────────────────────
  const warnings: Array<{ tone: 'bad' | 'warn'; msg: string }> = [];
  if (hostShareInvalid) {
    warnings.push({
      tone: 'bad',
      msg: `Host Revenue Share is ${cfg.hostShareRaw} — must be between 0 and 1. Above 1 means hosts earn more than callers pay.`,
    });
  }
  rows.forEach((r) => {
    if (r.est.net < 0) {
      warnings.push({
        tone: 'bad',
        msg: `${r.label} loses ₹${Math.abs(r.est.net).toFixed(2)}/min at ${r.rate} coins/min — the current rate is a net platform LOSS.`,
      });
    } else if (r.rate < r.est.floor) {
      warnings.push({
        tone: 'bad',
        msg: `${r.label} rate ${r.rate} coins/min is BELOW the loss-proof floor of ${r.est.floor} coins/min. Calls will be auto-raised at start.`,
      });
    } else if (r.est.margin < 10) {
      warnings.push({
        tone: 'warn',
        msg: `${r.label} margin is only ${r.est.margin.toFixed(0)}% — recommend raising the rate or lowering the host share.`,
      });
    }
  });
  if (freeTrialCost > 100) {
    warnings.push({
      tone: 'warn',
      msg: `Free-trial cost is ₹${freeTrialCost.toFixed(0)} per signup — expensive at scale. 1000 new signups = ₹${(freeTrialCost * 1000).toFixed(0)}.`,
    });
  }

  const StatChip = ({ label, value, tone }: { label: string; value: string; tone: 'green' | 'amber' | 'blue' | 'neutral' }) => {
    const bg = tone === 'green' ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900/50' :
               tone === 'amber' ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50' :
               tone === 'blue'  ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/50' :
                                  'bg-secondary/40 border-border';
    const fg = tone === 'green' ? 'text-green-700 dark:text-green-400' :
               tone === 'amber' ? 'text-amber-700 dark:text-amber-400' :
               tone === 'blue'  ? 'text-blue-700 dark:text-blue-400' :
                                  'text-foreground';
    return (
      <div className={`rounded-xl border px-3 py-2 ${bg}`}>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
        <p className={`font-bold text-sm ${fg}`}>{value}</p>
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* ── Header bar ────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-border bg-gradient-to-br from-slate-50 to-blue-50/40 dark:from-slate-900/50 dark:to-blue-950/20 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
            <Activity size={15} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Platform Economics — Live</h3>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              Real-time P&amp;L — recomputes as you edit any setting below
              <span className="inline-flex items-center gap-1 text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
              </span>
            </p>
          </div>
        </div>
        {/* Health pill — the one number an admin needs before hitting Save. */}
        <div className={`rounded-full border px-3 py-1.5 text-xs font-bold tracking-wide ${healthClass}`}>
          {health.tone === 'ok' ? '🟢' : health.tone === 'warn' ? '🟡' : '🔴'} {health.label}
        </div>
      </div>

      {/* ── Per-call P&L cards ────────────────────────────────────────── */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {rows.map((r) => {
          const belowFloorCard = r.rate < r.est.floor;
          const netColour = marginColour(r.est.margin, r.est.net);
          const marginPill = r.est.net < 0
            ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
            : r.est.margin < 10
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
            : 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400';
          return (
            <div key={r.key} className="rounded-xl border border-border bg-background p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{r.label}</p>
                  <p className="text-[11px] text-muted-foreground">{r.rate} coins/min</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${marginPill}`}>
                  {r.est.margin.toFixed(0)}%
                </span>
              </div>
              <div className="text-[11px] space-y-0.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">User pays</span>
                  <span className="text-green-600 dark:text-green-400">+₹{r.est.userPays.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Host cash</span>
                  <span className="text-amber-600 dark:text-amber-400">−₹{r.est.hostPayout.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agora</span>
                  <span className="text-muted-foreground">−₹{r.est.agoraCost.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gateway</span>
                  <span className="text-muted-foreground">−₹{r.est.gatewayFee.toFixed(2)}</span>
                </div>
                <div className="border-t border-border pt-1 mt-1 flex justify-between font-bold">
                  <span>Platform net</span>
                  <span className={netColour}>₹{r.est.net.toFixed(2)}/min</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Floor</span>
                <span className={belowFloorCard ? 'text-red-600 dark:text-red-400 font-bold' : 'text-green-600 dark:text-green-400 font-semibold'}>
                  {belowFloorCard ? `⚠ Below (${r.est.floor})` : `✓ ≥ ${r.est.floor} c/min`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Economics strip ──────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-border bg-secondary/20 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatChip
          label="Coin spread"
          value={`₹${coinSpread.toFixed(3)} (${spreadPct.toFixed(0)}%)`}
          tone="blue"
        />
        <StatChip
          label="Take rate (audio)"
          value={`${audioTakeRate.toFixed(0)}%`}
          tone={audioTakeRate < 0 ? 'amber' : 'green'}
        />
        <StatChip
          label="Free-trial cost"
          value={cfg.freeMinutes > 0 ? `₹${freeTrialCost.toFixed(2)}/user` : '—'}
          tone={freeTrialCost > 100 ? 'amber' : 'neutral'}
        />
        <StatChip
          label="Min withdrawal"
          value={`₹${minWithdrawInr.toFixed(2)}`}
          tone="neutral"
        />
        <StatChip
          label="Audio break-even"
          value={audioBreakEvenSec > 0 ? `${audioBreakEvenSec}s` : '—'}
          tone="neutral"
        />
      </div>

      {/* ── Warning banners (only when there's a real problem) ───────── */}
      {warnings.length > 0 && (
        <div className="px-4 py-3 border-t border-border space-y-2 bg-red-50/30 dark:bg-red-950/10">
          {warnings.map((w, i) => {
            const tone = w.tone === 'bad'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400';
            return (
              <div key={i} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}>
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <p>{w.msg}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Legacy MarginPreview (kept below for reference — NOT rendered) ──────
// The PlatformEconomicsDashboard above is its live-updated superset. Kept
// here purely for git-history continuity; if you're touching this file to
// simplify, deleting this whole function is safe.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    payout: num('coin_value_inr', num('coin_payout_inr', 0.085)),
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
