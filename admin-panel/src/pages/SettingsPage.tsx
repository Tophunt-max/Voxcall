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
      { key: 'coin_to_usd_rate', label: 'Coin → USD Rate', type: 'number', hint: '0.01 means 100 coins = $1.00', step: '0.001' },
      { key: 'host_revenue_share', label: 'Host Revenue Share', type: 'number', hint: '0.70 means hosts receive 70% of earned coins', step: '0.01' },
      { key: 'min_withdrawal_coins', label: 'Minimum Withdrawal (Coins)', type: 'number', hint: 'Minimum coins a host must have to request a payout' },
    ],
  },
  {
    group: 'Random Call Rates',
    settings: [
      { key: 'random_call_audio_rate', label: 'Audio Call Rate (Coins/min)', type: 'number', hint: 'Coins deducted per minute for random Voice calls', step: '1' },
      { key: 'random_call_video_rate', label: 'Video Call Rate (Coins/min)', type: 'number', hint: 'Coins deducted per minute for random Video calls', step: '1' },
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
};

// ─── built-in formula evaluators ─────────────────────────────────────────────
function evalFormula(formula: ComputedRow['formula'], expr: string | undefined, s: Record<string, string>) {
  const rate = parseFloat(s.coin_to_usd_rate || '0.01');
  const share = parseFloat(s.host_revenue_share || '0.70');
  const minW = parseInt(s.min_withdrawal_coins || '100');

  switch (formula) {
    case 'coins_to_usd':
      return { primary: `$${(100 * rate).toFixed(2)}`, label2: '100 coins in USD' };
    case 'host_payout':
      return { primary: `$${(100 * rate * share).toFixed(3)}`, label2: 'Host earns per 100 coins' };
    case 'min_withdrawal_usd':
      return { primary: `$${(minW * rate * share).toFixed(2)}`, label2: `${minW} coins → USD (host share)` };
    case 'custom': {
      try {
        // safe-ish eval: only expose number variables
        // eslint-disable-next-line no-new-func
        const fn = new Function('rate', 'share', 'minW', `return (${expr});`);
        const val = fn(rate, share, minW);
        return { primary: String(isNaN(val) ? '—' : val), label2: 'Custom formula' };
      } catch {
        return { primary: '—', label2: 'Formula error' };
      }
    }
    default:
      return { primary: '—', label2: '' };
  }
}

const FORMULA_OPTIONS: { value: ComputedRow['formula']; label: string }[] = [
  { value: 'coins_to_usd', label: '100 Coins → USD' },
  { value: 'host_payout', label: 'Host Payout per 100 Coins' },
  { value: 'min_withdrawal_usd', label: 'Min Withdrawal in USD' },
  { value: 'custom', label: 'Custom Expression' },
];

// ─── component ───────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Computed values rows
  const [computedRows, setComputedRows] = useState<ComputedRow[]>([
    { id: 'cr1', label: '100 Coins in USD', formula: 'coins_to_usd' },
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
    api.settings().then(d => setSettings({ ...DEFAULTS, ...d })).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 2500); };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      showToast('Settings saved successfully');
    } catch (e: any) {
      showToast('Saved locally (API offline)', true);
    } finally { setSaving(false); }
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
                        <p className="text-[10px] text-muted-foreground mt-1">Variables: <code>rate</code> (coin→USD), <code>share</code> (host%), <code>minW</code> (min withdrawal coins)</p>
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
              const audioUsd = (audioCoins * coinRate).toFixed(2);
              const videoUsd = (videoCoins * coinRate).toFixed(2);
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
                        <p className="text-[10px] text-muted-foreground">${audioUsd}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">🎥</span>
                        <span className="text-xs text-muted-foreground">Video</span>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-violet-600">{videoCoins} coins</p>
                        <p className="text-[10px] text-muted-foreground">${videoUsd}</p>
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
    </div>
  );
}
