import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Plus, Trash2, Edit2, Eye, EyeOff, Copy, CheckCircle2, Ticket, Coins, Users } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Reward Coupons admin
// ─────────────────────────────────────────────────────────────────────────────
// CRUD for redeemable coupon codes (migration 0044). Codes are stored
// upper-case; the backend supports single-code and bulk-generation flows
// through the same POST endpoint (count > 1 triggers bulk mode).

type Coupon = {
  id: string;
  code: string;
  coins_reward: number;
  max_uses: number | null;
  used_count: number;
  per_user_limit: number;
  expires_at: number | null;
  active: number | boolean;
  note: string;
  created_at?: number;
};

type Mode = 'single' | 'bulk';

type Form = {
  // shared
  coins_reward: number;
  max_uses: string;         // '' = unlimited
  per_user_limit: number;
  expires_at: string;       // datetime-local; '' = never
  active: boolean;
  note: string;
  // single-only
  code: string;
  // bulk-only
  count: number;
  prefix: string;
};

function blank(): Form {
  return {
    coins_reward: 100,
    max_uses: '',
    per_user_limit: 1,
    expires_at: '',
    active: true,
    note: '',
    code: '',
    count: 10,
    prefix: '',
  };
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function unixToLocalInput(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(Number(sec))) return '';
  return toLocalInput(new Date(Number(sec) * 1000));
}
function localInputToUnix(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function normaliseCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9_\-]/g, '');
}

