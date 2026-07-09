import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Plus, Trash2, Edit2, Eye, EyeOff, Zap, Calendar, Clock } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Reward Campaigns admin
// ─────────────────────────────────────────────────────────────────────────────
// CRUD for time-limited multiplier campaigns (migration 0044).
// A campaign is active when starts_at <= now <= ends_at AND active = 1.
// The backend applies the multiplier on top of every claim + spin win
// (unless applies_to_task_types filters that particular claim out).

type Campaign = {
  id: string;
  code: string;
  title: string;
  description: string;
  banner_image_url: string;
  starts_at: number;
  ends_at: number;
  multiplier: number;
  applies_to_task_types: string;   // CSV
  applies_to_spin: number | boolean;
  active: number | boolean;
  created_at?: number;
  active_now?: number | boolean;
};

type Form = {
  code: string;
  title: string;
  description: string;
  banner_image_url: string;
  starts_at: string;                // datetime-local string
  ends_at: string;                  // datetime-local string
  multiplier: number;
  applies_to_task_types: string;    // CSV
  applies_to_spin: boolean;
  active: boolean;
};

function blank(): Form {
  const now = new Date();
  const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    code: '',
    title: '',
    description: '',
    banner_image_url: '',
    starts_at: toLocalInput(now),
    ends_at: toLocalInput(inSevenDays),
    multiplier: 2,
    applies_to_task_types: '',
    applies_to_spin: true,
    active: true,
  };
}

// Convert a JS Date → "YYYY-MM-DDTHH:mm" (datetime-local input value).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert unix seconds → datetime-local input string.
function unixToLocalInput(sec: number | undefined | null): string {
  if (!sec || !Number.isFinite(Number(sec))) return '';
  return toLocalInput(new Date(Number(sec) * 1000));
}

