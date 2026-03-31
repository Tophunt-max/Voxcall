import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Plus, Edit2, Zap, Star } from 'lucide-react';

const empty = { name: '', coins: '', price: '', bonus_coins: '0', is_popular: false, is_active: true };

interface PlanCardProps { plan: any; onEdit: () => void }

function PlanCard({ plan, onEdit }: PlanCardProps) {
  const gradients = ['gradient-purple', 'gradient-blue', 'gradient-green', 'gradient-orange', 'gradient-red', 'gradient-cyan'];
  const g = gradients[plan.coins % gradients.length];
  return (
    <div className={`relative bg-card border-2 rounded-2xl overflow-hidden transition-shadow hover:shadow-lg ${plan.is_popular ? 'border-violet-500 shadow-violet-100' : 'border-border'}`}>
      {plan.is_popular && (
        <div className="absolute top-0 left-0 right-0 text-center py-1 bg-violet-500 text-white text-xs font-bold flex items-center justify-center gap-1">
          <Star size={11} /> MOST POPULAR
        </div>
      )}
      <div className={`${g} p-5 text-white ${plan.is_popular ? 'pt-8' : ''}`}>
        <p className="font-bold text-lg">{plan.name}</p>
        <p className="text-4xl font-black mt-1">{plan.coins?.toLocaleString()}</p>
        <p className="text-white/80 text-sm">coins</p>
        {plan.bonus_coins > 0 && (
          <div className="flex items-center gap-1.5 mt-2 bg-white/20 rounded-full px-2.5 py-1 text-xs font-semibold w-fit">
            <Zap size={11} /> +{plan.bonus_coins} bonus
          </div>
        )}
      </div>
      <div className="p-4">
        <p className="text-2xl font-black text-foreground">${plan.price}</p>
        <p className="text-xs text-muted-foreground mb-4">{plan.currency || 'USD'}</p>
        <div className="flex items-center justify-between">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${plan.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
            {plan.is_active ? 'Active' : 'Inactive'}
          </span>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Edit2 size={12} /> Edit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CoinPlans() {
  const [plans, setPlans] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => { setLoading(true); api.coinPlans().then(setPlans).finally(() => setLoading(false)); };
  useEffect(load, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({ name: p.name, coins: String(p.coins), price: String(p.price), bonus_coins: String(p.bonus_coins || 0), is_popular: !!p.is_popular, is_active: p.is_active !== 0 });
  };

  const save = async () => {
    setSaving(true);
    const data = { name: form.name, coins: parseInt(form.coins), price: parseFloat(form.price), bonus_coins: parseInt(form.bonus_coins) || 0, is_popular: form.is_popular ? 1 : 0, is_active: form.is_active ? 1 : 0 };
    try {
      if (editing?.id) { await api.updateCoinPlan(editing.id, data); }
      else { await api.createCoinPlan(data); }
      showToast(editing?.id ? 'Plan updated' : 'Plan created');
      setEditing(null); setForm(empty); load();
    } catch (e: any) { showToast('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const fields = [
    { key: 'name', label: 'Plan Name', type: 'text', placeholder: 'e.g. Starter' },
    { key: 'coins', label: 'Coins', type: 'number', placeholder: '100' },
    { key: 'price', label: 'Price (USD)', type: 'number', placeholder: '0.99' },
    { key: 'bonus_coins', label: 'Bonus Coins', type: 'number', placeholder: '0' },
  ];

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Coin Plans</h2>
          <p className="text-sm text-muted-foreground">{plans.length} plans available for purchase</p>
        </div>
        <button
          onClick={() => { setEditing({}); setForm(empty); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
        >
          <Plus size={16} /> Add Plan
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {plans.map(p => <PlanCard key={p.id} plan={p} onEdit={() => openEdit(p)} />)}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Coin Plan' : 'New Coin Plan'}>
        <div className="space-y-4">
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-sm font-semibold block mb-1.5">{f.label}</label>
              <input
                type={f.type} placeholder={f.placeholder}
                value={(form as any)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          ))}

          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.is_popular} onChange={e => setForm(f => ({ ...f, is_popular: e.target.checked }))}
                className="w-4 h-4 rounded accent-violet-600" />
              <span className="text-sm font-medium">Mark as Popular</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded accent-violet-600" />
              <span className="text-sm font-medium">Active</span>
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={saving}
              className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving...' : editing?.id ? 'Update Plan' : 'Create Plan'}
            </button>
            <button onClick={() => setEditing(null)} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
