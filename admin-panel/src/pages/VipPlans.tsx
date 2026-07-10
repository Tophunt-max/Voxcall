import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Plus, Edit2, Trash2, Crown, Percent, Gift, MessageCircle, Users, Check, Zap, LifeBuoy, Sparkles } from 'lucide-react';

const empty = {
  tier: '',
  name: '',
  price_coins: '',
  duration_days: '30',
  call_discount_pct: '0',
  daily_bonus_coins: '0',
  signup_bonus_coins: '0',
  daily_free_minutes: '0',
  badge: '👑',
  color: '#A855F7',
  perks: '',
  chat_unlock: true,
  priority_matching: false,
  priority_support: false,
  profile_frame: false,
  is_active: true,
  sort_order: '0',
};

function parsePerks(raw: any): string[] {
  try {
    const arr = JSON.parse(raw ?? '[]');
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function PlanCard({ plan, onEdit, onDelete }: { plan: any; onEdit: () => void; onDelete: () => void }) {
  const perks = parsePerks(plan.perks);
  const color = plan.color || '#A855F7';
  return (
    <div className="relative bg-card border-2 rounded-2xl overflow-hidden transition-shadow hover:shadow-lg" style={{ borderColor: color + '55' }}>
      <div className="p-5 text-white" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-lg flex items-center gap-2"><span className="text-xl">{plan.badge || '👑'}</span>{plan.name}</p>
            <p className="text-white/80 text-xs mt-0.5">tier: {plan.tier} · {plan.duration_days} days</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black leading-none">{Number(plan.price_coins).toLocaleString()}</p>
            <p className="text-white/80 text-xs">coins</p>
          </div>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className="flex items-center gap-1 text-xs font-semibold bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full"><Percent size={11} />{plan.call_discount_pct}% off calls</span>
          <span className="flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-700 px-2 py-1 rounded-full"><Gift size={11} />{plan.daily_bonus_coins}/day</span>
          {plan.chat_unlock ? <span className="flex items-center gap-1 text-xs font-semibold bg-violet-50 text-violet-700 px-2 py-1 rounded-full"><MessageCircle size={11} />Chat unlock</span> : null}
          {plan.priority_matching ? <span className="flex items-center gap-1 text-xs font-semibold bg-blue-50 text-blue-700 px-2 py-1 rounded-full"><Zap size={11} />Priority match</span> : null}
          {plan.priority_support ? <span className="flex items-center gap-1 text-xs font-semibold bg-rose-50 text-rose-700 px-2 py-1 rounded-full"><LifeBuoy size={11} />Priority support</span> : null}
          {plan.profile_frame ? <span className="flex items-center gap-1 text-xs font-semibold bg-fuchsia-50 text-fuchsia-700 px-2 py-1 rounded-full"><Sparkles size={11} />Profile frame</span> : null}
        </div>
        {perks.length > 0 && (
          <ul className="space-y-1">
            {perks.map((p, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground"><Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />{p}</li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${plan.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
            {plan.is_active ? 'Active' : 'Inactive'}
          </span>
          <div className="flex gap-1">
            <button onClick={onEdit} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-lg transition-colors"><Edit2 size={12} /> Edit</button>
            <button onClick={onDelete} className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors"><Trash2 size={12} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VipPlans() {
  const [plans, setPlans] = useState<any[]>([]);
  const [subscribers, setSubscribers] = useState(0);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.vipPlans().then(setPlans).catch(() => {}).finally(() => setLoading(false));
    api.vipSubscribers().then((s) => setSubscribers(Array.isArray(s) ? s.length : 0)).catch(() => {});
  };
  useEffect(load, []);

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({
      tier: p.tier,
      name: p.name,
      price_coins: String(p.price_coins),
      duration_days: String(p.duration_days),
      call_discount_pct: String(p.call_discount_pct),
      daily_bonus_coins: String(p.daily_bonus_coins),
      signup_bonus_coins: String(p.signup_bonus_coins ?? 0),
      daily_free_minutes: String(p.daily_free_minutes ?? 0),
      badge: p.badge || '',
      color: p.color || '#A855F7',
      perks: parsePerks(p.perks).join('\n'),
      chat_unlock: !!plan_bool(p.chat_unlock),
      priority_matching: !!plan_bool(p.priority_matching),
      priority_support: !!plan_bool(p.priority_support),
      profile_frame: !!plan_bool(p.profile_frame),
      is_active: p.is_active !== 0,
      sort_order: String(p.sort_order ?? 0),
    });
  };

  const save = async () => {
    const priceVal = parseInt(form.price_coins);
    if (!editing?.id && !/^[a-z0-9_-]{2,20}$/.test(form.tier.trim().toLowerCase())) {
      toast.error('Tier must be 2-20 lowercase letters/numbers, no spaces (e.g. gold)');
      return;
    }
    if (!form.name.trim()) { toast.error('Plan name is required'); return; }
    if (isNaN(priceVal) || priceVal < 0) { toast.error('Price (coins) must be a valid number'); return; }

    const perksArr = form.perks.split('\n').map((s) => s.trim()).filter(Boolean);
    const data: any = {
      name: form.name.trim(),
      price_coins: priceVal,
      duration_days: parseInt(form.duration_days) || 30,
      call_discount_pct: parseInt(form.call_discount_pct) || 0,
      daily_bonus_coins: parseInt(form.daily_bonus_coins) || 0,
      signup_bonus_coins: parseInt(form.signup_bonus_coins) || 0,
      daily_free_minutes: parseInt(form.daily_free_minutes) || 0,
      badge: form.badge.trim() || null,
      color: form.color || null,
      perks: perksArr,
      chat_unlock: form.chat_unlock ? 1 : 0,
      priority_matching: form.priority_matching ? 1 : 0,
      priority_support: form.priority_support ? 1 : 0,
      profile_frame: form.profile_frame ? 1 : 0,
      is_active: form.is_active ? 1 : 0,
      sort_order: parseInt(form.sort_order) || 0,
    };
    if (!editing?.id) data.tier = form.tier.trim().toLowerCase();

    setSaving(true);
    try {
      if (editing?.id) await api.updateVipPlan(editing.id, data);
      else await api.createVipPlan(data);
      toast.success(editing?.id ? 'VIP plan updated' : 'VIP plan created');
      setEditing(null); setForm(empty); load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const deletePlan = async (id: string, name: string) => {
    if (deletingId) return;
    if (!confirm(`Delete "${name}" VIP plan? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await api.deleteVipPlan(id);
      toast.success('VIP plan deleted');
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setDeletingId(null); }
  };

  const numFields = [
    { key: 'price_coins', label: 'Price (coins)', placeholder: '2499' },
    { key: 'duration_days', label: 'Duration (days)', placeholder: '30' },
    { key: 'call_discount_pct', label: 'Call discount (%)', placeholder: '10' },
    { key: 'daily_bonus_coins', label: 'Daily bonus coins', placeholder: '60' },
    { key: 'signup_bonus_coins', label: 'Signup bonus coins', placeholder: '300' },
    { key: 'daily_free_minutes', label: 'Daily free minutes', placeholder: '5' },
    { key: 'sort_order', label: 'Sort order', placeholder: '0' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Crown size={18} className="text-violet-500" /> VIP Plans</h2>
          <p className="text-sm text-muted-foreground">{plans.length} plans · <span className="inline-flex items-center gap-1"><Users size={12} />{subscribers} active members</span></p>
        </div>
        <button
          onClick={() => { setEditing({}); setForm(empty); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
        >
          <Plus size={16} /> Add VIP Plan
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : plans.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No VIP plans yet. Click "Add VIP Plan" to create one.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((p) => <PlanCard key={p.id} plan={p} onEdit={() => openEdit(p)} onDelete={() => deletePlan(p.id, p.name)} />)}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit VIP Plan' : 'New VIP Plan'}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold block mb-1.5">Tier (unique key)</label>
            <input
              type="text" placeholder="e.g. gold"
              value={form.tier}
              disabled={!!editing?.id}
              onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            />
            <p className="text-xs text-muted-foreground mt-1">{editing?.id ? 'Tier is fixed after creation (links active subscribers to perks).' : 'Lowercase, no spaces. Cannot be changed later.'}</p>
          </div>

          <div>
            <label className="text-sm font-semibold block mb-1.5">Plan Name</label>
            <input type="text" placeholder="Gold VIP" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {numFields.map((f) => (
              <div key={f.key}>
                <label className="text-sm font-semibold block mb-1.5">{f.label}</label>
                <input type="number" placeholder={f.placeholder} value={(form as any)[f.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Badge (emoji)</label>
              <input type="text" placeholder="👑" value={form.badge}
                onChange={(e) => setForm((f) => ({ ...f, badge: e.target.value }))}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Accent colour</label>
              <input type="color" value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="w-full h-[42px] border border-border rounded-xl px-2 bg-background" />
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold block mb-1.5">Perks (one per line)</label>
            <textarea rows={5} placeholder={"Gold VIP badge\n10% off every call\n60 free coins daily\nChat any host without calling first"}
              value={form.perks}
              onChange={(e) => setForm((f) => ({ ...f, perks: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y" />
            <p className="text-xs text-muted-foreground mt-1">These are shown to users on the VIP screen.</p>
          </div>

          <div>
            <label className="text-sm font-semibold block mb-2">Perks (enforced by the app)</label>
            <div className="grid grid-cols-2 gap-2.5">
              {([
                { key: 'chat_unlock', label: 'Chat unlock', hint: 'DM any host without calling first' },
                { key: 'priority_matching', label: 'Priority matching', hint: 'Matched with higher-quality hosts' },
                { key: 'priority_support', label: 'Priority support', hint: 'Support tickets flagged high-priority' },
                { key: 'profile_frame', label: 'Exclusive profile frame', hint: 'Special frame around the avatar' },
              ] as const).map((t) => (
                <label key={t.key} className="flex items-start gap-2.5 cursor-pointer border border-border rounded-xl px-3 py-2.5 hover:bg-secondary/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={(form as any)[t.key]}
                    onChange={(e) => setForm((f) => ({ ...f, [t.key]: e.target.checked }))}
                    className="w-4 h-4 rounded accent-violet-600 mt-0.5"
                  />
                  <span className="leading-tight">
                    <span className="text-sm font-medium block">{t.label}</span>
                    <span className="text-[11px] text-muted-foreground">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Toggle the actual benefits this plan unlocks. The free-text perks above are only the marketing copy shown to users.</p>
          </div>

          <div className="flex gap-5 pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 rounded accent-violet-600" />
              <span className="text-sm font-medium">Active</span>
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={saving} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving...' : editing?.id ? 'Update Plan' : 'Create Plan'}
            </button>
            <button onClick={() => setEditing(null)} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// chat_unlock may arrive as 1/0 (number) or true/false — normalize.
function plan_bool(v: any): boolean {
  return v === 1 || v === true || v === '1';
}