// Convert datetime-local input string → unix seconds.
function localInputToUnix(s: string): number {
  if (!s) return 0;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function formatDate(sec: number): string {
  if (!sec) return '—';
  const d = new Date(Number(sec) * 1000);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function RewardCampaigns() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Form>(blank());
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.rewardCampaigns()
      .then((d) => { setRows(d as Campaign[]); setFetchError(''); })
      .catch(() => setFetchError('Failed to load campaigns'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title.trim() || !form.code.trim()) {
      toast.error('Code and title are required');
      return;
    }
    const starts = localInputToUnix(form.starts_at);
    const ends = localInputToUnix(form.ends_at);
    if (!starts || !ends) { toast.error('Start and end times are required'); return; }
    if (ends <= starts) { toast.error('End time must be after start time'); return; }
    if (!Number.isFinite(form.multiplier) || form.multiplier <= 0) {
      toast.error('Multiplier must be greater than 0');
      return;
    }

    const payload = {
      code: form.code.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      banner_image_url: form.banner_image_url.trim(),
      starts_at: starts,
      ends_at: ends,
      multiplier: form.multiplier,
      applies_to_task_types: form.applies_to_task_types
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(','),
      applies_to_spin: form.applies_to_spin,
      active: form.active,
    };

    setSaving(true);
    try {
      if (editing) {
        await api.updateRewardCampaign(editing.id, payload);
        toast.success('Campaign updated');
        setEditing(null);
      } else {
        await api.createRewardCampaign(payload);
        toast.success('Campaign created');
        setCreating(false);
      }
      setForm(blank());
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not save campaign';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string) => {
    const c = rows.find((r) => r.id === id);
    if (!c || togglingId === id) return;
    setTogglingId(id);
    try {
      await api.updateRewardCampaign(id, { active: !c.active });
      load();
    } catch { toast.error('Could not toggle'); }
    finally { setTogglingId(null); }
  };

  const remove = async (id: string) => {
    if (deletingId === id) return;
    if (!confirm('Delete this campaign? Existing users who saw the multiplier will not be affected retroactively.')) return;
    setDeletingId(id);
    try {
      await api.deleteRewardCampaign(id);
      toast.success('Campaign deleted');
      load();
    } catch { toast.error('Could not delete'); }
    finally { setDeletingId(null); }
  };

  const openEdit = (c: Campaign) => {
    setEditing(c);
    setForm({
      code: c.code,
      title: c.title,
      description: c.description ?? '',
      banner_image_url: c.banner_image_url ?? '',
      starts_at: unixToLocalInput(c.starts_at),
      ends_at: unixToLocalInput(c.ends_at),
      multiplier: Number(c.multiplier ?? 1),
      applies_to_task_types: c.applies_to_task_types ?? '',
      applies_to_spin: !!c.applies_to_spin,
      active: !!c.active,
    });
  };

  const CampaignForm = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Title *</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Diwali Bonanza" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Code (unique) *</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="diwali_bonanza" value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
            disabled={!!editing} />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1.5">Description</label>
        <textarea className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          rows={2} placeholder="Double coins on every task for the festive week!"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1.5">Banner image URL (optional)</label>
        <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="https://…" value={form.banner_image_url}
          onChange={(e) => setForm({ ...form, banner_image_url: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Starts at *</label>
          <input type="datetime-local"
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.starts_at}
            onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Ends at *</label>
          <input type="datetime-local"
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.ends_at}
            onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Multiplier</label>
          <input type="number" min={1} max={20} step={0.5}
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.multiplier}
            onChange={(e) => setForm({ ...form, multiplier: Number(e.target.value) })} />
          <p className="text-[10px] text-muted-foreground mt-1">×2 = double coins. Range 1–20.</p>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Applies to task types</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. complete_calls,refer_friend (leave empty for all)"
            value={form.applies_to_task_types}
            onChange={(e) => setForm({ ...form, applies_to_task_types: e.target.value })} />
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.applies_to_spin}
            onChange={(e) => setForm({ ...form, applies_to_spin: e.target.checked })} />
          <span>Applies to spin wins</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          <span>Active</span>
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={save} disabled={!form.title || !form.code || saving}
          className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving...' : editing ? 'Update Campaign' : 'Create Campaign'}
        </button>
        <button onClick={() => { setEditing(null); setCreating(false); setForm(blank()); }}
          className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
      </div>
    </div>
  );

  const now = Math.floor(Date.now() / 1000);
  const activeNow = rows.filter((r) => r.active_now || (r.active && r.starts_at <= now && r.ends_at >= now)).length;
  const upcoming = rows.filter((r) => r.active && r.starts_at > now).length;

  return (
    <div className="space-y-5">
      {fetchError && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          ⚠ {fetchError}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Reward Campaigns</h2>
          <p className="text-sm text-muted-foreground">Time-limited multipliers layered on top of tasks and spin wins.</p>
        </div>
        <button onClick={() => { setCreating(true); setForm(blank()); }}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
          <Plus size={15} /> New Campaign
        </button>
      </div>

      {/* Aggregate summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Zap size={12} /> Total campaigns</div>
          <p className="mt-2 font-bold text-xl">{rows.length}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Calendar size={12} /> Active now</div>
          <p className="mt-2 font-bold text-xl">{activeNow}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock size={12} /> Upcoming</div>
          <p className="mt-2 font-bold text-xl">{upcoming}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <p className="font-semibold text-sm">No campaigns yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click "New Campaign" to create the first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {rows.map((c) => {
            const taskTypes = (c.applies_to_task_types || '').split(',').map((s) => s.trim()).filter(Boolean);
            const isActiveNow = !!c.active_now || (!!c.active && c.starts_at <= now && c.ends_at >= now);
            return (
              <div key={c.id} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-bold text-sm">{c.title}</p>
                      {isActiveNow && <Badge variant="active">ACTIVE NOW</Badge>}
                      <Badge variant={c.active ? 'active' : 'default'}>{c.active ? 'Enabled' : 'Disabled'}</Badge>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold">×{Number(c.multiplier)}</span>
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                      <span><Calendar size={11} className="inline mr-1" />{formatDate(c.starts_at)} → {formatDate(c.ends_at)}</span>
                      {c.applies_to_spin ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Includes spin</span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Tasks only</span>
                      )}
                      <span className="text-muted-foreground/60">code: <code>{c.code}</code></span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {taskTypes.length === 0 ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">All tasks</span>
                      ) : taskTypes.map((t) => (
                        <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{t}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggle(c.id)} disabled={togglingId === c.id}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary disabled:opacity-40" title="Toggle active">
                      {c.active ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button onClick={() => openEdit(c)}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary" title="Edit">
                      <Edit2 size={15} />
                    </button>
                    <button onClick={() => remove(c.id)} disabled={deletingId === c.id}
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
        title={editing ? 'Edit Campaign' : 'Create Campaign'}
        width="max-w-lg"
      >
        <CampaignForm />
      </Modal>
    </div>
  );
}
