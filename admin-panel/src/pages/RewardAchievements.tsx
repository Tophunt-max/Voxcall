import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Plus, Trash2, Edit2, Eye, EyeOff, Medal, Users, Coins } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Reward Achievements admin
// ─────────────────────────────────────────────────────────────────────────────
// CRUD for milestone achievements (migration 0044). Each achievement is
// unlocked silently when a user's counter for `trigger_type` crosses
// `trigger_threshold`. Tiers drive badge colour on the user page.

type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

type Achievement = {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  tier: Tier | string;
  trigger_type: string;
  trigger_threshold: number;
  coins_reward: number;
  active: number | boolean;
  sort_order: number;
  duration_days?: number;
  unlocked_count?: number;
  coins_paid?: number;
};

const ICONS = ['trophy', 'call', 'coin', 'invite', 'flame', 'gift'];

const TIERS: { id: Tier; label: string; color: string }[] = [
  { id: 'bronze',   label: 'Bronze',   color: '#B87333' },
  { id: 'silver',   label: 'Silver',   color: '#94A3B8' },
  { id: 'gold',     label: 'Gold',     color: '#F59E0B' },
  { id: 'platinum', label: 'Platinum', color: '#8B5CF6' },
];

const TRIGGER_TYPES: { id: string; label: string; verb: string; unit?: string }[] = [
  { id: 'complete_calls',   label: 'Complete calls',       verb: 'Complete',  unit: 'calls' },
  { id: 'talk_minutes',     label: 'Talk minutes',         verb: 'Talk for',  unit: 'minutes' },
  { id: 'spend_coins',      label: 'Spend coins on calls', verb: 'Spend',     unit: 'coins' },
  { id: 'coin_topup',       label: 'Purchased coins',      verb: 'Purchase',  unit: 'coins' },
  { id: 'coin_topup_count', label: 'Number of purchases',  verb: 'Complete',  unit: 'purchases' },
  { id: 'refer_friend',     label: 'Invite friends',       verb: 'Invite',    unit: 'friends' },
  { id: 'daily_checkin',    label: 'Daily check-ins',      verb: 'Check in',  unit: 'days' },
  { id: 'watch_ad',         label: 'Watch rewarded ads',   verb: 'Watch',     unit: 'ads' },
  { id: 'share_app',        label: 'Share the app',        verb: 'Share',     unit: 'times' },
];

function tierColor(t: string): string {
  return TIERS.find((x) => x.id === t)?.color ?? '#94A3B8';
}

function triggerLabel(type: string, threshold: number): string {
  const t = TRIGGER_TYPES.find((x) => x.id === type);
  if (!t) return `${type} ${threshold}`;
  const unit = t.unit ?? t.label.replace(/^\w+\s/, '').toLowerCase();
  return `${t.verb} ${threshold.toLocaleString()} ${unit}`;
}

type Form = {
  code: string;
  title: string;
  description: string;
  icon: string;
  tier: Tier;
  trigger_type: string;
  trigger_threshold: number;
  coins_reward: number;
  active: boolean;
  sort_order: number;
  // Rolling-window duration. 0 = evergreen (never expires).
  // Default 7 for new achievements so they behave as weekly quests.
  duration_days: number;
};

function blank(): Form {
  return {
    code: '',
    title: '',
    description: '',
    icon: 'trophy',
    tier: 'bronze',
    trigger_type: 'complete_calls',
    trigger_threshold: 10,
    coins_reward: 100,
    active: true,
    sort_order: 100,
    duration_days: 7,
  };
}

