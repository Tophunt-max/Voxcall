import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Plus, Trash2, Edit2, Eye, EyeOff, Coins, Users, Trophy } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Reward Tasks admin
// ─────────────────────────────────────────────────────────────────────────────
// CRUD for the reward_tasks table. Each task defines a coin-earning action
// users can complete inside the app (daily check-in, complete calls, invite
// friends, etc). See migration 0043_reward_tasks.sql for the schema.

// task_type controls how the backend increments progress:
//   • daily_checkin    — auto-completes on claim (target 1)
//   • complete_calls   — incremented server-side after each successful call
//   • spend_coins      — incremented by coins spent per call
//   • refer_friend     — incremented on referral verification
//   • watch_ad         — incremented via client `track` event
//   • share_app        — incremented via client `track` event
const TASK_TYPES = [
  { id: 'daily_checkin',  label: 'Daily Check-in' },
  { id: 'complete_calls', label: 'Complete N Calls' },
  { id: 'spend_coins',    label: 'Spend N Coins' },
  { id: 'refer_friend',   label: 'Invite N Friends' },
  { id: 'watch_ad',       label: 'Watch a Rewarded Ad' },
  { id: 'share_app',      label: 'Share the App' },
];

const CATEGORIES = [
  { id: 'daily',     label: 'Daily (repeatable each day)' },
  { id: 'monthly',   label: 'Monthly (accumulates & resets each month)' },
  { id: 'one_time',  label: 'One-time (claim once, ever)' },
  { id: 'ongoing',   label: 'Ongoing (progress carries forward)' },
];

// Who the task targets. VIP-only tasks stay VISIBLE to free users (rendered
// locked 🔒) as an upsell; free-only tasks are hidden from VIP members.
const AUDIENCES = [
  { id: 'all',  label: 'All users' },
  { id: 'vip',  label: 'VIP only (free users see it locked 🔒)' },
  { id: 'free', label: 'Free users only (hidden from VIP)' },
];

const ICONS = ['calendar', 'call', 'invite', 'coin', 'video', 'share', 'gift'];

function blank() {
  return {
    code: '',
    title: '',
    description: '',
    icon: 'gift',
    category: 'daily',
    task_type: 'daily_checkin',
    target_count: 1,
    coins_reward: 10,
    cooldown_hours: 24,
    cta_link: '',
    active: true,
    sort_order: 100,
    audience: 'all',
  };
}

type Task = {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  task_type: string;
  target_count: number;
  coins_reward: number;
  cooldown_hours: number;
  cta_link: string;
  active: number | boolean;
  sort_order: number;
  audience?: string;
  user_count?: number;
  claim_count?: number;
  coins_paid?: number;
};

