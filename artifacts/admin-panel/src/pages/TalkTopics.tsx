import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Plus, Edit2, Trash2, Hash } from 'lucide-react';

interface Topic { id: string; name: string; icon: string; is_active: number }
const empty = { name: '', icon: '💬' };

const EMOJI_SUGGESTIONS = ['💬','🎵','🎮','📚','🌍','❤️','😂','🎯','🏆','🎤','🔥','💡','🌟','🎭','🍕','⚽','🎨','🧠','💻','🎶'];

export default function TalkTopics() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => {
    setLoading(true);
    api.talkTopics().then(setTopics).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const openCreate = () => { setEditing({}); setForm(empty); };
  const openEdit = (t: Topic) => { setEditing(t); setForm({ name: t.name, icon: t.icon || '💬' }); };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing?.id) {
        await api.updateTalkTopic(editing.id, form);
        showToast('Topic updated');
      } else {
        await api.createTalkTopic(form);
        showToast('Topic created');
      }
      setEditing(null); setForm(empty); load();
    } catch (e: any) { showToast('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const toggleActive = async (t: Topic) => {
    try {
      await api.updateTalkTopic(t.id, { is_active: t.is_active ? 0 : 1 });
      load();
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this topic?')) return;
    try { await api.deleteTalkTopic(id); showToast('Deleted'); load(); }
    catch (e: any) { showToast('Error: ' + e.message); }
  };

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Talk Topics</h2>
          <p className="text-sm text-muted-foreground">{topics.length} topics shown in the mobile app</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm">
          <Plus size={16} /> Add Topic
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {topics.map(t => (
            <div key={t.id} className={`bg-card border-2 rounded-2xl p-4 transition-all hover:shadow-md ${t.is_active ? 'border-border' : 'border-dashed border-muted opacity-60'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-2xl">
                  {t.icon || '💬'}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(t)}
                    className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => del(t.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <p className="font-semibold text-sm">{t.name}</p>
              <div className="flex items-center justify-between mt-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {t.is_active ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => toggleActive(t)}
                  className="text-xs text-primary hover:underline font-medium">
                  {t.is_active ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))}
          {topics.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              <Hash size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">No talk topics yet. Add your first one!</p>
            </div>
          )}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Topic' : 'New Talk Topic'}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold block mb-2">Topic Name</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Music, Gaming, Travel..."
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-2">Icon (Emoji)</label>
            <div className="relative mb-3">
              <input type="text" value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                placeholder="Paste an emoji..."
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-center text-xl" />
            </div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">Quick pick:</p>
            <div className="flex flex-wrap gap-2">
              {EMOJI_SUGGESTIONS.map(e => (
                <button key={e} onClick={() => setForm(f => ({ ...f, icon: e }))}
                  className={`w-9 h-9 rounded-lg text-lg hover:bg-secondary transition-colors ${form.icon === e ? 'bg-primary/10 ring-2 ring-primary' : 'bg-secondary/50'}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={saving || !form.name.trim()}
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
