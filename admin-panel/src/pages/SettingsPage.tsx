import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  Save, Info, Plus, Trash2, Edit2, Check, X,
  Calculator, PhoneCall, TrendingUp, Coins, RefreshCw
} from 'lucide-react';

// ─── types ───────────────────────────────────────────────────────────────────
interface ComputedRow {
  id: string;
  label: string;
  formula: 'coins_to_usd' | 'host_payout' | 'min_withdrawal_usd' | 'default_call_cost' | 'coins_per_rupee' | 'custom';
  customExpr?: string; // for 'custom': a JS expression string evaluated client-side
  editingLabel?: boolean;
}

interface DurationRow {
  id: string;
  minutes: number;
}

// ─── setting groups ───────────────────────────────────────────────────────────
const settingGroups = [
  {
    group: 'General',
    settings: [
      { key: 'app_name', label: 'App Name', type: 'text', hint: 'Name displayed in the mobile app' },
      { key: 'app_version', label: 'App Version', type: 'text', hint: 'Current version string (e.g. 1.0.0)' },
    ],
  },
  {
    group: 'Economy',
    settings: [
      { key: 'coin_value_inr', label: 'Coin Value (₹ per coin)', type: 'number', hint: 'The money-worth of 1 coin in INR (₹). Simple for Indian users: 1 coin = ₹0.05 means 20 coins = ₹1. Admin sets in INR, backend auto-converts to USD. Users worldwide see value in their local currency.', step: '0.0001' },
      { key: 'host_revenue_share', label: 'Host Revenue Share', type: 'number', hint: '0.70 means hosts receive 70% of earned coins', step: '0.01' },
      { key: 'min_withdrawal_coins', label: 'Minimum Withdrawal (Coins)', type: 'number', hint: 'Minimum coins a host must have to request a payout' },
    ],
  },
  {
    group: 'Random Call Rates',
    settings: [
      { key: 'random_call_audio_rate', label: 'Audio Call Rate (Coins/min) — fallback', type: 'number', hint: 'Fallback rate when a host\'s level config doesn\'t define one. Per-level rates are set in Level System Configuration.', step: '1' },
      { key: 'random_call_video_rate', label: 'Video Call Rate (Coins/min) — fallback', type: 'number', hint: 'Fallback rate when a host\'s level config doesn\'t define one. Per-level rates are set in Level System Configuration.', step: '1' },
    ],
  },
  {
    group: 'Random Call Anti-abuse',
    settings: [
      { key: 'random_calls_per_day_limit', label: 'Daily matches per user', type: 'number', hint: 'Max successful /match/find calls a single user may make in a 24-hour rolling window. 0 disables the cap.', step: '1' },
      { key: 'random_decline_cooldown_count', label: 'Decline cooldown threshold', type: 'number', hint: 'Number of consecutive declines (incl. timeouts) that triggers the cooldown. 0 disables.', step: '1' },
      { key: 'random_decline_cooldown_min', label: 'Decline cooldown minutes', type: 'number', hint: 'How long a user is blocked from /match/find after hitting the threshold above.', step: '1' },
      { key: 'random_match_repeat_block_min', label: 'No-repeat window (minutes)', type: 'number', hint: 'A user won\'t be matched with the same host again within this window.', step: '1' },
    ],
  },
  {
    group: 'Engagement — Daily Streak',
    settings: [
      { key: 'daily_streak_enabled', label: 'Daily streak rewards enabled', type: 'text', hint: 'Set to 1 to enable, 0 to kill-switch the feature without removing config.' },
      { key: 'daily_streak_schedule', label: 'Reward schedule (JSON array)', type: 'text', hint: 'Coins awarded on each day of the cycle. e.g. [5,10,15,20,30,50,100] = Day 1 gets 5 coins, Day 7 gets 100, Day 8 wraps back to 5.' },
      { key: 'daily_streak_milestones', label: 'Milestone bonuses (JSON map)', type: 'text', hint: 'One-time bonus on top of base reward when streak hits a specific day. e.g. {"7":50,"14":100,"30":500}.' },
      { key: 'daily_streak_variable_enabled', label: 'Variable "lucky wheel" reward', type: 'text', hint: 'Set to 1 to randomize the daily base reward via a multiplier wheel. EXPECTED payout stays equal to the schedule (budget-neutral) — only the variance/dopamine changes. 0 = fixed reward.' },
      { key: 'daily_streak_variable_table', label: 'Lucky wheel table (JSON)', type: 'text', hint: 'Multiplier→probability tiers, e.g. [{"m":0.5,"p":0.35},{"m":1,"p":0.2},{"m":5,"p":0.05}]. The server rescales by 1/E[m] so the average payout always equals the scheduled base.' },
    ],
  },
  {
    group: 'Engagement — Daily Streak: Freeze / Chest / Anti-abuse',
    settings: [
      { key: 'daily_streak_comeback_bonus', label: 'Comeback bonus (coins)', type: 'number', hint: 'Coins granted when a lapsed streak resets to Day 1 (softens the sting of missing a day). Only applies when the user HAD an active streak. 0 = off.', step: '1' },
      { key: 'daily_streak_guest_multiplier', label: 'Guest reward multiplier', type: 'number', hint: 'Scales coin rewards for guest (Quick-Login) accounts — those with no password and no Google login. Curbs multi-account farming. 1 = no change, 0.5 = half, 0 = guests earn nothing.', step: '0.05' },
      { key: 'daily_streak_minute_rewards', label: 'Free-minute rewards (JSON map)', type: 'text', hint: 'Streak day → free CALL minutes credited on top of coins. e.g. {"7":10,"30":30} gives 10 free min on Day 7. Reward variety without diluting coins. {} = none.' },
      { key: 'daily_streak_freeze_enabled', label: 'Streak freeze / repair enabled', type: 'text', hint: 'Set to 1 to let users restore a streak after missing exactly one day (spends a free freeze token or coins). 0 = disabled.' },
      { key: 'daily_streak_freeze_monthly', label: 'Free freezes per month', type: 'number', hint: 'Free "streak saver" tokens granted each IST month. A repair uses one token before charging coins.', step: '1' },
      { key: 'daily_streak_repair_cost_coins', label: 'Repair cost (coins)', type: 'number', hint: 'Coins charged to repair a streak when no free freeze token is left.', step: '1' },
      { key: 'daily_streak_chest_enabled', label: 'Monthly chest enabled', type: 'text', hint: 'Set to 1 to award a one-time bonus chest when a user claims enough days within one IST month. 0 = off.' },
      { key: 'daily_streak_chest_threshold', label: 'Chest threshold (claims/month)', type: 'number', hint: 'Number of daily claims within an IST month that unlocks the chest (e.g. 20).', step: '1' },
      { key: 'daily_streak_chest_reward', label: 'Chest reward (coins)', type: 'number', hint: 'Coins awarded once when the monthly claim threshold is reached.', step: '1' },
      { key: 'daily_streak_reminder_enabled', label: 'Daily reminder push enabled', type: 'text', hint: 'Set to 1 to push a reminder to users with an active streak who haven\'t claimed yet today. 0 = off.' },
      { key: 'daily_streak_reminder_hour_ist', label: 'Reminder hour (IST 0–23)', type: 'number', hint: 'IST hour to send the daily streak reminder (e.g. 20 = 8 PM). Fires once per day.', step: '1' },
    ],
  },
  {
    group: 'Engagement — First-call-free Trial',
    settings: [
      { key: 'first_call_free_minutes', label: 'Free minutes for new signups', type: 'number', hint: 'Each newly registered user gets this many free call minutes. The host is paid in full for those minutes; the platform absorbs the cost as customer acquisition. Set to 0 to disable.', step: '1' },
    ],
  },
  {
    group: 'Calling System — Default Call Rate',
    settings: [
      { key: 'default_audio_rate', label: 'Default Audio Rate (Coins/min)', type: 'number', hint: 'Standard per-minute price for a VOICE call, used everywhere a host has no explicit rate (call billing + rate shown in the apps). 25 coins ≈ ₹5/min at the production coin value. Hosts can still set their own rate up to their level cap.', step: '1' },
      { key: 'default_video_rate', label: 'Default Video Rate (Coins/min)', type: 'number', hint: 'Standard per-minute price for a VIDEO call (used when a host has no explicit video rate). 40 coins ≈ ₹8/min at the production coin value.', step: '1' },
    ],
  },
  {
    group: 'Calling System — Billing & UX',
    settings: [
      { key: 'billing_granularity_sec', label: 'Billing granularity (seconds)', type: 'number', hint: 'How real seconds map to one billable unit. 60 = per-minute round-up (default, traditional). 1 = whole-second precision (more lenient to caller). Math: caller_owes = ceil(duration / N) * (rate * N / 60).', step: '1' },
      { key: 'low_balance_warn_seconds', label: 'Low-balance warning threshold (seconds)', type: 'number', hint: 'Heartbeat pushes call_low_balance WS event to caller when fewer than this many seconds of coins remain — drives the mid-call top-up modal.', step: '1' },
    ],
  },
  {
    group: 'Engagement — Recommendations (For You rail)',
    settings: [
      { key: 'reco_enabled', label: 'Personalized recommendations enabled', type: 'text', hint: 'Set to 1 to enable GET /api/hosts/recommended personalization, 0 to fall back to the standard public-list ordering.' },
      { key: 'reco_weights', label: 'Scoring weights (JSON object)', type: 'text', hint: 'Linear-model weights. Keys: online, rating, rank_boost, popularity, favorite, past_calls, language, specialty, gender, freshness, exploration. Higher = more influence. Malformed JSON falls back to defaults.' },
    ],
  },
  {
    group: 'Engagement — Re-engagement / Win-back',
    settings: [
      { key: 'reengagement_enabled', label: 'Re-engagement push enabled', type: 'text', hint: 'Set to 1 to enable the scheduled churn-prevention nudges, 0 to kill-switch them.' },
      { key: 'reengagement_idle_days', label: 'Idle threshold (days)', type: 'number', hint: 'A user with no activity for this many days becomes eligible for a soft re-engagement nudge.', step: '1' },
      { key: 'reengagement_winback_days', label: 'Win-back threshold (days)', type: 'number', hint: 'At/after this many idle days the user gets the stronger win-back message instead of the soft nudge.', step: '1' },
      { key: 'reengagement_cooldown_days', label: 'Per-user cooldown (days)', type: 'number', hint: 'Minimum gap between re-engagement pushes to the same user, so we never spam.', step: '1' },
      { key: 'reengagement_max_per_run', label: 'Max users per run', type: 'number', hint: 'Cap on how many users are nudged in a single cron run (hard-capped at 500 server-side).', step: '1' },
      { key: 'reengagement_max_idle_days', label: 'Stop-pestering threshold (days)', type: 'number', hint: 'Users idle longer than this are considered churned-dead and are no longer nudged.', step: '1' },
      { key: 'reengagement_interval_hours', label: 'Run interval (hours)', type: 'number', hint: 'How often the re-engagement job runs (1–24). The cron fires every minute but the job self-gates to this interval.', step: '1' },
    ],
  },
  {
    group: 'Engagement — Random Match Ranking',
    settings: [
      { key: 'match_weighting_enabled', label: 'Quality-weighted matchmaking', type: 'text', hint: 'Set to 1 to weight random matches by host quality (rating/level/popularity), freshness and demand-balancing. 0 = legacy uniform random pick.' },
      { key: 'match_weights', label: 'Match weights (JSON object)', type: 'text', hint: 'Keys: base, rating, rank_boost, popularity, freshness, demand_balance. Higher base = more uniform/fair; higher demand_balance spreads calls across more hosts. Malformed JSON falls back to defaults.' },
    ],
  },
];

