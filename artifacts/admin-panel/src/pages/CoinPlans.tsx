import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

const empty = { name: '', coins: '', price: '', bonus_coins: '0', is_popular: false };

export default function CoinPlans() {
  const [plans, setPlans] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); api.coinPlans().then(setPlans).finally(() => setLoading(false)); };
  useEffect(load, []);

  const save = async () => {
    const data = { name: form.name, coins: parseInt(form.coins), price: parseFloat(form.price), bonus_coins: parseInt(form.bonus_coins), is_popular: form.is_popular ? 1 : 0 };
    if (editing?.id) { await api.updateCoinPlan(editing.id, data); }
    else { await api.createCoinPlan(data); }
    setEditing(null); setForm(empty); load();
  };

  const openEdit = (p: any) => { setEditing(p); setForm({ name: p.name, coins: String(p.coins), price: String(p.price), bonus_coins: String(p.bonus_coins || 0), is_popular: !!p.is_popular }); };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Coin Plans</h2>
        <button onClick={() => { setEditing({}); setForm(empty); }}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm font-medium">
          <Plus size={16} /> Add Plan
        </button>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-4">{editing.id ? 'Edit Plan' : 'New Plan'}</h3>
            {[['name','Name','text'],['coins','Coins','number'],['price','Price (USD)','number'],['bonus_coins','Bonus Coins','number']].map(([k,l,t]) => (
              <div key={k} className="mb-3">
                <label className="text-sm font-medium block mb-1.5">{l}</label>
                <input type={t} value={(form as any)[k]} onChange={e => setForm(f => ({...f, [k]: e.target.value}))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            ))}
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={form.is_popular} onChange={e => setForm(f => ({...f, is_popular: e.target.checked}))} />
              <span className="text-sm">Mark as Popular</span>
            </label>
            <div className="flex gap-2">
              <button onClick={save} className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-semibold">Save</button>
              <button onClick={() => setEditing(null)} className="flex-1 border border-border rounded-lg py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? <p className="text-muted-foreground text-sm">Loading...</p> :
          plans.map(p => (
            <div key={p.id} className={`bg-card border rounded-xl p-5 relative ${p.is_popular ? 'border-primary' : 'border-border'}`}>
              {p.is_popular && <span className="absolute -top-2.5 left-4 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full font-medium">Popular</span>}
              <h3 className="font-semibold text-base mb-1">{p.name}</h3>
              <p className="text-3xl font-bold text-primary mb-1">{p.coins?.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground mb-0.5">coins</p>
              {p.bonus_coins > 0 && <p className="text-xs text-accent font-medium">+{p.bonus_coins} bonus coins</p>}
              <p className="text-xl font-bold mt-3 mb-4">${p.price}</p>
              <button onClick={() => openEdit(p)} className="w-full border border-border rounded-lg py-1.5 text-sm hover:bg-secondary transition-colors">Edit</button>
            </div>
          ))
        }
      </div>
    </div>
  );
}
