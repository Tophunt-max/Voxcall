import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Plus, Trash2, Save, RotateCw, TrendingUp, Users, Coins, Trophy } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Lucky Spin Wheel admin
// ─────────────────────────────────────────────────────────────────────────────
// Single-page editor for the Lucky Spin config (migration 0044).
// The config is one row (id='default'); segments is a JSON array of
// { label, coins, weight, color, emoji }. Weights are relative.

type Segment = {
  label: string;
  coins: number;
  weight: number;
  color: string;
  emoji: string;
};

type SpinStats = {
  total_spins?: number;
  unique_spinners?: number;
  coins_paid?: number;
  avg_win?: number;
};

type SpinDistRow = {
  segment_label: string;
  count: number;
  coins: number;
};

type SpinConfig = {
  enabled?: number | boolean;
  daily_free_spins?: number;
  segments?: string | Segment[];
};

const DEFAULT_SEGMENT: Segment = { label: 'New segment', coins: 10, weight: 5, color: '#8B5CF6', emoji: '🎁' };

function parseSegments(raw: unknown): Segment[] {
  if (Array.isArray(raw)) return raw as Segment[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Segment[];
    } catch { /* fall through */ }
  }
  return [];
}

export default function RewardSpin() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [dailyFreeSpins, setDailyFreeSpins] = useState(1);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [stats, setStats] = useState<SpinStats>({});
  const [distribution, setDistribution] = useState<SpinDistRow[]>([]);

  const load = () => {
    setLoading(true);
    api.rewardSpin()
      .then((d) => {
        const data = d as { config: SpinConfig; stats: SpinStats; distribution: SpinDistRow[] };
        const cfg = data.config ?? {};
        setEnabled(!!cfg.enabled);
        setDailyFreeSpins(Number(cfg.daily_free_spins ?? 1));
        setSegments(parseSegments(cfg.segments));
        setStats(data.stats ?? {});
        setDistribution(Array.isArray(data.distribution) ? data.distribution : []);
        setFetchError('');
      })
      .catch(() => setFetchError('Failed to load spin config'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const updateSegment = (idx: number, patch: Partial<Segment>) => {
    setSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addSegment = () => setSegments((prev) => [...prev, { ...DEFAULT_SEGMENT }]);
  const removeSegment = (idx: number) => setSegments((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (segments.length === 0) {
      toast.error('Add at least one segment before saving');
      return;
    }
    for (const [i, s] of segments.entries()) {
      if (!s.label.trim()) { toast.error(`Segment ${i + 1} needs a label`); return; }
      if (!Number.isFinite(s.weight) || s.weight <= 0) { toast.error(`Segment "${s.label}" must have weight > 0`); return; }
      if (!Number.isFinite(s.coins) || s.coins < 0) { toast.error(`Segment "${s.label}" coins must be >= 0`); return; }
    }
    setSaving(true);
    try {
      await api.updateRewardSpin({
        enabled,
        daily_free_spins: Math.max(0, Number(dailyFreeSpins) || 0),
        segments,
      });
      toast.success('Spin config saved');
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not save spin config';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const totalWeight = segments.reduce((s, x) => s + (Number(x.weight) || 0), 0);
  const maxDistCount = Math.max(1, ...distribution.map((d) => Number(d.count) || 0));

  return (
    <div className="space-y-5">
      {fetchError && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          ⚠ {fetchError}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Lucky Spin</h2>
          <p className="text-sm text-muted-foreground">Configure the variable-reward spin wheel shown on the user Rewards page.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 border border-border px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-secondary disabled:opacity-50">
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} /> Reload
          </button>
          <button onClick={save} disabled={loading || saving}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp size={12} /> Total spins</div>
          <p className="mt-2 font-bold text-xl">{Number(stats.total_spins ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users size={12} /> Unique spinners</div>
          <p className="mt-2 font-bold text-xl">{Number(stats.unique_spinners ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Coins size={12} /> Coins paid</div>
          <p className="mt-2 font-bold text-xl">{Number(stats.coins_paid ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Trophy size={12} /> Avg win</div>
          <p className="mt-2 font-bold text-xl">{Number(stats.avg_win ?? 0).toLocaleString()}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Global config */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="font-bold text-sm mb-4">Wheel settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>Enabled (visible to users)</span>
              </label>
              <div>
                <label className="text-sm font-semibold block mb-1.5">Daily free spins</label>
                <input type="number" min={0} max={20}
                  className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={dailyFreeSpins}
                  onChange={(e) => setDailyFreeSpins(Math.max(0, Number(e.target.value)))} />
                <p className="text-[10px] text-muted-foreground mt-1">Free spins granted to every user at UTC midnight.</p>
              </div>
            </div>
          </div>

          {/* Segments editor */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-sm">Segments</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Weights are relative. A segment with weight=10 is picked twice as often as weight=5.
                </p>
              </div>
              <button onClick={addSegment}
                className="flex items-center gap-1.5 border border-border px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-secondary">
                <Plus size={13} /> Add segment
              </button>
            </div>

            {segments.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No segments yet — click "Add segment" to start.</div>
            ) : (
              <div className="space-y-2">
                <div className="hidden md:grid grid-cols-12 gap-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <div className="col-span-3">Label</div>
                  <div className="col-span-1">Emoji</div>
                  <div className="col-span-2">Coins</div>
                  <div className="col-span-2">Weight</div>
                  <div className="col-span-1">Odds</div>
                  <div className="col-span-2">Color</div>
                  <div className="col-span-1 text-right">Actions</div>
                </div>
                {segments.map((s, idx) => {
                  const odds = totalWeight > 0 ? (Number(s.weight) / totalWeight) * 100 : 0;
                  return (
                    <div key={idx} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center bg-background border border-border rounded-xl p-2">
                      <input className="md:col-span-3 px-2.5 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="Label" value={s.label}
                        onChange={(e) => updateSegment(idx, { label: e.target.value })} />
                      <input className="md:col-span-1 px-2.5 py-2 border border-border rounded-lg text-sm bg-card text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
                        maxLength={4} placeholder="🎁" value={s.emoji}
                        onChange={(e) => updateSegment(idx, { emoji: e.target.value })} />
                      <input type="number" min={0}
                        className="md:col-span-2 px-2.5 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={s.coins}
                        onChange={(e) => updateSegment(idx, { coins: Math.max(0, Number(e.target.value)) })} />
                      <input type="number" min={1}
                        className="md:col-span-2 px-2.5 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={s.weight}
                        onChange={(e) => updateSegment(idx, { weight: Math.max(1, Number(e.target.value)) })} />
                      <div className="md:col-span-1 text-[11px] font-semibold text-muted-foreground">
                        {odds.toFixed(1)}%
                      </div>
                      <div className="md:col-span-2 flex items-center gap-1.5">
                        <input type="color"
                          className="w-9 h-9 rounded-lg border border-border cursor-pointer bg-card"
                          value={/^#[0-9A-Fa-f]{6}$/.test(s.color) ? s.color : '#8B5CF6'}
                          onChange={(e) => updateSegment(idx, { color: e.target.value })} />
                        <input className="flex-1 px-2 py-2 border border-border rounded-lg text-xs font-mono bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder="#8B5CF6" value={s.color}
                          onChange={(e) => updateSegment(idx, { color: e.target.value })} />
                      </div>
                      <div className="md:col-span-1 flex justify-end">
                        <button onClick={() => removeSegment(idx)}
                          className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-500" title="Remove segment">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Distribution */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="font-bold text-sm mb-1">Live segment distribution</h3>
            <p className="text-[11px] text-muted-foreground mb-4">How often each segment has been won so far.</p>
            {distribution.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No spins recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {distribution.map((d, i) => {
                  const pct = (Number(d.count) / maxDistCount) * 100;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold">{d.segment_label}</span>
                        <span className="text-muted-foreground">
                          {Number(d.count).toLocaleString()} spins · {Number(d.coins).toLocaleString()} coins
                        </span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.max(2, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