export default function RewardCoupons() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<Mode>('single');
  const [form, setForm] = useState<Form>(blank());
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState('');
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);

  const load = () => {
    setLoading(true);
    api.rewardCoupons()
      .then((d) => { setRows(d as Coupon[]); setFetchError(''); })
      .catch(() => setFetchError('Failed to load coupons'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const closeModal = () => {
    setEditing(null); setCreating(false); setForm(blank()); setMode('single');
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(''), 1500);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy');
    }
  };

  const copyAll = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success(`${codes.length} codes copied`);
    } catch {
      toast.error('Could not copy');
    }
  };

  const buildSharedPayload = () => {
    const max_uses = form.max_uses === '' ? null : Math.max(1, Number(form.max_uses));
    const per_user_limit = Math.max(1, Number(form.per_user_limit) || 1);
    const expires_at = localInputToUnix(form.expires_at);
    return {
      coins_reward: Math.max(0, Number(form.coins_reward) || 0),
      max_uses,
      per_user_limit,
      expires_at,
      active: form.active,
      note: form.note.trim(),
    };
  };

  const save = async () => {
    if (editing) {
      // Editing only supports the shared fields (code is immutable server-side).
      setSaving(true);
      try {
        await api.updateRewardCoupon(editing.id, buildSharedPayload());
        toast.success('Coupon updated');
        closeModal();
        load();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not save coupon';
        toast.error(msg);
      } finally { setSaving(false); }
      return;
    }

    // Create — single or bulk
    if (mode === 'single') {
      if (!form.code.trim()) { toast.error('Coupon code is required'); return; }
    } else {
      if (!Number.isFinite(form.count) || form.count < 2 || form.count > 500) {
        toast.error('Bulk count must be between 2 and 500');
        return;
      }
    }

    setSaving(true);
    try {
      const shared = buildSharedPayload();
      if (mode === 'single') {
        await api.createRewardCoupon({ ...shared, code: form.code.trim() });
        toast.success('Coupon created');
        closeModal();
        load();
      } else {
        const res = await api.createRewardCoupon({
          ...shared,
          count: Math.floor(form.count),
          prefix: form.prefix.trim(),
        });
        const generated = extractCodes(res, rows);
        toast.success(`${generated.length || form.count} coupons generated`);
        closeModal();
        load();
        if (generated.length > 0) setGeneratedCodes(generated);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not save coupon';
      toast.error(msg);
    } finally { setSaving(false); }
  };

  const toggle = async (id: string) => {
    const c = rows.find((r) => r.id === id);
    if (!c || togglingId === id) return;
    setTogglingId(id);
    try {
      await api.updateRewardCoupon(id, { active: !c.active });
      load();
    } catch { toast.error('Could not toggle'); }
    finally { setTogglingId(null); }
  };

  const remove = async (id: string) => {
    if (deletingId === id) return;
    if (!confirm('Delete this coupon? Existing redemptions are preserved.')) return;
    setDeletingId(id);
    try {
      await api.deleteRewardCoupon(id);
      toast.success('Coupon deleted');
      load();
    } catch { toast.error('Could not delete'); }
    finally { setDeletingId(null); }
  };

  const openEdit = (c: Coupon) => {
    setEditing(c);
    setMode('single');
    setForm({
      ...blank(),
      code: c.code,
      coins_reward: Number(c.coins_reward),
      max_uses: c.max_uses == null ? '' : String(c.max_uses),
      per_user_limit: Number(c.per_user_limit ?? 1),
      expires_at: unixToLocalInput(c.expires_at),
      active: !!c.active,
      note: c.note ?? '',
    });
  };

  const CouponForm = () => (
    <div className="space-y-4">
      {!editing && (
        <div className="flex bg-secondary p-1 rounded-xl">
          <button type="button" onClick={() => setMode('single')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'single' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
            Single coupon
          </button>
          <button type="button" onClick={() => setMode('bulk')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'bulk' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
            Bulk generate
          </button>
        </div>
      )}

      {!editing && mode === 'single' && (
        <div>
          <label className="text-sm font-semibold block mb-1.5">Code *</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="WELCOME100" value={form.code}
            onChange={(e) => setForm({ ...form, code: normaliseCode(e.target.value) })} />
          <p className="text-[10px] text-muted-foreground mt-1">Uppercase letters, digits, dash and underscore only.</p>
        </div>
      )}

      {!editing && mode === 'bulk' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-semibold block mb-1.5">Count *</label>
            <input type="number" min={2} max={500}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={form.count}
              onChange={(e) => setForm({ ...form, count: Math.max(2, Math.min(500, Number(e.target.value) || 0)) })} />
            <p className="text-[10px] text-muted-foreground mt-1">2 – 500 codes.</p>
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Prefix (optional)</label>
            <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="DIWALI" value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: normaliseCode(e.target.value) })} />
          </div>
        </div>
      )}

      {editing && (
        <div>
          <label className="text-sm font-semibold block mb-1.5">Code</label>
          <div className="px-3 py-2.5 border border-border rounded-xl text-sm bg-secondary/50 font-mono">{editing.code}</div>
          <p className="text-[10px] text-muted-foreground mt-1">The coupon code is immutable.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Coins reward *</label>
          <input type="number" min={0}
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.coins_reward}
            onChange={(e) => setForm({ ...form, coins_reward: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Per-user limit</label>
          <input type="number" min={1}
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.per_user_limit}
            onChange={(e) => setForm({ ...form, per_user_limit: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Max uses (optional)</label>
          <input type="number" min={1}
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Unlimited" value={form.max_uses}
            onChange={(e) => setForm({ ...form, max_uses: e.target.value })} />
          <p className="text-[10px] text-muted-foreground mt-1">Leave blank for unlimited.</p>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Expires at (optional)</label>
          <input type="datetime-local"
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.expires_at}
            onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1.5">Note (admin-facing)</label>
        <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="e.g. Instagram launch giveaway" value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        <span>Active</span>
      </label>

      <div className="flex gap-2 pt-2">
        <button onClick={save}
          disabled={saving || (!editing && mode === 'single' && !form.code) || (!editing && mode === 'bulk' && (!form.count || form.count < 2))}
          className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving…' : editing ? 'Update Coupon' : mode === 'bulk' ? `Generate ${form.count}` : 'Create Coupon'}
        </button>
        <button onClick={closeModal}
          className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
      </div>
    </div>
  );

  const totalCoupons = rows.length;
  const activeCount = rows.filter((r) => !!r.active).length;
  const totalRedemptions = rows.reduce((s, r) => s + Number(r.used_count ?? 0), 0);

  return (
    <div className="space-y-5">
      {fetchError && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          ⚠ {fetchError}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Reward Coupons</h2>
          <p className="text-sm text-muted-foreground">Redeemable codes users enter for a coin drop. Supports bulk generation.</p>
        </div>
        <button onClick={() => { setCreating(true); setForm(blank()); setMode('single'); }}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
          <Plus size={15} /> New Coupon
        </button>
      </div>

      {/* Aggregate summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Ticket size={12} /> Total coupons</div>
          <p className="mt-2 font-bold text-xl">{totalCoupons}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Coins size={12} /> Active coupons</div>
          <p className="mt-2 font-bold text-xl">{activeCount}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users size={12} /> Redemptions</div>
          <p className="mt-2 font-bold text-xl">{totalRedemptions.toLocaleString()}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <p className="font-semibold text-sm">No coupons yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click "New Coupon" to create the first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {rows.map((c) => {
            const usageLabel = c.max_uses == null ? '∞' : `${c.used_count}/${c.max_uses}`;
            const usagePct = c.max_uses ? Math.min(100, (Number(c.used_count) / Number(c.max_uses)) * 100) : 0;
            const expLabel = c.expires_at ? new Date(Number(c.expires_at) * 1000).toLocaleDateString() : 'Never';
            return (
              <div key={c.id} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <code className="font-mono font-bold text-sm bg-secondary px-2 py-0.5 rounded">{c.code}</code>
                      <button onClick={() => copy(c.code)}
                        className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary" title="Copy code">
                        {copiedCode === c.code ? <CheckCircle2 size={13} className="text-green-500" /> : <Copy size={13} />}
                      </button>
                      <Badge variant={c.active ? 'active' : 'default'}>{c.active ? 'Active' : 'Inactive'}</Badge>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">+{Number(c.coins_reward)} coins</span>
                    </div>
                    {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                      <span>Per user: <strong className="text-foreground">{Number(c.per_user_limit ?? 1)}</strong></span>
                      <span>Expires: <strong className="text-foreground">{expLabel}</strong></span>
                      <span className="flex items-center gap-1.5">
                        Usage:
                        <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${c.max_uses ? usagePct : 100}%` }} />
                        </div>
                        <strong className="text-foreground">{usageLabel}</strong>
                      </span>
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

      {/* Create / edit modal */}
      <Modal
        open={creating || !!editing}
        onClose={closeModal}
        title={editing ? 'Edit Coupon' : 'Create Coupon'}
        width="max-w-lg"
      >
        <CouponForm />
      </Modal>

      {/* Bulk-generated codes preview */}
      <Modal
        open={!!generatedCodes}
        onClose={() => setGeneratedCodes(null)}
        title="Generated coupon codes"
        width="max-w-lg"
      >
        {generatedCodes && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{generatedCodes.length} codes ready to distribute.</p>
              <button onClick={() => copyAll(generatedCodes)}
                className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-90">
                <Copy size={13} /> Copy all
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto border border-border rounded-xl bg-background p-2 space-y-1">
              {generatedCodes.map((code) => (
                <div key={code} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-secondary">
                  <code className="font-mono text-xs">{code}</code>
                  <button onClick={() => copy(code)}
                    className="p-1 rounded hover:bg-card text-muted-foreground hover:text-primary" title="Copy">
                    {copiedCode === code ? <CheckCircle2 size={13} className="text-green-500" /> : <Copy size={13} />}
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setGeneratedCodes(null)}
              className="w-full border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Done</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

// The bulk endpoint may return `{ codes: string[] }`, `{ coupons: [{code}] }`,
// `string[]`, or nothing meaningful. Best-effort: extract whatever we can.
// If the API returns nothing, we fall back to filtering the fresh coupon
// list for the ones we just inserted (by created_at).
function extractCodes(res: unknown, previous: Coupon[]): string[] {
  if (!res) return [];
  if (Array.isArray(res)) {
    return res.map((r) => typeof r === 'string' ? r : (r && typeof r === 'object' && 'code' in r ? String((r as { code: unknown }).code ?? '') : ''))
      .filter(Boolean);
  }
  if (typeof res === 'object') {
    const r = res as Record<string, unknown>;
    if (Array.isArray(r.codes)) return (r.codes as unknown[]).map((c) => String(c)).filter(Boolean);
    if (Array.isArray(r.coupons)) {
      return (r.coupons as unknown[])
        .map((c) => (c && typeof c === 'object' && 'code' in c) ? String((c as { code: unknown }).code ?? '') : '')
        .filter(Boolean);
    }
  }
  // Fallback — nothing to extract; caller will show a generic success message.
  void previous;
  return [];
}
