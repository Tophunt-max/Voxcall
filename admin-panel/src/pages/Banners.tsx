import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Plus, Trash2, Edit2, ExternalLink, Eye, EyeOff, Upload, X, ImageIcon, Clock } from 'lucide-react';

// ─── Audience & position taxonomy ─────────────────────────────────────────────
// `audience` is the hard split between the two apps: a banner is shown to the
// user app, the host app, or both. Positions are app-specific slots — the host
// app only has a single home rail, so host banners collapse to one position.
type Audience = 'user' | 'host' | 'all';

const AUDIENCE_OPTIONS: { id: Audience; label: string; hint: string }[] = [
  { id: 'user', label: 'User app', hint: 'Shown to regular users only' },
  { id: 'host', label: 'Host app', hint: 'Shown to hosts only' },
  { id: 'all', label: 'Both apps', hint: 'Shown to users and hosts' },
];
const AUDIENCE_LABEL: Record<string, string> = { user: 'User app', host: 'Host app', all: 'Both apps' };
const AUDIENCE_BADGE: Record<string, string> = {
  user: 'bg-sky-100 text-sky-700',
  host: 'bg-violet-100 text-violet-700',
  all: 'bg-amber-100 text-amber-700',
};

const ALL_POSITIONS: Record<string, string> = {
  home_top: 'Home — Top',
  home_middle: 'Home — Middle',
  home_bottom: 'Home — Bottom',
  search_top: 'Search — Top',
  search_middle: 'Search — Middle',
  search_bottom: 'Search — Bottom',
  wallet: 'Wallet',
};

// Positions valid for a given audience. Host app only surfaces a home rail.
function positionsFor(audience: Audience): { id: string; label: string }[] {
  if (audience === 'host') return [{ id: 'home_top', label: 'Host Home' }];
  if (audience === 'all')
    return [
      { id: 'home_top', label: 'Home — Top' },
      { id: 'home_middle', label: 'Home — Middle' },
      { id: 'home_bottom', label: 'Home — Bottom' },
    ];
  return Object.entries(ALL_POSITIONS).map(([id, label]) => ({ id, label }));
}

const LINK_TYPES = [
  { id: 'none', label: 'No action (display only)' },
  { id: 'internal', label: 'Open in-app screen' },
  { id: 'external', label: 'Open external URL' },
];

const COLORS = ['#7C3AED', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6'];

// ─── datetime-local <-> unix seconds ──────────────────────────────────────────
function epochToLocalInput(sec?: number | null): string {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToEpoch(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}
function scheduleLabel(startsAt?: number | null, endsAt?: number | null): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  if (startsAt) return `from ${fmt(startsAt)}`;
  return `until ${fmt(endsAt as number)}`;
}

function resolveUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  const base = (import.meta as any).env.VITE_API_URL || '';
  return `${base}${url}`;
}

function blank() {
  return {
    title: '',
    subtitle: '',
    image_url: '',
    bg_color: '#7C3AED',
    gradient_to: '',
    icon: '',
    cta_text: 'Learn More',
    link_type: 'internal',
    cta_link: '',
    position: 'home_top',
    audience: 'user' as Audience,
    sort_order: '0',
    starts_at: '',
    ends_at: '',
    active: true,
  };
}