const DEFAULTS: Record<string, string> = {
  coin_value_inr: '0.05', // INR value per coin (admin sets this directly)
  coin_to_usd_rate: '0.0006', // ≈ coin_value_inr ÷ 83 — overwritten by live values on load
  host_revenue_share: '0.70',
  min_withdrawal_coins: '100',
  app_name: 'VoxLink',
  app_version: '1.0.0',
  random_call_audio_rate: '5',
  random_call_video_rate: '8',
  // Random-call anti-abuse defaults — preserve historical behaviour
  // (no limits, no cooldown) so a fresh deployment doesn't surprise users.
  random_calls_per_day_limit: '0',
  random_decline_cooldown_count: '0',
  random_decline_cooldown_min: '5',
  random_match_repeat_block_min: '30',
  // Daily-streak defaults (mirror lib/streak.ts DEFAULT_SCHEDULE / DEFAULT_MILESTONES).
  // schedule = 7-day cycle, milestones = one-time bonuses on key days.
  daily_streak_enabled: '1',
  daily_streak_schedule: '[5,10,15,20,30,50,100]',
  daily_streak_milestones: '{"7":50,"14":100,"30":500,"60":1500,"100":5000}',
  // First-call-free trial pool — per-user free minutes set on signup.
  first_call_free_minutes: '5',
  // Calling system — default per-minute call rates (coins). 25 ≈ ₹5/min,
  // 40 ≈ ₹8/min at the production coin value. Mirror DEFAULT_AUDIO_RATE /
  // DEFAULT_VIDEO_RATE in api-server/src/lib/levels.ts.
  default_audio_rate: '25',
  default_video_rate: '40',
  // Billing granularity (60 = per-minute, 1 = per-second).
  billing_granularity_sec: '60',
  // Heartbeat threshold for the call_low_balance WS event (seconds).
  low_balance_warn_seconds: '60',
  // Engagement — recommendation rail (mirror lib/recommend.ts DEFAULT_WEIGHTS).
  reco_enabled: '1',
  reco_weights:
    '{"online":1,"rating":0.6,"rank_boost":0.5,"popularity":0.3,"favorite":1.2,"past_calls":0.8,"language":0.4,"specialty":0.4,"gender":0.3,"freshness":0.5,"exploration":0.15}',
  // Engagement — re-engagement / win-back cron (mirror lib/reengagement.ts).
  reengagement_enabled: '1',
  reengagement_idle_days: '3',
  reengagement_winback_days: '7',
  reengagement_cooldown_days: '3',
  reengagement_max_per_run: '200',
  reengagement_max_idle_days: '45',
  reengagement_interval_hours: '6',
  // Priority 3 — quality-weighted matchmaking (mirror lib/matchWeight.ts).
  match_weighting_enabled: '1',
  match_weights: '{"base":1,"rating":1.2,"rank_boost":0.8,"popularity":0.4,"freshness":0.6,"demand_balance":1}',
  // Priority 4 — variable daily reward (mirror lib/streak.ts). OFF by default.
  daily_streak_variable_enabled: '0',
  daily_streak_variable_table: '[{"m":0.5,"p":0.35},{"m":0.8,"p":0.25},{"m":1,"p":0.2},{"m":2,"p":0.15},{"m":5,"p":0.05}]',
  // Daily Streak v2 — engagement levers (mirror lib/streak.ts defaults).
  // All default to "no behavior change" so the economy is untouched until
  // an admin opts in.
  daily_streak_comeback_bonus: '0',
  daily_streak_guest_multiplier: '1',
  daily_streak_minute_rewards: '{}',
  daily_streak_freeze_enabled: '0',
  daily_streak_freeze_monthly: '2',
  daily_streak_repair_cost_coins: '50',
  daily_streak_chest_enabled: '0',
  daily_streak_chest_threshold: '20',
  daily_streak_chest_reward: '500',
  daily_streak_reminder_enabled: '1',
  daily_streak_reminder_hour_ist: '20',
};

