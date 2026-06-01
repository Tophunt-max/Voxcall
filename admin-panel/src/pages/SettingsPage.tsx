import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  Save, Info, Plus, Trash2, Edit2, Check, X,
  Calculator, PhoneCall, TrendingUp, Coins, RefreshCw
} from 'lucide-react';

// ─── types ───────────────────────────────────────────────────────────────────
interface ComputedRow {
  id: string;
  label: string;
  formula: 'coins_to_usd' | 'host_payout' | 'min_withdrawal_usd' | 'custom';
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
      { key: 'coin_to_usd_rate', label: 'Coin → Payout Rate', type: 'number', hint: 'Value of 1 coin in the payout currency. 0.01 → 100 coins = 1.00 (used to compute host withdrawal amounts)', step: '0.001' },
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
    ],
  },
];

const DEFAULTS: Record<string, string> = {
  coin_to_usd_rate: '0.01',
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

// ─── built-in formula evaluators ─────────────────────────────────────────────
function evalFormula(formula: ComputedRow['formula'], expr: string | undefined, s: Record<string, string>) {
  const rate = parseFloat(s.coin_to_usd_rate || '0.01');
  const share = parseFloat(s.host_revenue_share || '0.70');
  const minW = parseInt(s.min_withdrawal_coins || '100');

  switch (formula) {
    case 'coins_to_usd':
      return { primary: `₹${(100 * rate).toFixed(2)}`, label2: '100 coins in INR' };
    case 'host_payout':
      return { primary: `₹${(100 * rate * share).toFixed(3)}`, label2: 'Host earns per 100 coins' };
    case 'min_withdrawal_usd':
      return { primary: `₹${(minW * rate * share).toFixed(2)}`, label2: `${minW} coins → INR (host share)` };
    case 'custom': {
      try {
        const sanitized = (expr || '').trim();
        if (!sanitized) return { primary: '—', label2: 'Empty formula' };
        const substituted = sanitized
          .replace(/\brate\b/g, String(rate))
          .replace(/\bshare\b/g, String(share))
          .replace(/\bminW\b/g, String(minW));
        if (!/^[0-9\s.\+\-\*\/\(\)%]+$/.test(substituted)) {
          return { primary: '—', label2: 'Invalid expression' };
        }
        const val = safeEval(substituted);
        return { primary: String(isNaN(val) ? '—' : val.toFixed(4)), label2: 'Custom formula' };
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
  { value: 'custom', label: 'Custom Expression' },
];

// ─── component ───────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  // Two-stage confirm for the India seed (it WIPES coin_plans + replaces
  // level_config). First click sets `seedConfirming = true`, the button
  // morphs into a destructive-styled "Yes, apply" + cancel pair. Second
  // click actually triggers the network call.
  const [seedConfirming, setSeedConfirming] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Computed values rows
  const [computedRows, setComputedRows] = useState<ComputedRow[]>([
    { id: 'cr1', label: '100 Coins in INR', formula: 'coins_to_usd' },
    { id: 'cr2', label: 'Host Payout (per 100 coins)', formula: 'host_payout' },
    { id: 'cr3', label: 'Min Withdrawal Value', formula: 'min_withdrawal_usd' },
  ]);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editFormula, setEditFormula] = useState<ComputedRow['formula']>('coins_to_usd');
  const [editExpr, setEditExpr] = useState('');

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
    api.settings().then(d => setSettings({ ...DEFAULTS, ...d })).catch(() => showToast('Failed to load settings', false)).finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 2500); };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      showToast('Settings saved successfully');
    } catch (e: any) {
      showToast(e?.message || 'Failed to save settings', false);
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
      showToast(
        `India defaults applied — ${res.plans_seeded} plans, ${res.level_count} levels.`,
      );
      setSeedConfirming(false);
    } catch (e: any) {
      showToast(e?.message || 'Failed to apply India defaults', false);
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

  const saveEditRow = () => {
    setComputedRows(rows => rows.map(r =>
      r.id === editingRow ? { ...r, label: editLabel, formula: editFormula, customExpr: editExpr } : r
    ));
    setEditingRow(null);
  };

  const addComputedRow = () => {
    const id = `cr${Date.now()}`;
    setComputedRows(r => [...r, { id, label: 'New Metric', formula: 'coins_to_usd' }]);
    setEditingRow(id);
    setEditLabel('New Metric');
    setEditFormula('coins_to_usd');
    setEditExpr('');
  };

  const removeComputedRow = (id: string) => setComputedRows(r => r.filter(x => x.id !== id));

  // ── duration row helpers ─────────────────────────────────────────────────
  const addDuration = () => {
    const m = parseInt(newDuration);
    if (!m || m <= 0) return;
    if (durations.find(d => d.minutes === m)) { showToast(`${m} min already exists`, false); return; }
    setDurations(prev => [...prev, { id: `d${Date.now()}`, minutes: m }].sort((a, b) => a.minutes - b.minutes));
    setNewDuration('');
  };

  const removeDuration = (id: string) => {
    if (durations.length <= 1) { showToast('At least one duration required', false); return; }
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
  const coinRate = parseFloat(settings.coin_to_usd_rate || '0.01');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 text-white text-sm px-4 py-2.5 rounded-xl shadow-xl transition-all ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

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
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="text-2xl">🇮🇳</div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm">Apply India coin economy preset</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Wipes existing <strong>coin_plans</strong> and replaces them with 8 INR plans
              (₹19 → ₹6,999), upserts <code className="bg-amber-100/60 dark:bg-amber-950/60 px-1 rounded">coin_to_usd_rate=0.10</code>,{' '}
              <code className="bg-amber-100/60 dark:bg-amber-950/60 px-1 rounded">min_withdrawal_coins=500</code>,{' '}
              <code className="bg-amber-100/60 dark:bg-amber-950/60 px-1 rounded">host_revenue_share=0.60</code>,
              and replaces the level config with the India-tuned 5-tier ladder
              (60/65/70/75/80% earning share, audio caps 30→300, random rates 10→60).
              Existing custom plans will be lost.
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {!seedConfirming ? (
                <button
                  onClick={() => setSeedConfirming(true)}
                  disabled={seeding}
                  className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  Apply India defaults…
                </button>
              ) : (
                <>
                  <button
                    onClick={applyIndiaSeed}
                    disabled={seeding}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {seeding ? <RefreshCw size={13} className="animate-spin" /> : null}
                    {seeding ? 'Applying…' : 'Yes, wipe & apply'}
                  </button>
                  <button
                    onClick={() => setSeedConfirming(false)}
                    disabled={seeding}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-xl text-xs font-semibold hover:bg-secondary/80 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                    This is destructive — coin_plans will be wiped.
                  </span>
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
        </div>
      ))}

      {/* ── Computed Values ──────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
              <Calculator size={13} className="text-violet-600" />
            </div>
            <h3 className="font-bold text-sm">Computed Values</h3>
          </div>
          <button onClick={addComputedRow}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg hover:bg-primary/20 transition-colors">
            <Plus size={13} /> Add Row
          </button>
        </div>

        <div className="divide-y divide-border">
          {computedRows.map(row => {
            const { primary, label2 } = evalFormula(row.formula, row.customExpr, settings);
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
                          placeholder="JS expression: e.g. rate * 1000"
                          className="w-full px-3 py-2 border border-border rounded-xl text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">Variables: <code>rate</code> (coin→INR), <code>share</code> (host%), <code>minW</code> (min withdrawal coins)</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={saveEditRow}
                        className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-semibold">
                        <Check size={12} /> Save
                      </button>
                      <button onClick={() => setEditingRow(null)}
                        className="flex items-center gap-1 border border-border px-3 py-1.5 rounded-lg text-xs hover:bg-secondary">
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
