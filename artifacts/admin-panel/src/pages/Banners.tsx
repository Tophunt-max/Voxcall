import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Plus, Trash2, Edit2, Image, ExternalLink, Eye, EyeOff } from 'lucide-react';

const MOCK: any[] = [
  { id: '1', title: 'Weekend Offer — 30% Off Coins!', subtitle: 'Limited time only. Use code WEEKEND30', image_url: '', bg_color: '#7C3AED', cta_text: 'Grab Deal', cta_link: '/coins', active: true, position: 'home_top', created_at: '2026-03-28' },
  { id: '2', title: 'New Hosts Available!', subtitle: 'Explore 20+ new hosts added this week', image_url: '', bg_color: '#0EA5E9', cta_text: 'Browse Hosts', cta_link: '/hosts', active: true, position: 'home_middle', created_at: '2026-03-25' },
  { id: '3', title: 'Rate Your Experience', subtitle: 'Help us improve by rating your last call', image_url: '', bg_color: '#10B981', cta_text: 'Rate Now', cta_link: '/ratings', active: false, position: 'home_bottom', created_at: '2026-03-20' },
];

const POSITIONS = [
  { id: 'home_top', label: 'Home — Top Banner' },
  { id: 'home_middle', label: 'Home — Middle Card' },
  { id: 'home_bottom', label: 'Home — Bottom Strip' },
  { id: 'search_top', label: 'Search Page — Top' },
  { id: 'wallet', label: 'Wallet Page' },
];

const COLORS = ['#7C3AED', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6'];

function blank() {
  return { title: '', subtitle: '', image_url: '', bg_color: '#7C3AED', cta_text: 'Learn More', cta_link: '', active: true, position: 'home_top' };
}

export default function Banners() {
  const [rows, setRows] = useState<any[]>(MOCK);
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>(blank());
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const save = () => {
    if (editing) {
      setRows(rows.map(r => r.id === editing.id ? { ...r, ...form } : r));
      showToast('Banner updated');
      setEditing(null);
    } else {
      setRows([{ ...form, id: Date.now().toString(), created_at: new Date().toISOString().slice(0, 10) }, ...rows]);
      showToast('Banner created');
      setCreating(false);
    }
    setForm(blank());
  };

  const toggle = (id: string) => setRows(rows.map(r => r.id === id ? { ...r, active: !r.active } : r));
  const remove = (id: string) => { setRows(rows.filter(r => r.id !== id)); showToast('Banner deleted'); };

  const BannerForm = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-semibold block mb-1.5">Title</label>
        <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Banner headline..." value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-semibold block mb-1.5">Subtitle</label>
        <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Supporting text..." value={form.subtitle} onChange={e => setForm({ ...form, subtitle: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-semibold block mb-1.5">Background Color</label>
        <div className="flex items-center gap-2 flex-wrap">
          {COLORS.map(c => (
            <button key={c} onClick={() => setForm({ ...form, bg_color: c })}
              style={{ backgroundColor: c }}
              className={`w-8 h-8 rounded-full transition-transform ${form.bg_color === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : ''}`} />
          ))}
          <input type="color" value={form.bg_color} onChange={e => setForm({ ...form, bg_color: e.target.value })}
            className="w-8 h-8 rounded-full border-0 cursor-pointer" title="Custom color" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">CTA Button Text</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            placeholder="Learn More" value={form.cta_text} onChange={e => setForm({ ...form, cta_text: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1.5">CTA Link</label>
          <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
            placeholder="/coins" value={form.cta_link} onChange={e => setForm({ ...form, cta_link: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="text-sm font-semibold block mb-1.5">Position</label>
        <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
          value={form.position} onChange={e => setForm({ ...form, position: e.target.value })}>
          {POSITIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className="text-sm font-semibold block mb-2">Preview</label>
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: form.bg_color }}>
          <p className="font-bold text-sm">{form.title || 'Banner Title'}</p>
          <p className="text-xs opacity-80 mt-0.5">{form.subtitle || 'Banner subtitle text'}</p>
          {form.cta_text && <div className="mt-2 inline-block bg-white/20 px-3 py-1 rounded-full text-xs font-semibold">{form.cta_text} →</div>}
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={save} disabled={!form.title}
          className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {editing ? 'Update Banner' : 'Create Banner'}
        </button>
        <button onClick={() => { setEditing(null); setCreating(false); setForm(blank()); }}
          className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Promotional Banners</h2>
          <p className="text-sm text-muted-foreground">{rows.filter(r => r.active).length} active banners</p>
        </div>
        <button onClick={() => { setCreating(true); setForm(blank()); }}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
          <Plus size={15} /> New Banner
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {rows.map(b => (
          <div key={b.id} className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="flex items-stretch">
              <div className="w-3 rounded-l-2xl flex-shrink-0" style={{ backgroundColor: b.bg_color }} />
              <div className="flex-1 p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold text-sm">{b.title}</p>
                      <Badge variant={b.active ? 'active' : 'inactive'}>{b.active ? 'Active' : 'Inactive'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{b.subtitle}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span>Position: <strong className="text-foreground">{POSITIONS.find(p => p.id === b.position)?.label || b.position}</strong></span>
                      {b.cta_link && <span className="flex items-center gap-0.5"><ExternalLink size={10} /> {b.cta_link}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => toggle(b.id)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary">
                      {b.active ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button onClick={() => { setEditing(b); setForm({ ...b }); }} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary">
                      <Edit2 size={15} />
                    </button>
                    <button onClick={() => remove(b.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-500">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={creating || !!editing} onClose={() => { setEditing(null); setCreating(false); setForm(blank()); }}
        title={editing ? 'Edit Banner' : 'Create Banner'}>
        <BannerForm />
      </Modal>
    </div>
  );
}