export default function RewardAchievements() {
  const [rows, setRows] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [editing, setEditing] = useState<Achievement | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Form>(blank());
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.rewardAchievements()
      .then((d) => { setRows(d as Achievement[]); setFetchError(''); })
      .catch(() => setFetchError('Failed to load achievements'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title.trim() || !form.code.trim()) {
      toast.error('Code and title are required');
      return;
    }
    if (!Number.isFinite(form.trigger_threshold) || form.trigger_threshold <= 0) {
      toast.error('Trigger threshold must be greater than 0');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateRewardAchievement(editing.id, form);
        toast.success('Achievement updated');
        setEditing(null);
      } else {
        await api.createRewardAchievement(form);
        toast.success('Achievement created');
        setCreating(false);
      }
      setForm(blank());
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not save achievement';
      toast.error(msg);
    } finally { setSaving(false); }
  };

  const toggle = async (id: string) => {
    const a = rows.find((r) => r.id === id);
    if (!a || togglingId === id) return;
    setTogglingId(id);
    try {
      await api.updateRewardAchievement(id, { active: !a.active });
      load();
    } catch { toast.error('Could not toggle'); }
    finally { setTogglingId(null); }
  };

  const remove = async (id: string) => {
    if (deletingId === id) return;
    if (!confirm('Delete this achievement? Users who already unlocked it will keep their record but lose the badge.')) return;
    setDeletingId(id);
    try {
      await api.deleteRewardAchievement(id);
      toast.success('Achievement deleted');
      load();
    } catch { toast.error('Could not delete'); }
    finally { setDeletingId(null); }
  };

  const openEdit = (a: Achievement) => {
    setEditing(a);
    setForm({
      code: a.code,
      title: a.title,
      description: a.description ?? '',
      icon: a.icon || 'trophy',
      tier: (TIERS.some((t) => t.id === a.tier) ? a.tier : 'bronze') as Tier,
      trigger_type: a.trigger_type,
      trigger_threshold: Number(a.trigger_threshold),
      coins_reward: Number(a.coins_reward ?? 0),
      active: !!a.active,
      sort_order: Number(a.sort_order ?? 100),
      duration_days: Math.max(0, Number(a.duration_days ?? 7)),
    });
  };

  const AchievementForm = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Title *</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Social Butterfly" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Code (unique) *</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="social_butterfly" value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
            disabled={!!editing} />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1.5">Description</label>
        <textarea className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          rows={2} placeholder="Completed 50 calls." value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Icon</label>
          <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
            {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Tier</label>
          <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as Tier })}>
            {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Sort order</label>
          <input type="number"
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Trigger type</label>
          <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.trigger_type} onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}>
            {TRIGGER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Threshold</label>
          <input type="number" min={1}
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.trigger_threshold}
            onChange={(e) => setForm({ ...form, trigger_threshold: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Coins reward</label>
          <input type="number" min={0}
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.coins_reward}
            onChange={(e) => setForm({ ...form, coins_reward: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1.5">Duration (days)</label>
        <input type="number" min={0} max={365}
          className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={form.duration_days}
          onChange={(e) => setForm({ ...form, duration_days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
        <p className="text-[10px] text-muted-foreground mt-1">
          Rolling window from a user's first progress. <strong>7</strong> = weekly quest (default).
          <strong>0</strong> = evergreen (no expiry).
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        <span>Active (visible to users)</span>
      </label>

      <div className="flex gap-2 pt-2">
        <button onClick={save} disabled={!form.title || !form.code || saving}
          className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving...' : editing ? 'Update Achievement' : 'Create Achievement'}
        </button>
        <button onClick={() => { setEditing(null); setCreating(false); setForm(blank()); }}
          className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
      </div>
    </div>
  );

  const totalUnlocked = rows.reduce((s, r) => s + Number(r.unlocked_count ?? 0), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.coins_paid ?? 0), 0);
  const activeCount = rows.filter((r) => !!r.active).length;

  return (
    <div className="space-y-5">
      {fetchError && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          ⚠ {fetchError}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Achievements</h2>
          <p className="text-sm text-muted-foreground">Silent milestones that unlock as users hit engagement thresholds.</p>
        </div>
        <button onClick={() => { setCreating(true); setForm(blank()); }}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
          <Plus size={15} /> New Achievement
        </button>
      </div>

      {/* Aggregate summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Medal size={12} /> Active achievements</div>
          <p className="mt-2 font-bold text-xl">{activeCount}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users size={12} /> Total unlocks</div>
          <p className="mt-2 font-bold text-xl">{totalUnlocked.toLocaleString()}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Coins size={12} /> Coins paid out</div>
          <p className="mt-2 font-bold text-xl">{totalPaid.toLocaleString()}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <p className="font-semibold text-sm">No achievements yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click "New Achievement" to create the first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {rows.map((a) => {
            const color = tierColor(String(a.tier));
            return (
              <div key={a.id} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-bold text-sm">{a.title}</p>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${color}22`, color }}
                      >
                        {String(a.tier)}
                      </span>
                      <Badge variant={a.active ? 'active' : 'default'}>{a.active ? 'Active' : 'Inactive'}</Badge>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">icon: {a.icon}</span>
                    </div>
                    {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                      <span>Trigger: <strong className="text-foreground">{triggerLabel(a.trigger_type, Number(a.trigger_threshold))}</strong></span>
                      <span>Reward: <strong className="text-foreground">+{Number(a.coins_reward)} coins</strong></span>
                      <span>Duration: <strong className="text-foreground">
                        {Number(a.duration_days ?? 0) > 0 ? `${a.duration_days} days` : 'Evergreen'}
                      </strong></span>
                      <span>Unlocked: <strong className="text-foreground">{Number(a.unlocked_count ?? 0).toLocaleString()}</strong></span>
                      <span>Paid: <strong className="text-foreground">{Number(a.coins_paid ?? 0).toLocaleString()}</strong></span>
                      <span className="text-muted-foreground/60">code: <code>{a.code}</code></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggle(a.id)} disabled={togglingId === a.id}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary disabled:opacity-40" title="Toggle active">
                      {a.active ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button onClick={() => openEdit(a)}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary" title="Edit">
                      <Edit2 size={15} />
                    </button>
                    <button onClick={() => remove(a.id)} disabled={deletingId === a.id}
                      className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-500 disabled:opacity-40" title="Delete">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={creating || !!editing}
        onClose={() => { setEditing(null); setCreating(false); setForm(blank()); }}
        title={editing ? 'Edit Achievement' : 'Create Achievement'}
        width="max-w-lg"
      >
        <AchievementForm />
      </Modal>
    </div>
  );
}
