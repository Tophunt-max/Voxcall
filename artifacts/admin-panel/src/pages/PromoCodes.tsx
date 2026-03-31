import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, Plus, Trash2, Tag, Copy, CheckCircle } from 'lucide-react';

const MOCK: any[] = [
  { id: '1', code: 'WELCOME50', discount_pct: 50, max_uses: 100, used_count: 34, expires_at: '2026-06-30', active: true, type: 'percent' },
  { id: '2', code: 'VOXLINK20', discount_pct: 20, max_uses: 500, used_count: 210, expires_at: '2026-05-15', active: true, type: 'percent' },
  { id: '3', code: 'NEWUSER10', discount_pct: 10, max_uses: 1000, used_count: 889, expires_at: '2026-04-01', active: false, type: 'percent' },
  { id: '4', code: 'COINS100', discount_pct: 0, bonus_coins: 100, max_uses: 200, used_count: 55, expires_at: '2026-07-31', active: true, type: 'bonus' },
];

function blank() {
  return { code: '', discount_pct: 10, bonus_coins: 0, max_uses: 100, expires_at: '', active: true, type: 'percent' };
}

export default function PromoCodes() {
  const [rows, setRows] = useState<any[]>(MOCK);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>(blank());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    api.promoCodes?.().then(setRows).catch(() => {});
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const filtered = rows.filter(r =>
    r.code.toLowerCase().includes(search.toLowerCase())
  );

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(''), 2000);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.updatePromoCode?.(editing.id, form);
        setRows(rows.map(r => r.id === editing.id ? { ...r, ...form } : r));
        showToast('Promo code updated');
        setEditing(null);
      } else {
        const newCode = { ...form, id: Date.now().toString(), used_count: 0 };
        await api.createPromoCode?.(form);
        setRows([newCode, ...rows]);
        showToast('Promo code created');
        setCreating(false);
      }
    } catch { showToast('Saved locally'); if (editing) setEditing(null); else setCreating(false); }
    finally { setSaving(false); setForm(blank()); }
  };

  const deleteCode = (id: string) => {
    setRows(rows.filter(r => r.id !== id));
    showToast('Promo code deleted');
  };

  const toggle = (id: string) => {
    setRows(rows.map(r => r.id === id ? { ...r, active: !r.active } : r));
  };

  const cols = [
    {
      key: 'code', header: 'Code',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
            <Tag size={14} className="text-violet-600" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-sm">{r.code}</span>
              <button onClick={() => copyCode(r.code)} className="text-muted-foreground hover:text-primary">
                {copied === r.code ? <CheckCircle size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{r.type === 'bonus' ? `+${r.bonus_coins} coins` : `${r.discount_pct}% off`}</p>
          </div>
        </div>
      )
    },
    {
      key: 'usage', header: 'Usage',
      render: (r: any) => (
        <div>
          <div className="flex items-center gap-1 text-sm font-semibold">{r.used_count} / {r.max_uses}</div>
          <div className="w-24 h-1.5 bg-secondary rounded-full mt-1 overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(100, (r.used_count / r.max_uses) * 100)}%` }} />
          </div>
        </div>
      )
    },
    {
      key: 'expires_at', header: 'Expires', className: 'hidden sm:table-cell',
      render: (r: any) => <span className="text-xs text-muted-foreground">{r.expires_at || '—'}</span>
    },
    {
      key: 'active', header: 'Status',
      render: (r: any) => (
        <button onClick={() => toggle(r.id)}>
          <Badge variant={r.active ? 'active' : 'inactive'}>{r.active ? 'Active' : 'Inactive'}</Badge>
        </button>
      )
    },
    {
      key: 'actions', header: '',
      render: (r: any) => (
        <div className="flex items-center gap-1">
          <button onClick={() => { setEditing(r); setForm({ ...r }); }}
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors text-xs font-medium px-2">
            Edit
          </button>
          <button onClick={() => deleteCode(r.id)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      )
    },
  ];

  const PromoForm = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-semibold block mb-1.5">Promo Code</label>
        <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm font-mono uppercase bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="e.g. SUMMER30" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
      </div>
      <div>
        <label className="text-sm font-semibold block mb-1.5">Type</label>
        <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
          value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
          <option value="percent">Percentage Discount</option>
          <option value="bonus">Bonus Coins</option>
        </select>
      </div>
      {form.type === 'percent' ? (
        <div>
          <label className="text-sm font-semibold block mb-1.5">Discount %</label>
          <input type="number" min="1" max="100"
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.discount_pct} onChange={e => setForm({ ...form, discount_pct: parseInt(e.target.value) })} />
        </div>
      ) : (
        <div>
          <label className="text-sm font-semibold block mb-1.5">Bonus Coins</label>
          <input type="number" min="1"
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.bonus_coins} onChange={e => setForm({ ...form, bonus_coins: parseInt(e.target.value) })} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Max Uses</label>
          <input type="number" min="1"
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.max_uses} onChange={e => setForm({ ...form, max_uses: parseInt(e.target.value) })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">Expiry Date</label>
          <input type="date"
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => setForm({ ...form, active: !form.active })}
          className={`relative w-10 h-5 rounded-full transition-colors ${form.active ? 'bg-primary' : 'bg-secondary'}`}>
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
        <span className="text-sm">{form.active ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={save} disabled={saving || !form.code}
          className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? 'Saving...' : editing ? 'Update Code' : 'Create Code'}
        </button>
        <button onClick={() => { setEditing(null); setCreating(false); setForm(blank()); }}
          className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Promo Codes</h2>
          <p className="text-sm text-muted-foreground">{rows.filter(r => r.active).length} active codes</p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 w-full sm:w-52"
              placeholder="Search codes..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => { setCreating(true); setForm(blank()); }}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap">
            <Plus size={15} /> New Code
          </button>
        </div>
      </div>
      <Table columns={cols} data={filtered} loading={false} empty="No promo codes found" keyFn={r => r.id} />
      <Modal open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); setForm(blank()); }}
        title={editing ? 'Edit Promo Code' : 'Create Promo Code'}>
        <PromoForm />
      </Modal>
    </div>
  );
}
