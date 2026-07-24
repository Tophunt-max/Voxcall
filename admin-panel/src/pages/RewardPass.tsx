import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Plus, Trash2, Save, Crown, Coins, Users, Trophy } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Pass admin
// ─────────────────────────────────────────────────────────────────────────────
// Single-row config for the Chamet-style Monthly Pass (see migration
// 0070_reward_monthly_pass.sql). Users earn Pass Points by claiming reward
// tasks; crossing a tier threshold unlocks a Common (free) and Premium
// (VIP/paid) reward. Everything resets each calendar month.

type Tier = { level: number; points: number; label: string; free_coins: number; premium_coins: number };

type PassConfig = {
  enabled: number | boolean;
  title: string;
  description: string;
  price_coins: number;
  vip_auto_unlock: number | boolean;
  tiers: Tier[];
  stats?: { period: string; participants: number; premium_unlocks: number; claims: number; coins_paid: number };
};

function blankTier(level: number): Tier {
  return { level, points: level * 200, label: `Tier ${level}`, free_coins: 50, premium_coins: 150 };
}

export default function RewardPass() {
  const [cfg, setCfg] = useState<PassConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const load = () => {
    setLoading(true);
    api.rewardPass()
      .then((d: any) => {
        setCfg({
          enabled: !!Number(d.enabled),
          title: d.title ?? 'Monthly Pass',
          description: d.description ?? '',
          price_coins: Number(d.price_coins) || 0,
          vip_auto_unlock: !!Number(d.vip_auto_unlock),
          tiers: Array.isArray(d.tiers) ? d.tiers : [],
          stats: d.stats,
        });
        setFetchError('');
      })
      .catch(() => setFetchError('Failed to load Monthly Pass config'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await api.updateRewardPass({
        enabled: !!cfg.enabled,
        title: cfg.title,
        description: cfg.description,
        tiers: cfg.tiers,
      });
      toast.success('Monthly Pass saved');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const updateTier = (idx: number, patch: Partial<Tier>) => {
    if (!cfg) return;
    const tiers = cfg.tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    setCfg({ ...cfg, tiers });
  };

  const addTier = () => {
    if (!cfg) return;
    const nextLevel = cfg.tiers.length ? Math.max(...cfg.tiers.map((t) => t.level)) + 1 : 1;
    setCfg({ ...cfg, tiers: [...cfg.tiers, blankTier(nextLevel)] });
  };

  const removeTier = (idx: number) => {
    if (!cfg) return;
    setCfg({ ...cfg, tiers: cfg.tiers.filter((_, i) => i !== idx) });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!cfg) {
    return <div className="text-sm text-red-600">{fetchError || 'No config'}</div>;
  }

  const numInput = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="space-y-5 max-w-4xl">
      {fetchError && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">⚠ {fetchError}</div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Crown size={18} className="text-purple-500" /> Monthly Pass Rewards (Free &amp; VIP)</h2>
          <p className="text-sm text-muted-foreground">Set the tier rewards for both tracks: <strong>Free users</strong> claim the Common reward, <strong>VIP members</strong> unlock the Premium reward. Points are earned from reward tasks and reset each month.</p>
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Save size={15} /> {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Current-month stats */}
      {cfg.stats && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users size={12} /> Participants</div>
            <p className="mt-2 font-bold text-xl">{cfg.stats.participants.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Crown size={12} /> Premium unlocks</div>
            <p className="mt-2 font-bold text-xl">{cfg.stats.premium_unlocks.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Trophy size={12} /> Claims</div>
            <p className="mt-2 font-bold text-xl">{cfg.stats.claims.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Coins size={12} /> Coins paid ({cfg.stats.period})</div>
            <p className="mt-2 font-bold text-xl">{cfg.stats.coins_paid.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Config */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          <span className="font-semibold">Enabled (visible to users)</span>
        </label>

        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 text-xs">
          <Crown size={14} className="mt-0.5 flex-shrink-0" />
          <span>The <strong>Premium</strong> track is unlocked exclusively for active <strong>VIP members</strong>. There is no coin purchase — non-VIP users only get the Common (free) track.</span>
        </div>

        <div>
          <label className="text-sm font-semibold block mb-1.5">Title</label>
          <input className={numInput} value={cfg.title} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} />
        </div>

        <div>
          <label className="text-sm font-semibold block mb-1.5">Description</label>
          <textarea rows={2} className={numInput} value={cfg.description} onChange={(e) => setCfg({ ...cfg, description: e.target.value })} />
        </div>
      </div>

      {/* Tiers */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold text-sm">Tiers</h3>
            <p className="text-xs text-muted-foreground">Points needed + Common (free) and Premium (VIP/paid) coin rewards.</p>
          </div>
          <button onClick={addTier} className="flex items-center gap-1.5 border border-border px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-secondary">
            <Plus size={14} /> Add Tier
          </button>
        </div>

        {cfg.tiers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No tiers yet — add one to start the pass.</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[60px_1fr_90px_110px_120px_40px] gap-2 px-1 text-[11px] font-semibold text-muted-foreground">
              <span>Level</span><span>Label</span><span>Points</span><span>Free reward 🆓</span><span>VIP reward 👑</span><span></span>
            </div>
            {cfg.tiers.map((t, idx) => (
              <div key={idx} className="grid grid-cols-[60px_1fr_90px_110px_120px_40px] gap-2 items-center">
                <input type="number" min={1} className={numInput} value={t.level}
                  onChange={(e) => updateTier(idx, { level: Math.max(1, Number(e.target.value)) })} />
                <input className={numInput} value={t.label} onChange={(e) => updateTier(idx, { label: e.target.value })} />
                <input type="number" min={0} className={numInput} value={t.points}
                  onChange={(e) => updateTier(idx, { points: Math.max(0, Number(e.target.value)) })} />
                <input type="number" min={0} className={numInput} value={t.free_coins}
                  onChange={(e) => updateTier(idx, { free_coins: Math.max(0, Number(e.target.value)) })} />
                <input type="number" min={0} className={numInput} value={t.premium_coins}
                  onChange={(e) => updateTier(idx, { premium_coins: Math.max(0, Number(e.target.value)) })} />
                <button onClick={() => removeTier(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500" title="Remove tier">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
