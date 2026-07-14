import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Smartphone, Zap, ZapOff, Copy, ExternalLink } from 'lucide-react';
import { api, type AppId, type Pointer, type UpdateSummary } from '@/lib/api';
import { fmt, shortId } from '@/lib/format';
import { Drawer } from './Drawer';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

function copy(text: string) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast.success('Copied'), () => toast.error('Copy failed'));
}

function KV({ k, v, canCopy }: { k: string; v: string | null; canCopy?: boolean }) {
  const val = v || '—';
  return (
    <>
      <div className="text-muted-foreground text-[12.5px]">{k}</div>
      <div className="break-all font-mono text-sm">
        {val}
        {canCopy && val !== '—' && (
          <button onClick={() => copy(val)} className="ml-2 rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground hover:text-foreground">
            <Copy size={11} className="inline" />
          </button>
        )}
      </div>
    </>
  );
}

export function UpdateDrawer({
  app, update, channels, deviceCount, onClose,
}: {
  app: AppId;
  update: UpdateSummary | null;
  channels: Pointer[];
  deviceCount: (id: string) => number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const id = update?.id ?? '';
  const { data: detail, isLoading } = useQuery({
    queryKey: ['update', app, id],
    queryFn: () => api.update(app, id),
    enabled: !!id,
  });

  const channelNames = Array.from(new Set(channels.map((c) => c.channel)));
  if (channelNames.length === 0) channelNames.push('production');
  const liveOn = update?.liveOn ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['state', app] });
    qc.invalidateQueries({ queryKey: ['metrics', app] });
  }
  async function promote(channel: string) {
    if (!update) return;
    if (!window.confirm(`Make ${shortId(update.id)} live on "${channel}"?`)) return;
    try {
      const r = await api.promote({ app, channel, updateId: update.id, rollout: 100 });
      toast.success(`Live on ${channel} · ${r.rollout}%`);
      invalidate();
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Promote failed'); }
  }
  async function toggleForce() {
    if (!detail) return;
    const next = !detail.forceUpdate;
    if (!window.confirm(next ? 'Mark this update mandatory?' : 'Remove mandatory flag?')) return;
    try {
      await api.setForce({ app, updateId: id, force: next });
      toast.success(next ? 'Marked mandatory' : 'Mandatory flag removed');
      qc.invalidateQueries({ queryKey: ['update', app, id] });
      invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Drawer open={!!update} onClose={onClose} title={shortId(id)}>
      {isLoading || !detail ? (
        <div className="spin mx-auto my-12 h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {liveOn.map((l) => <Badge key={l} tone="live">live · {l}</Badge>)}
            {detail.forceUpdate && <Badge tone="force">mandatory</Badge>}
            {liveOn.length === 0 && <span className="text-[12.5px] text-muted-foreground">Not live on any channel</span>}
          </div>

          <div className="mb-5 grid grid-cols-[132px_1fr] gap-x-3.5 gap-y-2.5">
            <KV k="Update ID" v={detail.id} canCopy />
            <KV k="Created" v={fmt(detail.createdAt)} />
            <KV k="Runtime" v={detail.runtimeVersions.join(', ')} canCopy />
            <KV k="Devices (now)" v={String(deviceCount(detail.id))} />
            <KV k="Git commit" v={detail.gitCommit} canCopy />
            <KV k="Published" v={fmt(detail.publishedAt)} />
            {detail.easProjectId && <KV k="EAS project" v={detail.easProjectId} canCopy />}
            <KV k="Message" v={detail.message} />
            <KV k="Manifest URL" v={detail.manifestUrl} canCopy />
          </div>

          <h3 className="mb-3 mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</h3>
          <div className="flex flex-wrap gap-2">
            {channelNames.map((ch) => {
              const live = liveOn.some((l) => l.startsWith(ch + ' @ '));
              return (
                <Button key={ch} size="sm" variant={live ? 'live' : 'outline'} disabled={live} onClick={() => promote(ch)}>
                  {live ? 'Live · ' : 'Set live · '}{ch}
                </Button>
              );
            })}
            <Button size="sm" variant={detail.forceUpdate ? 'outline' : 'danger'} onClick={toggleForce}>
              {detail.forceUpdate ? <ZapOff size={13} /> : <Zap size={13} />}
              {detail.forceUpdate ? 'Make optional' : 'Make mandatory'}
            </Button>
          </div>

          <h3 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Platforms &amp; assets</h3>
          {Object.entries(detail.platforms).map(([plat, pr]) => (
            <div key={plat} className="mb-3 rounded-xl border border-border bg-card2 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge tone="plat"><Smartphone size={11} /> {plat}</Badge>
                  <span className="font-mono text-xs text-muted-foreground" title={pr.runtimeVersion}>rtv {shortId(pr.runtimeVersion)}</span>
                </div>
                <span className="text-xs text-muted-foreground">{pr.assetCount} asset{pr.assetCount === 1 ? '' : 's'}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[12.5px]">
                <span className="text-muted-foreground">launch bundle</span>
                <a href={pr.launchAsset.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[#b9a8ff]">
                  <ExternalLink size={12} /> download
                </a>
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">sha256: {pr.launchAsset.hash}</div>
            </div>
          ))}
        </>
      )}
    </Drawer>
  );
}