export default function RewardTasks() {
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ReturnType<typeof blank>>(blank());
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.rewardTasks()
      .then((d) => { setRows(d as Task[]); setFetchError(''); })
      .catch(() => setFetchError('Failed to load reward tasks'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title || !form.code || form.coins_reward == null) {
      toast.error('Title, code and coins are required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateRewardTask(editing.id, form);
        toast.success('Reward task updated');
        setEditing(null);
      } else {
        await api.createRewardTask(form);
        toast.success('Reward task created');
        setCreating(false);
      }
      setForm(blank());
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save reward task');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string) => {
    const t = rows.find((r) => r.id === id);
    if (!t || togglingId === id) return;
    setTogglingId(id);
    try {
      await api.updateRewardTask(id, { active: !t.active });
      load();
    } catch { toast.error('Could not toggle'); }
    finally { setTogglingId(null); }
  };

  const remove = async (id: string) => {
    if (deletingId === id) return;
    if (!confirm('Delete this reward task? All user progress on this task will be discarded.')) return;
    setDeletingId(id);
    try {
      await api.deleteRewardTask(id);
      toast.success('Reward task deleted');
      load();
    } catch { toast.error('Could not delete'); }
    finally { setDeletingId(null); }
  };

  // Sensible defaults for cooldown when the admin switches task type.
  const onTaskTypeChange = (task_type: string) => {
    const cooldown_hours =
      task_type === 'daily_checkin' ? 24 :
      task_type === 'watch_ad'      ? 4  :
      task_type === 'share_app'     ? 24 :
      0;
    const category =
      task_type === 'daily_checkin' || task_type === 'watch_ad' || task_type === 'share_app'
        ? 'daily'
        : (form.category === 'daily' ? 'ongoing' : form.category);
    setForm({ ...form, task_type, cooldown_hours, category });
  };

  const TaskForm = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Title *</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Daily Check-in" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Code (unique) *</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="daily_checkin" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
            disabled={!!editing} />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1.5">Description</label>
        <textarea className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          rows={2} placeholder="Open the app and claim your daily bonus" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Task Type</label>
          <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.task_type} onChange={e => onTaskTypeChange(e.target.value)}>
            {TASK_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Category</label>
          <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1.5">Audience 👥</label>
        <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
          value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}>
          {AUDIENCES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <p className="text-[10px] text-muted-foreground mt-1">VIP-only tasks stay visible to free users with a 🔒 "Unlock with VIP" button — great for driving upgrades.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Target Count</label>
          <input type="number" min={1} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.target_count} onChange={e => setForm({ ...form, target_count: Math.max(1, Number(e.target.value)) })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Coins Reward</label>
          <input type="number" min={0} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.coins_reward} onChange={e => setForm({ ...form, coins_reward: Math.max(0, Number(e.target.value)) })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Cooldown (hours)</label>
          <input type="number" min={0} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.cooldown_hours} onChange={e => setForm({ ...form, cooldown_hours: Math.max(0, Number(e.target.value)) })} />
          <p className="text-[10px] text-muted-foreground mt-1">0 = one-time. 24 = daily. 168 = weekly.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Icon</label>
          <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })}>
            {ICONS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Sort Order</label>
          <input type="number" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            value={form.sort_order} onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1.5">CTA Link (optional deep link)</label>
        <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
          placeholder="/user/referral" value={form.cta_link} onChange={e => setForm({ ...form, cta_link: e.target.value })} />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
        <span>Active (visible to users)</span>
      </label>

      <div className="flex gap-2 pt-2">
        <button onClick={save} disabled={!form.title || !form.code || saving}
          className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving...' : editing ? 'Update Task' : 'Create Task'}
        </button>
        <button onClick={() => { setEditing(null); setCreating(false); setForm(blank()); }}
          className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
      </div>
    </div>
  );

  const totalPaid = rows.reduce((s, r) => s + Number(r.coins_paid ?? 0), 0);
  const totalClaims = rows.reduce((s, r) => s + Number(r.claim_count ?? 0), 0);
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
          <h2 className="font-bold text-lg">Reward Tasks</h2>
          <p className="text-sm text-muted-foreground">Coin-earning tasks shown on the user Rewards page.</p>
        </div>
        <button onClick={() => { setCreating(true); setForm(blank()); }}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
          <Plus size={15} /> New Task
        </button>
      </div>

      {/* Aggregate summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Trophy size={12} /> Active tasks</div>
          <p className="mt-2 font-bold text-xl">{activeCount}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users size={12} /> Total claims</div>
          <p className="mt-2 font-bold text-xl">{totalClaims.toLocaleString()}</p>
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
          <p className="font-semibold text-sm">No reward tasks yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click "New Task" to create the first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {rows.map((t) => (
            <div key={t.id} className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="font-bold text-sm">{t.title}</p>
                    <Badge variant={t.active ? 'active' : 'inactive'}>{t.active ? 'Active' : 'Inactive'}</Badge>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{TASK_TYPES.find(x => x.id === t.task_type)?.label ?? t.task_type}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{t.category}</span>
                    {t.audience === 'vip' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">👑 VIP only</span>}
                    {t.audience === 'free' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">🆓 Free only</span>}
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span>Target: <strong className="text-foreground">{t.target_count}</strong></span>
                    <span>Reward: <strong className="text-foreground">+{t.coins_reward} coins</strong></span>
                    <span>Cooldown: <strong className="text-foreground">{t.cooldown_hours}h</strong></span>
                    <span>Claims: <strong className="text-foreground">{Number(t.claim_count ?? 0).toLocaleString()}</strong></span>
                    <span>Users: <strong className="text-foreground">{Number(t.user_count ?? 0).toLocaleString()}</strong></span>
                    <span>Paid: <strong className="text-foreground">{Number(t.coins_paid ?? 0).toLocaleString()}</strong> coins</span>
                    <span className="text-muted-foreground/60">code: <code>{t.code}</code></span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggle(t.id)} disabled={togglingId === t.id}
                    className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary disabled:opacity-40" title="Toggle active">
                    {t.active ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button onClick={() => { setEditing(t); setForm({
                      code: t.code, title: t.title, description: t.description ?? '',
                      icon: t.icon ?? 'gift', category: t.category, task_type: t.task_type,
                      target_count: Number(t.target_count), coins_reward: Number(t.coins_reward),
                      cooldown_hours: Number(t.cooldown_hours), cta_link: t.cta_link ?? '',
                      active: !!t.active, sort_order: Number(t.sort_order ?? 100),
                      audience: t.audience ?? 'all',
                    }); }}
                    className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary" title="Edit">
                    <Edit2 size={15} />
                  </button>
                  <button onClick={() => remove(t.id)} disabled={deletingId === t.id}
                    className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-500 disabled:opacity-40" title="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={creating || !!editing}
        onClose={() => { setEditing(null); setCreating(false); setForm(blank()); }}
        title={editing ? 'Edit Reward Task' : 'Create Reward Task'}
      >
        <TaskForm />
      </Modal>
    </div>
  );
}