// ─── Banner image uploader (file upload to R2 OR paste URL) ───────────────────
function BannerImageUploader({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<'upload' | 'url'>(value && value.startsWith('http') ? 'url' : 'upload');
  const [urlInput, setUrlInput] = useState(value || '');

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Only image files are allowed (JPG, PNG, WebP)'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('File too large. Maximum 5 MB.'); return; }
    setUploading(true);
    try {
      const result = await api.uploadBannerImage(file);
      onChange(result.url);
      toast.success('Image uploaded');
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setMode('upload')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${mode === 'upload' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
          Upload
        </button>
        <button type="button" onClick={() => setMode('url')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${mode === 'url' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
          Paste URL
        </button>
        {value ? (
          <button type="button" onClick={() => { onChange(''); setUrlInput(''); }}
            className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 px-2 py-1.5 rounded-lg">
            <X size={12} /> Remove
          </button>
        ) : null}
      </div>

      {value ? (
        <div className="rounded-xl overflow-hidden border border-border bg-muted/30">
          <img src={resolveUrl(value)} alt="Banner preview" className="w-full max-h-36 object-contain" />
        </div>
      ) : mode === 'upload' ? (
        <label
          className={`relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
          } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        >
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {uploading ? (
            <>
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Uploading...</p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><Upload size={18} className="text-primary" /></div>
              <p className="text-sm font-medium">Drop an image or click to upload</p>
              <p className="text-xs text-muted-foreground">JPG, PNG, WebP or GIF · max 5 MB</p>
            </>
          )}
        </label>
      ) : (
        <div className="flex gap-2">
          <input className="flex-1 px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="https://…/banner.jpg" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
          <button type="button" onClick={() => { if (urlInput.trim()) onChange(urlInput.trim()); }}
            className="px-3 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90">Use</button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Optional. Image is shown on the User Search rail and Host Home banner.</p>
    </div>
  );
}

export default function Banners() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>(blank());
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadBanners = () => {
    api.banners().then(d => { setRows(d); setFetchError(''); }).catch(() => setFetchError('Failed to load banners')).finally(() => setLoading(false));
  };

  useEffect(() => { loadBanners(); }, []);

  const openCreate = () => { setEditing(null); setCreating(true); setForm(blank()); };
  const openEdit = (b: any) => {
    setCreating(false);
    setEditing(b);
    setForm({
      title: b.title || '',
      subtitle: b.subtitle || '',
      image_url: b.image_url || '',
      bg_color: b.bg_color || '#7C3AED',
      gradient_to: b.gradient_to || '',
      icon: b.icon || '',
      cta_text: b.cta_text || '',
      link_type: b.link_type || (b.cta_link ? (String(b.cta_link).startsWith('http') ? 'external' : 'internal') : 'none'),
      cta_link: b.cta_link || '',
      position: b.position || 'home_top',
      audience: (b.audience as Audience) || 'user',
      sort_order: String(b.sort_order ?? 0),
      starts_at: epochToLocalInput(b.starts_at),
      ends_at: epochToLocalInput(b.ends_at),
      active: !!b.active,
    });
  };
  const closeModal = () => { setEditing(null); setCreating(false); setForm(blank()); };

  // Keep position valid whenever audience changes.
  const changeAudience = (audience: Audience) => {
    setForm((f: any) => {
      const valid = positionsFor(audience).map(p => p.id);
      return { ...f, audience, position: valid.includes(f.position) ? f.position : valid[0] };
    });
  };

  const validate = (): string | null => {
    if (!form.title.trim()) return 'Title is required';
    const link = form.cta_link.trim();
    if (form.link_type === 'internal' && link && !link.startsWith('/')) return 'In-app link must start with "/" (e.g. /coins)';
    if (form.link_type === 'external' && link && !/^https:\/\//i.test(link)) return 'External link must start with https://';
    const s = localInputToEpoch(form.starts_at);
    const e = localInputToEpoch(form.ends_at);
    if (s && e && e <= s) return 'End time must be after start time';
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim(),
      image_url: form.image_url,
      bg_color: form.bg_color,
      gradient_to: form.gradient_to || null,
      icon: form.icon.trim() || null,
      cta_text: form.cta_text.trim(),
      link_type: form.link_type,
      cta_link: form.link_type === 'none' ? '' : form.cta_link.trim(),
      position: form.position,
      audience: form.audience,
      sort_order: parseInt(form.sort_order) || 0,
      starts_at: localInputToEpoch(form.starts_at),
      ends_at: localInputToEpoch(form.ends_at),
      active: form.active,
    };
    try {
      if (editing) { await api.updateBanner(editing.id, payload); toast.success('Banner updated'); }
      else { await api.createBanner(payload); toast.success('Banner created'); }
      closeModal();
      loadBanners();
    } catch (e: any) { toast.error(e?.message || 'Failed to save banner'); }
    finally { setSaving(false); }
  };

  const toggle = async (id: string) => {
    const banner = rows.find(r => r.id === id);
    if (!banner || togglingId === id) return;
    setTogglingId(id);
    try { await api.updateBanner(id, { active: !banner.active }); loadBanners(); }
    catch { toast.error('Failed to update banner'); }
    finally { setTogglingId(null); }
  };

  const remove = async (id: string) => {
    if (deletingId === id) return;
    if (!confirm('Delete this banner? This cannot be undone.')) return;
    setDeletingId(id);
    try { await api.deleteBanner(id); toast.success('Banner deleted'); loadBanners(); }
    catch { toast.error('Failed to delete banner'); }
    finally { setDeletingId(null); }
  };

  const positions = positionsFor(form.audience);

  return (
    <div className="space-y-5">
      {fetchError && <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">⚠ {fetchError}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Promotional Banners</h2>
          <p className="text-sm text-muted-foreground">{rows.filter(r => r.active).length} active · separate banners for the user app and host app</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
          <Plus size={15} /> New Banner
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <p className="font-semibold text-sm">No banners yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click "New Banner" to create your first promotional banner</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {rows.map(b => {
            const sched = scheduleLabel(b.starts_at, b.ends_at);
            return (
              <div key={b.id} className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="flex items-stretch">
                  <div className="w-3 flex-shrink-0" style={{ backgroundColor: b.bg_color }} />
                  {b.image_url ? (
                    <img src={resolveUrl(b.image_url)} alt="" className="w-20 object-cover flex-shrink-0" />
                  ) : null}
                  <div className="flex-1 p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-bold text-sm">{b.title}</p>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${AUDIENCE_BADGE[b.audience] || AUDIENCE_BADGE.user}`}>
                            {AUDIENCE_LABEL[b.audience] || 'User app'}
                          </span>
                          <Badge variant={b.active ? 'active' : 'inactive'}>{b.active ? 'Active' : 'Inactive'}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{b.subtitle}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span>Position: <strong className="text-foreground">{ALL_POSITIONS[b.position] || b.position}</strong></span>
                          <span>Order: <strong className="text-foreground">{b.sort_order ?? 0}</strong></span>
                          {sched && <span className="flex items-center gap-0.5"><Clock size={10} /> {sched}</span>}
                          {b.cta_link && <span className="flex items-center gap-0.5"><ExternalLink size={10} /> {b.cta_link}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => toggle(b.id)} disabled={togglingId === b.id} title={b.active ? 'Hide' : 'Show'} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary disabled:opacity-40">
                          {b.active ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button onClick={() => openEdit(b)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary">
                          <Edit2 size={15} />
                        </button>
                        <button onClick={() => remove(b.id)} disabled={deletingId === b.id} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-500 disabled:opacity-40">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={creating || !!editing} onClose={closeModal} title={editing ? 'Edit Banner' : 'Create Banner'}>
        <div className="space-y-4">
          {/* Audience */}
          <div>
            <label className="text-sm font-semibold block mb-1.5">Audience</label>
            <div className="grid grid-cols-3 gap-2">
              {AUDIENCE_OPTIONS.map(a => (
                <button key={a.id} type="button" onClick={() => changeAudience(a.id)}
                  title={a.hint}
                  className={`px-2 py-2 rounded-xl text-xs font-semibold border transition-colors ${form.audience === a.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-secondary'}`}>
                  {a.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{AUDIENCE_OPTIONS.find(a => a.id === form.audience)?.hint}</p>
          </div>

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

          {/* Image */}
          <div>
            <label className="text-sm font-semibold block mb-1.5 flex items-center gap-1.5"><ImageIcon size={13} /> Image</label>
            <BannerImageUploader value={form.image_url} onChange={(url) => setForm((f: any) => ({ ...f, image_url: url }))} />
          </div>

          <div>
            <label className="text-sm font-semibold block mb-1.5">Background Color</label>
            <div className="flex items-center gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setForm({ ...form, bg_color: c })} style={{ backgroundColor: c }}
                  className={`w-8 h-8 rounded-full transition-transform ${form.bg_color === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : ''}`} />
              ))}
              <input type="color" value={form.bg_color} onChange={e => setForm({ ...form, bg_color: e.target.value })}
                className="w-8 h-8 rounded-full border-0 cursor-pointer" title="Custom color" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Gradient 2nd color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.gradient_to || form.bg_color} onChange={e => setForm({ ...form, gradient_to: e.target.value })}
                  className="w-10 h-[42px] rounded-xl border border-border cursor-pointer" title="Gradient end color" />
                {form.gradient_to ? (
                  <button type="button" onClick={() => setForm({ ...form, gradient_to: '' })}
                    className="text-xs text-muted-foreground hover:text-red-500">Clear</button>
                ) : <span className="text-xs text-muted-foreground">Auto (darker shade)</span>}
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Icon (emoji)</label>
              <input maxLength={4} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                placeholder="🎁" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} />
              <p className="text-xs text-muted-foreground mt-1">Shown on the right when there's no image.</p>
            </div>
          </div>

          {/* CTA */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1.5">CTA Button Text</label>
              <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                placeholder="Learn More" value={form.cta_text} onChange={e => setForm({ ...form, cta_text: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Tap action</label>
              <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                value={form.link_type} onChange={e => setForm({ ...form, link_type: e.target.value })}>
                {LINK_TYPES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
          </div>
          {form.link_type !== 'none' && (
            <div>
              <label className="text-sm font-semibold block mb-1.5">{form.link_type === 'external' ? 'External URL' : 'In-app screen path'}</label>
              <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                placeholder={form.link_type === 'external' ? 'https://example.com/promo' : '/coins'}
                value={form.cta_link} onChange={e => setForm({ ...form, cta_link: e.target.value })} />
              <p className="text-xs text-muted-foreground mt-1">
                {form.link_type === 'external' ? 'Opens in the device browser. Must start with https://' : 'Opens a screen inside the app. Must start with "/" (e.g. /coins, /hosts).'}
              </p>
            </div>
          )}

          {/* Placement + order */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Position</label>
              <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                value={form.position} onChange={e => setForm({ ...form, position: e.target.value })}>
                {positions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Sort order</label>
              <input type="number" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                placeholder="0" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} />
              <p className="text-xs text-muted-foreground mt-1">Lower shows first.</p>
            </div>
          </div>

          {/* Schedule (optional) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Starts (optional)</label>
              <input type="datetime-local" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Ends (optional)</label>
              <input type="datetime-local" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} />
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 rounded accent-violet-600" />
            <span className="text-sm font-medium">Active (visible in the app)</span>
          </label>

          {/* Preview — mirrors the app's PromoBannerCard (gradient + icon/image) */}
          <div>
            <label className="text-sm font-semibold block mb-2">Preview</label>
            <div
              className="rounded-2xl p-4 text-white overflow-hidden relative flex items-center gap-3 min-h-[112px]"
              style={{ background: `linear-gradient(135deg, ${form.bg_color}, ${form.gradient_to || form.bg_color})` }}
            >
              {form.image_url ? <img src={resolveUrl(form.image_url)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" /> : null}
              <div className="relative flex-1">
                <p className="font-bold text-base leading-tight">{form.title || 'Banner Title'}</p>
                <p className="text-xs opacity-90 mt-0.5">{form.subtitle || 'Banner subtitle text'}</p>
                {form.link_type !== 'none' && form.cta_text && <div className="mt-2 inline-block bg-white/25 px-3 py-1 rounded-full text-xs font-semibold">{form.cta_text} ›</div>}
              </div>
              {!form.image_url && form.icon ? <span className="relative text-4xl">{form.icon}</span> : null}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={!form.title.trim() || saving}
              className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving...' : editing ? 'Update Banner' : 'Create Banner'}
            </button>
            <button onClick={closeModal} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
