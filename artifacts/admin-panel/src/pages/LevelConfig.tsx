import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Trophy, Save, RefreshCw, Info, ChevronRight, Coins } from 'lucide-react';

interface LevelDef {
  level: number;
  name: string;
  badge: string;
  color: string;
  min_calls: number;
  min_rating: number;
  coin_reward: number;
  description: string;
}

const DEFAULT_CONFIG: LevelDef[] = [
  { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0,   coin_reward: 0,    description: 'New to the platform' },
  { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, coin_reward: 100,  description: 'Getting established' },
  { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, coin_reward: 300,  description: 'Proven expertise' },
  { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, coin_reward: 500,  description: 'Professional tier' },
  { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, coin_reward: 1000, description: 'Top performer' },
];

function Field({ label, value, onChange, type = 'text', min, max, step, readOnly }: {
  label: string; value: string | number; onChange?: (v: string) => void;
  type?: string; min?: number; max?: number; step?: number; readOnly?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        min={min} max={max} step={step}
        readOnly={readOnly}
        className={`w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-all ${readOnly ? 'opacity-60 cursor-default' : ''}`}
      />
    </div>
  );
}

export default function LevelConfig() {
  const [config, setConfig] = useState<LevelDef[]>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    api.getLevelConfig()
      .then(data => { if (Array.isArray(data) && data.length === 5) setConfig(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateLevel = (idx: number, field: keyof LevelDef, val: string) => {
    setConfig(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      if (field === 'min_calls' || field === 'coin_reward') return { ...l, [field]: Math.max(0, parseInt(val) || 0) };
      if (field === 'min_rating') return { ...l, [field]: Math.min(5, Math.max(0, parseFloat(val) || 0)) };
      return { ...l, [field]: val };
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateLevelConfig(config);
      showToast('Level config saved successfully!');
    } catch (e: any) {
      showToast(e.message || 'Failed to save', false);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const res = await api.recalculateHostLevels();
      showToast(`All host levels recalculated using current thresholds!`);
    } catch (e: any) {
      showToast(e.message || 'Recalculation failed', false);
    } finally {
      setRecalculating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-medium text-white transition-all ${toast.ok ? 'bg-green-600' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Trophy size={20} className="text-violet-500" /> Level System Configuration
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure thresholds, coin rewards, and badges for each host level. Changes apply on next recalculation.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card hover:bg-secondary text-foreground text-sm font-medium transition-all disabled:opacity-60"
          >
            <RefreshCw size={15} className={recalculating ? 'animate-spin' : ''} />
            {recalculating ? 'Recalculating...' : 'Recalculate All Host Levels'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl gradient-purple text-white text-sm font-semibold shadow-md hover:opacity-90 transition-all disabled:opacity-60"
          >
            <Save size={15} />
            {saving ? 'Saving...' : 'Save Config'}
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 rounded-xl text-sm">
        <Info size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
        <div className="text-blue-700 dark:text-blue-300">
          <strong>How levels work:</strong> Hosts are auto-promoted when they meet the Min Calls + Min Rating thresholds. 
          Level 1 is the starting level (no requirements). Coin Reward is given when a host reaches that level for the first time.
          Click <strong>"Recalculate All Host Levels"</strong> to apply current thresholds to all existing hosts.
        </div>
      </div>

      {/* Level preview row */}
      <div className="flex gap-3 flex-wrap">
        {config.map((lvl) => (
          <div
            key={lvl.level}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold text-white shadow-md"
            style={{ backgroundColor: lvl.color }}
          >
            <span>{lvl.badge}</span>
            <span>Lv.{lvl.level} {lvl.name}</span>
          </div>
        ))}
      </div>

      {/* Level cards */}
      <div className="space-y-4">
        {config.map((lvl, idx) => (
          <div
            key={lvl.level}
            className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm"
          >
            {/* Card header */}
            <div
              className="flex items-center gap-4 px-5 py-4"
              style={{ background: `linear-gradient(135deg, ${lvl.color}22, ${lvl.color}08)`, borderBottom: `2px solid ${lvl.color}40` }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold shadow-md"
                style={{ backgroundColor: lvl.color + '30', border: `2px solid ${lvl.color}60` }}
              >
                {lvl.badge}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground text-base">Level {lvl.level}</span>
                  <span
                    className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: lvl.color }}
                  >
                    {lvl.name}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{lvl.description || '—'}</p>
              </div>
              {/* Coin reward badge */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40">
                <Coins size={14} className="text-amber-500" />
                <span className="text-sm font-bold text-amber-700 dark:text-amber-400">+{lvl.coin_reward} coins</span>
              </div>
            </div>

            {/* Fields grid */}
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
              <Field label="Level #" value={lvl.level} readOnly />
              <Field
                label="Badge Emoji"
                value={lvl.badge}
                onChange={v => updateLevel(idx, 'badge', v)}
              />
              <Field
                label="Level Name"
                value={lvl.name}
                onChange={v => updateLevel(idx, 'name', v)}
              />
              <Field
                label="Color (hex)"
                value={lvl.color}
                onChange={v => updateLevel(idx, 'color', v)}
              />
              <Field
                label="Min Calls"
                value={lvl.min_calls}
                type="number"
                min={0}
                onChange={v => updateLevel(idx, 'min_calls', v)}
              />
              <Field
                label="Min Rating (0–5)"
                value={lvl.min_rating}
                type="number"
                min={0}
                max={5}
                step={0.1}
                onChange={v => updateLevel(idx, 'min_rating', v)}
              />
              <Field
                label="Coin Reward"
                value={lvl.coin_reward}
                type="number"
                min={0}
                onChange={v => updateLevel(idx, 'coin_reward', v)}
              />
            </div>

            {/* Description row */}
            <div className="px-5 pb-5">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
              <input
                type="text"
                value={lvl.description}
                onChange={e => updateLevel(idx, 'description', e.target.value)}
                placeholder="Short description of this level..."
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
              />
            </div>

            {/* Requirements summary */}
            {idx > 0 && (
              <div
                className="px-5 pb-4 flex items-center gap-2 text-xs text-muted-foreground"
              >
                <ChevronRight size={13} />
                <span>
                  Requires: <strong>{lvl.min_calls}+ calls</strong> and <strong>{lvl.min_rating}+ rating</strong> to unlock
                  {lvl.coin_reward > 0 && <> · Reward: <strong className="text-amber-600">{lvl.coin_reward} coins</strong> on level-up</>}
                </span>
              </div>
            )}
            {idx === 0 && (
              <div className="px-5 pb-4 flex items-center gap-2 text-xs text-muted-foreground">
                <ChevronRight size={13} />
                <span>Starting level — all new hosts begin here, no requirements</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Color reference */}
      <div className="p-4 bg-card border border-border rounded-xl text-sm">
        <p className="font-semibold text-foreground mb-2">Quick Color Reference</p>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {[
            ['Gray',   '#6B7280'], ['Amber',  '#F59E0B'], ['Red',    '#EF4444'],
            ['Violet', '#8B5CF6'], ['Gold',   '#D97706'], ['Blue',   '#3B82F6'],
            ['Green',  '#22C55E'], ['Pink',   '#EC4899'],
          ].map(([name, hex]) => (
            <div key={hex} className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full border border-border inline-block" style={{ backgroundColor: hex }} />
              <span>{name} — {hex}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