// ─── safe arithmetic evaluator (no eval / new Function) ──────────────────────
function safeEval(expression: string): number {
  let pos = 0;
  const s = expression.replace(/\s+/g, '');

  function parseExpr(): number {
    let left = parseTerm();
    while (pos < s.length && (s[pos] === '+' || s[pos] === '-')) {
      const op = s[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (pos < s.length && (s[pos] === '*' || s[pos] === '/' || s[pos] === '%')) {
      const op = s[pos++];
      const right = parseFactor();
      if (op === '*') left = left * right;
      else if (op === '/') left = right !== 0 ? left / right : NaN;
      else left = left % right;
    }
    return left;
  }

  function parseFactor(): number {
    if (s[pos] === '(') { pos++; const v = parseExpr(); if (s[pos] === ')') pos++; return v; }
    if (s[pos] === '-') { pos++; return -parseFactor(); }
    if (s[pos] === '+') { pos++; return parseFactor(); }
    const start = pos;
    while (pos < s.length && /[0-9.]/.test(s[pos])) pos++;
    if (pos === start) return NaN;
    return parseFloat(s.slice(start, pos));
  }

  const result = parseExpr();
  return pos === s.length ? result : NaN;
}

// USD→INR FX used for the ₹ preview rows. We DEFAULT to 83 but prefer the
// live, cron-refreshed rate the backend surfaces as `inr_to_usd_rate` (see
// admin GET /settings). Passing the settings object lets every preview use the
// same rate the backend used to convert coin_value_inr → coin_to_usd_rate, so
// the admin panel never shows a ₹ figure that disagrees with production.
const INR_PER_USD_FALLBACK = 83;

function inrPerUsd(s: Record<string, string>): number {
  const live = parseFloat(s.inr_to_usd_rate || '');
  return Number.isFinite(live) && live > 0 ? live : INR_PER_USD_FALLBACK;
}

// ─── built-in formula evaluators ─────────────────────────────────────────────
function evalFormula(formula: ComputedRow['formula'], expr: string | undefined, s: Record<string, string>) {
  const rate = parseFloat(s.coin_to_usd_rate || '0.0015');     // USD per coin
  const rateInr = rate * inrPerUsd(s);                         // ₹ per coin (live FX)
  const share = parseFloat(s.host_revenue_share || '0.70');
  const minW = parseInt(s.min_withdrawal_coins || '5000');
  const audioRate = parseInt(s.default_audio_rate || '25');
  const videoRate = parseInt(s.default_video_rate || '40');
  // Convert a coin-amount to ₹ for display.
  const inr = (coins: number, withShare = false) => coins * rateInr * (withShare ? share : 1);

  switch (formula) {
    case 'coins_to_usd':
      return { primary: `₹${inr(100).toFixed(2)}`, label2: '100 coins in INR' };
    case 'host_payout':
      return { primary: `₹${inr(100, true).toFixed(2)}`, label2: 'Host earns per 100 coins' };
    case 'min_withdrawal_usd':
      return { primary: `₹${inr(minW, true).toFixed(2)}`, label2: `${minW} coins → INR (host share)` };
    case 'coins_per_rupee':
      return {
        primary: rateInr > 0 ? `${Math.round(1 / rateInr)} coins` : '—',
        label2: 'Coins a user gets per ₹1',
      };
    case 'default_call_cost':
      return { primary: `₹${inr(audioRate).toFixed(2)} / ₹${inr(videoRate).toFixed(2)}`, label2: `Default call cost per min (audio / video)` };
    case 'custom': {
      try {
        const sanitized = (expr || '').trim();
        if (!sanitized) return { primary: '—', label2: 'Empty formula' };
        const substituted = sanitized
          // Order matters: replace longer names before shorter ones so
          // `rate_inr` isn't partially eaten by `rate`.
          .replace(/\brate_inr\b/g, String(rateInr))
          .replace(/\brate_usd\b/g, String(rate))
          .replace(/\brate\b/g, String(rateInr))   // bare `rate` = ₹/coin (intuitive default)
          .replace(/\bshare\b/g, String(share))
          .replace(/\bminW\b/g, String(minW))
          .replace(/\baudioRate\b/g, String(audioRate))
          .replace(/\bvideoRate\b/g, String(videoRate));
        if (!/^[0-9\s.\+\-\*\/\(\)%]+$/.test(substituted)) {
          return { primary: '—', label2: 'Invalid expression' };
        }
        const val = safeEval(substituted);
        if (isNaN(val)) return { primary: '—', label2: 'Formula error' };
        // Trim trailing zeros for readability (e.g. 12.5000 → 12.5).
        const pretty = parseFloat(val.toFixed(4));
        return { primary: String(pretty), label2: 'Custom formula' };
      } catch {
        return { primary: '—', label2: 'Formula error' };
      }
    }
    default:
      return { primary: '—', label2: '' };
  }
}

const FORMULA_OPTIONS: { value: ComputedRow['formula']; label: string }[] = [
  { value: 'coins_to_usd', label: '100 Coins → INR' },
  { value: 'host_payout', label: 'Host Payout per 100 Coins' },
  { value: 'min_withdrawal_usd', label: 'Min Withdrawal in INR' },
  { value: 'default_call_cost', label: 'Default Call Cost (₹/min)' },
  { value: 'coins_per_rupee', label: 'Coins per ₹1' },
  { value: 'custom', label: 'Custom Expression' },
];

// ─── component ───────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Two-stage confirm for the India seed (it WIPES coin_plans + replaces
  // level_config). First click sets `seedConfirming = true`, the button
  // morphs into a destructive-styled "Yes, apply" + cancel pair. Second
  // click actually triggers the network call.
  const [seedConfirming, setSeedConfirming] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Computed values rows — persisted to localStorage so an admin's custom
  // metrics survive a page reload / re-login (they're a UI convenience, not
  // server state).
  const COMPUTED_ROWS_KEY = 'voxlink_admin_computed_rows';
  const DEFAULT_COMPUTED_ROWS: ComputedRow[] = [
    { id: 'cr1', label: '100 Coins in INR', formula: 'coins_to_usd' },
    { id: 'cr2', label: 'Host Payout (per 100 coins)', formula: 'host_payout' },
    { id: 'cr3', label: 'Min Withdrawal Value', formula: 'min_withdrawal_usd' },
    { id: 'cr4', label: 'Default Call Cost (₹/min)', formula: 'default_call_cost' },
    { id: 'cr5', label: 'Coins per ₹1', formula: 'coins_per_rupee' },
  ];
  const [computedRows, setComputedRows] = useState<ComputedRow[]>(() => {
    try {
      const saved = localStorage.getItem(COMPUTED_ROWS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore corrupt storage */ }
    return DEFAULT_COMPUTED_ROWS;
  });
  // Persist on every change.
  useEffect(() => {
    try { localStorage.setItem(COMPUTED_ROWS_KEY, JSON.stringify(computedRows)); } catch { /* quota / private mode */ }
  }, [computedRows]);

  // Interactive coin calculator — type any coin amount and see the live
  // breakdown (user buy value, host payout, USD) using the CURRENT settings.
  const [calcCoins, setCalcCoins] = useState('1000');
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editFormula, setEditFormula] = useState<ComputedRow['formula']>('coins_to_usd');
  const [editExpr, setEditExpr] = useState('');
  
  // Real-time update indicator - tracks when settings were last changed
  const [lastSettingsUpdate, setLastSettingsUpdate] = useState(Date.now());

  // Duration rows
  const [durations, setDurations] = useState<DurationRow[]>([
    { id: 'd1', minutes: 1 },
    { id: 'd2', minutes: 5 },
    { id: 'd3', minutes: 10 },
    { id: 'd4', minutes: 30 },
  ]);
  const [newDuration, setNewDuration] = useState('');
  const [editingDur, setEditingDur] = useState<string | null>(null);
  const [editDurVal, setEditDurVal] = useState('');

  useEffect(() => {
    api.settings().then(d => {
      setSettings({ ...DEFAULTS, ...d });
      setLastSettingsUpdate(Date.now()); // Track when settings loaded
    }).catch(() => toast.error('Failed to load settings')).finally(() => setLoading(false));
  }, []);

  // REAL-TIME UPDATE: Poll for settings changes every 30 seconds
  // This ensures the admin panel reflects changes made by other admins
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const fresh = await api.settings();
        setSettings(prev => {
          // Only update if values actually changed
          const hasChanges = Object.keys(fresh).some(
            key => prev[key] !== fresh[key]
          );
          if (hasChanges) {
            setLastSettingsUpdate(Date.now());
            return { ...DEFAULTS, ...fresh };
          }
          return prev;
        });
      } catch {
        // Silently fail polling - don't disrupt user
      }
    }, 30000); // Poll every 30 seconds

    return () => clearInterval(pollInterval);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      // Refresh settings from server to get computed values (coin_value_inr from coin_to_usd_rate)
      const fresh = await api.settings();
      setSettings({ ...DEFAULTS, ...fresh });
      setLastSettingsUpdate(Date.now());
      toast.error('Settings saved successfully');
    } catch (e: any) {
      toast.success(e?.message || 'Failed to save settings');
    } finally { setSaving(false); }
  };

  // Apply the India coin economy preset:
  //   1. WIPES coin_plans, inserts 8 INR-priced plans
  //   2. Replaces level_config with India-tuned 5-tier ladder
  //   3. Upserts coin_to_usd_rate / min_withdrawal_coins / host_revenue_share
  // Refreshes the local settings snapshot on success so the UI reflects
  // the new values without a hard reload.
  const applyIndiaSeed = async () => {
    setSeeding(true);
    try {
      const res = await api.seedIndiaDefaults();
      // Refresh settings so the changed coin_to_usd_rate / min_withdrawal
      // numbers show up in the inputs above.
      const fresh = await api.settings();
      setSettings({ ...DEFAULTS, ...fresh });
      setLastSettingsUpdate(Date.now());
      toast.success(
        `India defaults applied — ${res.plans_seeded} plans, ${res.level_count} levels.`,
      );
      setSeedConfirming(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to apply India defaults');
    } finally {
      setSeeding(false);
    }
  };

  // Apply optimized coin economy (psychological pricing, sustainable margins)
  const applyOptimizedEconomy = async () => {
    setSeeding(true);
    try {
      // Goes through the api helper so it uses the correct API base URL
      // (VITE_API_URL) and the right auth token (voxlink_admin_token).
      const data = await api.seedCoinEconomy();

      if (!data.success) {
        throw new Error(data.message || data.error || 'Failed to seed economy');
      }

      // Refresh settings so the new values show up in the inputs above.
      const fresh = await api.settings();
      setSettings({ ...DEFAULTS, ...fresh });
      setLastSettingsUpdate(Date.now());

      const details = data.details;
      toast.success(
        `✅ Economy optimized! ${details?.plans?.length || 0} plans, ${details?.coin_value?.display || '₹0.05'}/coin`,
      );
      setSeedConfirming(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to apply optimized economy');
    } finally {
      setSeeding(false);
    }
  };

  // ── computed row helpers ─────────────────────────────────────────────────
  const startEditRow = (r: ComputedRow) => {
    setEditingRow(r.id);
    setEditLabel(r.label);
    setEditFormula(r.formula);
    setEditExpr(r.customExpr || '');
  };

  const cancelEditRow = () => {
    setEditingRow(null);
    setEditLabel('');
    setEditFormula('coins_to_usd');
    setEditExpr('');
  };

  const saveEditRow = () => {
    if (!editingRow) return;
    
    const currentEditingRow = editingRow;
    const currentLabel = editLabel;
    const currentFormula = editFormula;
    const currentExpr = editExpr;
    
    setComputedRows(rows => rows.map(r =>
      r.id === currentEditingRow ? { 
        ...r, 
        label: currentLabel || 'Unnamed Metric', 
        formula: currentFormula, 
        customExpr: currentExpr 
      } : r
    ));
    
    // Clear edit state after save
    setEditingRow(null);
    setEditLabel('');
    setEditFormula('coins_to_usd');
    setEditExpr('');
    
    toast.success('Computed value updated');
  };

  const addComputedRow = () => {
    const id = `cr${Date.now()}`;
    const newRow: ComputedRow = { id, label: 'New Metric', formula: 'coins_to_usd' };
    setComputedRows(r => [...r, newRow]);
    setEditingRow(id);
    setEditLabel('New Metric');
    setEditFormula('coins_to_usd');
    setEditExpr('');
  };

  const removeComputedRow = (id: string) => {
    // If removing the row being edited, clear edit state
    if (editingRow === id) {
      cancelEditRow();
    }
    setComputedRows(r => r.filter(x => x.id !== id));
    toast.error('Computed value removed');
  };

  const resetComputedRows = () => {
    setComputedRows(DEFAULT_COMPUTED_ROWS);
    setEditingRow(null);
    setEditLabel('');
    setEditFormula('coins_to_usd');
    setEditExpr('');
    toast.success('Computed values reset to defaults');
  };

  // ── duration row helpers ─────────────────────────────────────────────────
  const addDuration = () => {
    const m = parseInt(newDuration);
    if (!m || m <= 0) return;
    if (durations.find(d => d.minutes === m)) { toast.success(`${m} min already exists`); return; }
    setDurations(prev => [...prev, { id: `d${Date.now()}`, minutes: m }].sort((a, b) => a.minutes - b.minutes));
    setNewDuration('');
  };

  const removeDuration = (id: string) => {
    if (durations.length <= 1) { toast.error('At least one duration required'); return; }
    setDurations(prev => prev.filter(d => d.id !== id));
  };

  const startEditDur = (d: DurationRow) => { setEditingDur(d.id); setEditDurVal(String(d.minutes)); };

  const saveEditDur = () => {
    const m = parseInt(editDurVal);
    if (!m || m <= 0) { setEditingDur(null); return; }
    setDurations(prev => prev.map(d => d.id === editingDur ? { ...d, minutes: m } : d).sort((a, b) => a.minutes - b.minutes));
    setEditingDur(null);
  };

  // ── derived values ───────────────────────────────────────────────────────
  const audioRate = parseInt(settings.random_call_audio_rate || '5');
  const videoRate = parseInt(settings.random_call_video_rate || '8');

  // Live FX rate info
  const inrRate = parseFloat(settings.inr_to_usd_rate || '83');
  const fxLastUpdated = settings.fx_rates_last_updated 
    ? new Date(parseInt(settings.fx_rates_last_updated) * 1000).toLocaleString()
    : 'Not yet fetched';
  const coinValueInr = parseFloat(settings.coin_value_inr || '0.05');

  // REAL-TIME PREVIEW: derive the USD/coin rate from the INR coin value the
  // admin is CURRENTLY typing — not the last-saved coin_to_usd_rate. So the
  // moment they change ₹0.05 → ₹0.06 every preview below (the $/coin readout,
  // the Computed Values rows, the quick calculator, the per-minute call costs)
  // recalculates instantly, before they even hit Save. On Save the backend
  // performs the exact same INR→USD conversion, so what they preview is what
  // they get.
  const coinRate = (() => {
    const fx = Number.isFinite(inrRate) && inrRate > 0 ? inrRate : 83;
    if (Number.isFinite(coinValueInr) && coinValueInr > 0) return coinValueInr / fx;
    return parseFloat(settings.coin_to_usd_rate || '0.0015');
  })();

  // Snapshot fed to the formula evaluator so the Computed Values rows react to
  // the unsaved coin value too (they read coin_to_usd_rate internally).
  const liveSettings = { ...settings, coin_to_usd_rate: String(coinRate) };

  // ── Multi-currency live FX (base = INR) ──────────────────────────────────
  // The cron-refreshed `fx_rates_usd` blob is { CUR: units-per-USD }. We show
  // a curated set of major currencies as "1 CUR = ₹X" so the admin sees what
  // international users effectively pay/receive — with INR as the base.
  const fxRates: Record<string, number> = (() => {
    try { return settings.fx_rates_usd ? JSON.parse(settings.fx_rates_usd) : {}; } catch { return {}; }
  })();
  const CUR_SYMBOLS: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SAR: '﷼', CAD: 'C$', AUD: 'A$', SGD: 'S$',
  };
  const majorFx = Object.keys(CUR_SYMBOLS)
    .map((code) => {
      if (code === 'USD') return { code, symbol: '$', inr: inrRate };
      const r = fxRates[code];
      if (!r || !fxRates.INR) return null;
      return { code, symbol: CUR_SYMBOLS[code], inr: fxRates.INR / r };
    })
    .filter((x): x is { code: string; symbol: string; inr: number } => !!x && Number.isFinite(x.inr) && x.inr > 0);
  const minWithdraw = parseInt(settings.min_withdrawal_coins || '1000');
  // Value of a coin amount in a given currency: coins × USD/coin × units-per-USD.
  const valueIn = (coins: number, code: string) => {
    if (code === 'INR') return coins * coinValueInr;
    if (code === 'USD') return coins * coinRate;
    const r = fxRates[code];
    return r ? coins * coinRate * r : 0;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">App Settings</h2>
          <p className="text-sm text-muted-foreground">Configure platform-wide settings</p>
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 shadow-sm">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={15} />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* India Coin Economy preset card — destructive, two-stage confirm.
          Lives at the top so admins setting up a fresh deployment see it
          before scrolling through the granular settings. Once applied,
          admins can still tune individual values via the groups below. */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border border-green-200 dark:border-green-800/40 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="text-2xl">💰</div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm text-green-800 dark:text-green-200">Apply Optimized Coin Economy</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              <strong>One-click production setup!</strong> Sets optimal coin value (₹0.05/coin), 
              70% host share, psychological pricing (₹49-₹4999 plans with bonuses), 
              call rates (₹0.50/min audio, ₹1/min video), referral rewards, and daily streak.
              <span className="block mt-2 text-green-700 dark:text-green-300 font-medium">
                ✅ User-friendly pricing ✅ Sustainable margins ✅ Host earning potential
              </span>
            </p>
            <div className="mt-3 p-3 bg-white/50 dark:bg-black/20 rounded-xl text-xs space-y-1">
              <div className="flex justify-between"><span>Coin Value:</span><strong>₹0.05/coin</strong></div>
              <div className="flex justify-between"><span>Audio Call:</span><strong>₹0.50/min (host gets ₹0.35)</strong></div>
              <div className="flex justify-between"><span>Video Call:</span><strong>₹1.00/min (host gets ₹0.70)</strong></div>
              <div className="flex justify-between"><span>Host Revenue:</span><strong>70% of coins earned</strong></div>
              <div className="flex justify-between"><span>Min Withdrawal:</span><strong>₹50 (1000 coins)</strong></div>
              <div className="flex justify-between"><span>Plans:</span><strong>₹49 → ₹4999 (8 tiers)</strong></div>
            </div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {!seedConfirming ? (
                <button
                  onClick={() => setSeedConfirming(true)}
                  disabled={seeding}
                  className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  ⚡ Apply Optimized Economy…
                </button>
              ) : (
                <>
                  <button
                    onClick={applyOptimizedEconomy}
                    disabled={seeding}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {seeding ? <RefreshCw size={13} className="animate-spin" /> : null}
                    {seeding ? 'Applying…' : '✅ Yes, apply optimized economy'}
                  </button>
                  <button
                    onClick={() => setSeedConfirming(false)}
                    disabled={seeding}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-xl text-xs font-semibold hover:bg-secondary/80 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Setting groups */}
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
                  value={settings[s.key] || ''}
                  onChange={e => setSettings(prev => ({ ...prev, [s.key]: e.target.value }))}
                  className="w-full sm:w-48 border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            ))}
          </div>
          {/* Live FX Rate Indicator for Economy section */}
          {group.group === 'Economy' && (
            <div className="px-5 py-3 bg-blue-50/50 dark:bg-blue-950/20 border-t border-border">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                  <span className="text-muted-foreground">Live FX Rate:</span>
                  <strong className="text-blue-600 dark:text-blue-400">1 USD = ₹{inrRate.toFixed(2)}</strong>
                </div>
                <span className="text-muted-foreground">
                  Updated: {fxLastUpdated}
                </span>
              </div>
              <div className="mt-2 p-2 bg-white/50 dark:bg-black/10 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span>
                    <strong>1 coin = ₹{coinValueInr > 0 ? coinValueInr.toFixed(coinValueInr < 0.01 ? 4 : 2) : '—'}</strong>
                    <span className="text-muted-foreground ml-1">= ${coinRate.toFixed(6)}/coin</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Live preview (updates as you type)
                  </span>
                </div>
                <div className="text-muted-foreground">
                  20 coins = ₹{(coinValueInr * 20).toFixed(2)}
                  &nbsp;·&nbsp; 100 coins = ₹{(coinValueInr * 100).toFixed(2)}
                  &nbsp;·&nbsp; ₹1 = {coinValueInr > 0 ? Math.round(1 / coinValueInr).toLocaleString() : '—'} coins
                </div>
              </div>

              {/* Base currency + multi-currency live FX (base ₹INR) */}
              <div className="mt-2 p-2 bg-white/50 dark:bg-black/10 rounded-lg text-xs space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">Base currency:</span>
                  <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">INR ₹</span>
                  <span className="text-muted-foreground">— admin sets everything in ₹; users worldwide see their own currency, converted live.</span>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Live FX — 1 unit → ₹</p>
                  <div className="flex flex-wrap gap-1.5">
                    {majorFx.map(({ code, symbol, inr }) => (
                      <span key={code} className="px-2 py-0.5 rounded-lg bg-secondary">
                        {symbol}1 {code} = <strong>₹{inr.toFixed(2)}</strong>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-1.5 border-t border-border/50">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Withdrawal &amp; Deposit value (live)</p>
                  <div className="space-y-1">
                    <div>
                      <span className="text-muted-foreground">Min withdrawal:</span>{' '}
                      <strong>{minWithdraw.toLocaleString()} coins = ₹{valueIn(minWithdraw, 'INR').toFixed(2)}</strong>
                      <span className="text-muted-foreground"> (${valueIn(minWithdraw, 'USD').toFixed(2)}
                        {majorFx.filter(f => f.code !== 'USD').slice(0, 3).map(f => ` · ${f.symbol}${valueIn(minWithdraw, f.code).toFixed(2)}`).join('')})</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Deposit e.g. 1,000 coins:</span>{' '}
                      <strong>₹{valueIn(1000, 'INR').toFixed(2)}</strong>
                      <span className="text-muted-foreground"> (${valueIn(1000, 'USD').toFixed(2)}
                        {majorFx.filter(f => f.code !== 'USD').slice(0, 3).map(f => ` · ${f.symbol}${valueIn(1000, f.code).toFixed(2)}`).join('')})</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* ── Computed Values ──────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
              <Calculator size={13} className="text-violet-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Computed Values</h3>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                Live preview of your economy — updates as you edit settings above
                <span className="inline-flex items-center gap-1 text-green-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  Live
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={resetComputedRows}
              title="Reset to default metrics"
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-secondary px-2.5 py-1.5 rounded-lg hover:bg-secondary/70 transition-colors">
              <RefreshCw size={13} /> Reset
            </button>
            <button onClick={addComputedRow}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg hover:bg-primary/20 transition-colors">
              <Plus size={13} /> Add Row
            </button>
          </div>
        </div>

        {/* Interactive coin calculator — type any coin amount → live ₹ / host /
            USD breakdown using the CURRENT (unsaved) settings on this page. */}
        <div className="px-5 py-4 border-b border-border bg-violet-50/40 dark:bg-violet-950/10">
          <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2">
            <Calculator size={12} /> Quick calculator
          </label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <input
                type="number" min="0"
                value={calcCoins}
                onChange={e => setCalcCoins(e.target.value)}
                className="w-32 px-3 py-2 border border-border rounded-xl text-sm font-bold bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-sm text-muted-foreground">coins =</span>
            </div>
            {(() => {
              const coins = parseFloat(calcCoins) || 0;
              const rateInr = coinRate * inrRate;
              const share = parseFloat(settings.host_revenue_share || '0.70');
              const buy = coins * rateInr;
              const host = coins * rateInr * share;
              const usd = coins * coinRate;
              const Chip = ({ label, value, color }: { label: string; value: string; color: string }) => (
                <div className="flex-1 min-w-[110px] rounded-xl border border-border bg-background px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className={`font-bold text-base ${color}`}>{value}</p>
                </div>
              );
              return (
                <div className="flex flex-1 flex-wrap gap-2">
                  <Chip label="User buy value" value={`₹${buy.toFixed(2)}`} color="text-green-600" />
                  <Chip label={`Host gets (${Math.round(share * 100)}%)`} value={`₹${host.toFixed(2)}`} color="text-amber-600" />
                  <Chip label="In USD" value={`$${usd.toFixed(4)}`} color="text-blue-600" />
                </div>
              );
            })()}
          </div>
        </div>

        <div className="divide-y divide-border">
          {computedRows.map(row => {
            // Include lastSettingsUpdate in the dependency to ensure real-time updates
            // when settings change (this forces re-evaluation of formulas)
            const _updateKey = lastSettingsUpdate;
            const { primary, label2 } = evalFormula(row.formula, row.customExpr, liveSettings);
            const isEditing = editingRow === row.id;

            return (
              <div key={row.id} className="px-5 py-4">
                {isEditing ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        placeholder="Label..."
                        className="flex-1 px-3 py-2 border border-primary/50 rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <select
                        value={editFormula}
                        onChange={e => setEditFormula(e.target.value as ComputedRow['formula'])}
                        className="px-3 py-2 border border-border rounded-xl text-sm bg-background focus:outline-none">
                        {FORMULA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    {editFormula === 'custom' && (
                      <div>
                        <input
                          value={editExpr}
                          onChange={e => setEditExpr(e.target.value)}
                          placeholder="e.g. rate * 1000  →  ₹ value of 1000 coins"
                          className="w-full px-3 py-2 border border-border rounded-xl text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                          Variables: <code>rate</code> (₹/coin), <code>rate_usd</code> ($/coin), <code>rate_inr</code> (₹/coin),{' '}
                          <code>share</code> (host fraction 0–1), <code>minW</code> (min withdrawal coins),{' '}
                          <code>audioRate</code>, <code>videoRate</code> (coins/min). Operators: + − * / % ( ).
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={saveEditRow}
                        className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity">
                        <Check size={12} /> Save
                      </button>
                      <button onClick={cancelEditRow}
                        className="flex items-center gap-1 border border-border px-3 py-1.5 rounded-lg text-xs hover:bg-secondary transition-colors">
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{row.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{label2}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-bold text-xl text-primary">{primary}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          {FORMULA_OPTIONS.find(f => f.value === row.formula)?.label}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEditRow(row)}
                          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => removeComputedRow(row.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {computedRows.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No computed values. Click <strong>Add Row</strong> to create one.
          </div>
        )}
      </div>

      {/* ── Random Call — User Cost Preview ─────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
              <PhoneCall size={13} className="text-blue-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Random Call — User Cost Preview</h3>
              <p className="text-xs text-muted-foreground">Kitne coins katenge agar user itni der baat kare</p>
            </div>
          </div>
          {/* Add duration bar */}
          <div className="flex items-center gap-2">
            <input
              type="number" min="1" max="999"
              value={newDuration}
              onChange={e => setNewDuration(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addDuration()}
              placeholder="Minutes (e.g. 45)"
              className="flex-1 sm:w-48 sm:flex-none px-3 py-2 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={addDuration}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <Plus size={14} /> Add Duration
            </button>
          </div>
        </div>

        {/* Duration cards grid */}
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {durations.map(d => {
              const share = parseFloat(settings.host_revenue_share || '0.70');
              const audioCoins = audioRate * d.minutes;
              const videoCoins = videoRate * d.minutes;
              const hostEarns = Math.round(audioCoins * share);
              const audioInr = (audioCoins * coinRate).toFixed(2);
              const videoInr = (videoCoins * coinRate).toFixed(2);
              const isEditingThis = editingDur === d.id;

              return (
                <div key={d.id} className="border border-border rounded-xl overflow-hidden bg-background">
                  {/* Card header — duration label + actions */}
                  <div className="flex items-center justify-between px-3 py-2 bg-secondary/40 border-b border-border">
                    {isEditingThis ? (
                      <div className="flex items-center gap-1.5 flex-1">
                        <input
                          autoFocus
                          type="number" min="1" max="999"
                          value={editDurVal}
                          onChange={e => setEditDurVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEditDur();
                            if (e.key === 'Escape') setEditingDur(null);
                          }}
                          className="w-20 px-2 py-1 border border-primary/60 rounded-lg text-sm font-bold bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
                        />
                        <span className="text-xs text-muted-foreground">min</span>
                        <button
                          onClick={saveEditDur}
                          className="ml-1 p-1 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={() => setEditingDur(null)}
                          className="p-1 rounded-lg border border-border hover:bg-secondary transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="font-bold text-sm">{d.minutes} min</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEditDur(d)}
                            title="Edit duration"
                            className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={() => removeDuration(d.id)}
                            title="Remove duration"
                            className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Card body — costs */}
                  <div className="divide-y divide-border">
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">🎤</span>
                        <span className="text-xs text-muted-foreground">Voice</span>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-green-600">{audioCoins} coins</p>
                        <p className="text-[10px] text-muted-foreground">₹{audioInr}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">🎥</span>
                        <span className="text-xs text-muted-foreground">Video</span>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-violet-600">{videoCoins} coins</p>
                        <p className="text-[10px] text-muted-foreground">₹{videoInr}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5 bg-amber-50/40">
                      <div className="flex items-center gap-1.5">
                        <Coins size={12} className="text-amber-500" />
                        <span className="text-xs text-muted-foreground">Host earns</span>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-amber-600">{hostEarns} coins</p>
                        <p className="text-[10px] text-muted-foreground">{Math.round(share * 100)}% share</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {durations.length === 0 && (
              <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                No durations. Add one above.
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 bg-secondary/10 border-t border-border">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <TrendingUp size={11} />
            Values auto-update when you change rates above. Click the pencil to edit a duration, trash to remove it.
          </p>
        </div>
      </div>

      {/* Database Maintenance */}
      <MigrationsCard />
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
          Run this after every backend update to ensure all new columns (e.g. <code className="bg-secondary px-1 rounded text-xs">cf_caller_track_names</code>, <code className="bg-secondary px-1 rounded text-xs">reported_type</code>, <code className="bg-secondary px-1 rounded text-xs">application_type</code>) exist in the production database.
          Safe to run multiple times — existing tables/columns are never overwritten.
        </p>
        {result && (
          <div className={`text-sm px-4 py-2.5 rounded-xl ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {result.msg}
          </div>
        )}
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Running migrations…' : 'Run Migrations'}
        </button>
      </div>
    </div>
  );
}
