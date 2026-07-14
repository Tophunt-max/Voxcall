import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Smartphone, Download, Copy, Trash2, Plus } from 'lucide-react';
import { useScope } from '@/scope';
import { useBuilds } from '@/lib/queries';
import { rel, humanSize, shortId } from '@/lib/format';
import { api, type AppId, type Build } from '@/lib/api';
import { Spinner } from '@/components/bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/Modal';

function copy(t: string) {
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast.success('Copied'), () => toast.error('Copy failed'));
}

function BuildCard({ b, onDelete }: { b: Build; onDelete: (id: string) => void }) {
  const plat = b.platform === 'ios' ? 'iOS' : 'Android';
  const ver = (b.version || '') + (b.buildNumber ? ` (${b.buildNumber})` : '');
  const meta = [b.size ? humanSize(b.size) : b.externalUrl ? 'external link' : '', rel(b.createdAt)].filter(Boolean).join(' · ');
  const dl = b.downloadUrl || '';
  return (
    <div className="rounded-xl border border-border bg-gradient-to-b from-card to-card2 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone="plat"><Smartphone size={11} /> {plat}</Badge>
          {ver && <span className="font-mono text-[12.5px]">{ver}</span>}
        </div>
        <button onClick={() => onDelete(b.id)} title="Delete build" className="text-muted-foreground hover:text-red-300"><Trash2 size={15} /></button>
      </div>
      {b.filename && <div className="mt-1.5 break-all font-mono text-xs text-muted-foreground">{b.filename}</div>}
      {b.notes && <div className="mt-1.5 text-[12.5px]">{b.notes}</div>}
      <div className="mt-1.5 text-xs text-muted-foreground">{meta}</div>
      <div className="mt-3 flex items-center gap-2">
        {dl && (
          <>
            <a href={dl} target={b.storageKey ? undefined : '_blank'} rel="noopener" className="grad inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-white shadow-lg shadow-primary/30 hover:brightness-110">
              <Download size={14} /> Download
            </a>
            <Button size="sm" variant="outline" onClick={() => copy(dl)}><Copy size={13} /> Copy link</Button>
          </>
        )}
      </div>
    </div>
  );
}

export function Downloads() {
  const { app } = useScope();
  const builds = useBuilds(app);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  if (builds.isLoading) return <Spinner />;
  const list = builds.data?.builds ?? [];
  const groups: Record<string, Build[]> = {};
  list.forEach((b) => { (groups[b.channel] = groups[b.channel] || []).push(b); });
  const order = Object.keys(groups).sort((a) => (a === 'production' ? -1 : 1));

  function invalidate() { qc.invalidateQueries({ queryKey: ['builds', app] }); }
  async function del(id: string) {
    if (!window.confirm('Delete this build? Its download link stops working.')) return;
    try { await api.deleteBuild(app, id); toast.success('Build deleted'); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-muted-foreground">Installable production &amp; test builds (APK / IPA). Share the link with testers.</span>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={14} /> Add build</Button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No builds yet. Click “Add build” to upload an APK/IPA or paste an install link.
        </div>
      ) : (
        order.map((ch) => (
          <div key={ch}>
            <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ch} · {groups[ch].length}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups[ch].map((b) => <BuildCard key={b.id} b={b} onDelete={del} />)}
            </div>
          </div>
        ))
      )}

      <AddBuildModal app={app} open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); invalidate(); }} />
    </>
  );
}

function AddBuildModal({ app, open, onClose, onDone }: { app: AppId; open: boolean; onClose: () => void; onDone: () => void }) {
  const [src, setSrc] = useState<'upload' | 'link'>('upload');
  const [platform, setPlatform] = useState('android');
  const [channel, setChannel] = useState('production');
  const [version, setVersion] = useState('');
  const [buildNumber, setBuildNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');

  async function submit() {
    setBusy('...');
    try {
      if (src === 'upload') {
        if (!file) { toast.error('Choose a file'); setBusy(''); return; }
        const qs = new URLSearchParams({ app, channel, platform, version, buildNumber, notes, filename: file.name }).toString();
        await api.uploadBuild(qs, file);
        toast.success('Build uploaded');
      } else {
        if (!/^https:\/\//i.test(url)) { toast.error('Enter an https URL'); setBusy(''); return; }
        await api.registerBuild({ app, channel, platform, version, buildNumber, notes, externalUrl: url });
        toast.success('Build added');
      }
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); setBusy(''); }
  }

  const inputCls = 'w-full rounded-lg border border-border bg-card2 px-3 py-2 text-sm outline-none focus:border-primary';
  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="mb-4 text-[17px] font-semibold">Add build</h3>
      <div className="mb-3.5 flex gap-1.5 rounded-xl border border-border bg-card2 p-1">
        {(['upload', 'link'] as const).map((s) => (
          <button key={s} onClick={() => setSrc(s)} className={`flex-1 rounded-lg py-2 text-[12.5px] ${src === s ? 'grad text-white' : 'text-muted-foreground'}`}>
            {s === 'upload' ? 'Upload file' : 'Paste link'}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputCls}>
            <option value="android">Android (APK / AAB)</option>
            <option value="ios">iOS (IPA)</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">Channel</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>
            <option value="production">production</option>
            <option value="preview">preview (test)</option>
            <option value="staging">staging</option>
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1"><label className="mb-1.5 block text-xs text-muted-foreground">Version</label><input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" className={inputCls} /></div>
          <div className="flex-1"><label className="mb-1.5 block text-xs text-muted-foreground">Build number</label><input value={buildNumber} onChange={(e) => setBuildNumber(e.target.value)} placeholder="42" className={inputCls} /></div>
        </div>
        <div><label className="mb-1.5 block text-xs text-muted-foreground">Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} min-h-[54px] resize-y`} /></div>
        {src === 'upload' ? (
          <div><label className="mb-1.5 block text-xs text-muted-foreground">File (.apk / .aab / .ipa)</label><input type="file" accept=".apk,.aab,.ipa" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={inputCls} /></div>
        ) : (
          <div><label className="mb-1.5 block text-xs text-muted-foreground">Install URL (https)</label><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inputCls} /></div>
        )}
        {busy && <div className="text-[12.5px] text-muted-foreground">Working… keep this tab open.</div>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!!busy} onClick={submit}>Add build</Button>
        </div>
      </div>
    </Modal>
  );
}
