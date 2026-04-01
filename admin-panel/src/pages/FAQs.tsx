import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Plus, Edit2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

const empty = { question: '', answer: '', order_index: '0' };

interface FAQ { id: string; question: string; answer: string; order_index: number; is_active: number }

function FAQItem({ faq, onEdit, onDelete }: { faq: FAQ; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-secondary/40 transition-colors" onClick={() => setOpen(o => !o)}>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{faq.question}</p>
          {!open && <p className="text-xs text-muted-foreground truncate mt-0.5">{faq.answer}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); onEdit(); }} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors">
            <Edit2 size={13} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
            <Trash2 size={13} />
          </button>
          {open ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
        </div>
      )}
    </div>
  );
}

export default function FAQs() {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => { setLoading(true); api.faqs().then(setFaqs).catch(console.error).finally(() => setLoading(false)); };
  useEffect(load, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const openEdit = (f: FAQ) => {
    setEditing(f);
    setForm({ question: f.question, answer: f.answer, order_index: String(f.order_index || 0) });
  };

  const save = async () => {
    if (!form.question.trim() || !form.answer.trim()) return;
    setSaving(true);
    const data = { question: form.question, answer: form.answer, order_index: parseInt(form.order_index) || 0 };
    try {
      if (editing?.id) { await api.updateFaq(editing.id, data); showToast('FAQ updated'); }
      else { await api.createFaq(data); showToast('FAQ created'); }
      setEditing(null); setForm(empty); load();
    } catch (e: any) { showToast('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const deleteFaq = async (id: string) => {
    if (!confirm('Delete this FAQ?')) return;
    try { await api.deleteFaq(id); showToast('FAQ deleted'); load(); }
    catch (e: any) { showToast('Error: ' + e.message); }
  };

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">FAQs</h2>
          <p className="text-sm text-muted-foreground">{faqs.length} frequently asked questions</p>
        </div>
        <button
          onClick={() => { setEditing({}); setForm(empty); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm"
        >
          <Plus size={16} /> Add FAQ
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : faqs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No FAQs yet. Click "Add FAQ" to create your first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {faqs.map(f => <FAQItem key={f.id} faq={f} onEdit={() => openEdit(f)} onDelete={() => deleteFaq(f.id)} />)}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit FAQ' : 'New FAQ'} width="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold block mb-2">Question</label>
            <input
              type="text" value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
              placeholder="What is VoxLink?"
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-2">Answer</label>
            <textarea
              value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} rows={5}
              placeholder="VoxLink is a platform that..."
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-2">Display Order</label>
            <input
              type="number" value={form.order_index} onChange={e => setForm(f => ({ ...f, order_index: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 w-28"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={saving || !form.question.trim() || !form.answer.trim()}
              className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving...' : editing?.id ? 'Update' : 'Create'}
            </button>
            <button onClick={() => setEditing(null)} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
