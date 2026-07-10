import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Plus, Edit2, Trash2, Gift, Eye, EyeOff, Coins } from 'lucide-react';

// Admin-managed chat gift catalog. Users send these coin-priced gifts inside a
// chat; coins move to the host (counting toward host earnings + levels).
function blank() {
  return { name: '', icon: '🎁', price_coins: '50', sort_order: '0', is_active: true };
}

const EMOJI_SUGGESTIONS = ['🌹', '❤️', '🧸', '🎂', '💎', '👑', '🚀', '🔥', '⭐', '🎁', '💐', '🍫', '🏆', '💋'];

export default function Gifts() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>(blank());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.gifts().then(d => { setRows(d); setFetchError(''); }).catch(() => setFetchError('Failed to load gifts')).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => { setEditing(null); setCreating(true); setForm(blank()); };
  const openEdit = (g: any) => {
    setCreating(false);
    setEditing(g);
    setForm({
      name: g.name || '',
      icon: g.icon || '🎁',
      price_coins: String(g.price_coins ?? 0),
      sort_order: String(g.sort_order ?? 0),
      is_active: g.is_active !== 0,
    });
  };
  const closeModal = () => { setEditing(null); setCreating(false); setForm(blank()); };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Gift name is required'); return; }
    if (!form.icon.trim()) { toast.error('Gift icon (emoji) is required'); return; }
    const price = parseInt(form.price_coins);
    if (isNaN(price) || price < 0) { toast.error('Price must be a valid number'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      icon: form.icon.trim(),
      price_coins: price,
      sort_order: parseInt(form.sort_order) || 0,
      is_active: form.is_active ? 1 : 0,
    };
    try {
      if (editing) { await api.updateGift(editing.id, payload); toast.success('Gift updated'); }
      else { await api.createGift(payload); toast.success('Gift created'); }
      closeModal();
      load();
    } catch (e: any) { toast.error(e?.message || 'Failed to save gift'); }
    finally { setSaving(false); }
  };

  const toggle = async (g: any) => {
    if (busyId === g.id) return;
    setBusyId(g.id);
    try { await api.updateGift(g.id, { is_active: g.is_active ? 0 : 1 }); load(); }
    catch { toast.error('Failed to update gift'); }
    finally { setBusyId(null); }
  };

  const remove = async (g: any) => {
    if (busyId === g.id) return;
    if (!confirm(`Delete "${g.name}" gift? This cannot be undone.`)) return;
    setBusyId(g.id);
    try { await api.deleteGift(g.id); toast.success('Gift deleted'); load(); }
    catch { toast.error('Failed to delete gift'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-5">
      {fetchError && <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">⚠ {fetchError}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Gift size={18} className="text-pink-500" /> Chat Gifts</h2>
          <p className="text-sm text-muted-foreground">{rows.filter(r => r.is_active).length} active · users send these inside chats; coins go to the host</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
          <Plus size={15} /> New Gift
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <p className="font-semibold text-sm">No gifts yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click "New Gift" to add one to the catalog</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {rows.map(g => (
            <div key={g.id} className={`relative bg-card border rounded-2xl p-4 flex flex-col items-center text-center gap-2 ${g.is_active ? 'border-border' : 'border-border opacity-60'}`}>
              <div className="text-5xl leading-none mt-1">{g.icon}</div>
              <p className="font-bold text-sm">{g.name}</p>
              <span className="flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
                <Coins size={11} />{Number(g.price_coins).toLocaleString()}
              </span>
              <span className="text-[11px] text-muted-foreground">Order: {g.sort_order ?? 0}</span>
              <div className="flex items-center gap-1 mt-1">
                <button onClick={() => toggle(g)} disabled={busyId === g.id} title={g.is_active ? 'Hide' : 'Show'} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary disabled:opacity-40">
                  {g.is_active ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={() => openEdit(g)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary"><Edit2 size={14} /></button>
                <button onClick={() => remove(g)} disabled={busyId === g.id} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 disabled:opacity-40"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={creating || !!editing} onClose={closeModal} title={editing ? 'Edit Gift' : 'New Gift'}>
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-1">
            <div className="text-6xl leading-none">{form.icon || '🎁'}</div>
            <p className="text-xs text-muted-foreground">Preview</p>
          </div>

          <div>
            <label className="text-sm font-semibold block mb-1.5">Icon (emoji)</label>
            <input maxLength={4} value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="🌹" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {EMOJI_SUGGESTIONS.map(e => (
                <button key={e} type="button" onClick={() => setForm({ ...form, icon: e })}
                  className={`text-xl w-9 h-9 rounded-lg border transition-colors ${form.icon === e ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}`}>{e}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold block mb-1.5">Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="Rose" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Price (coins)</label>
              <input type="number" min={0} value={form.price_coins} onChange={e => setForm({ ...form, price_coins: e.target.value })}
                className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="50" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Sort order</label>
              <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })}
                className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0" />
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded accent-violet-600" />
            <span className="text-sm font-medium">Active (available in chat)</span>
          </label>

          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={!form.name.trim() || saving} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving...' : editing ? 'Update Gift' : 'Create Gift'}
            </button>
            <button onClick={closeModal} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
