import { useState } from 'react';
import { useScope } from '@/scope';
import { useOtaState, useMetrics, useBuilds } from '@/lib/queries';
import { fmt, rel, shortId } from '@/lib/format';
import type { UpdateSummary } from '@/lib/api';
import { StatCard, UpdateBadges, RolloutBadge, Spinner } from '@/components/bits';
import { Badge } from '@/components/ui/badge';
import { UpdateDrawer } from '@/components/UpdateDrawer';

export function Overview() {
  const { app } = useScope();
  const state = useOtaState(app);
  const metrics = useMetrics(app);
  const builds = useBuilds(app);
  const [sel, setSel] = useState<UpdateSummary | null>(null);

  const channels = state.data?.channels ?? [];
  const updates = state.data?.updates ?? [];
  const m = metrics.data ?? {};
  const dc = (id: string) => m.byUpdate?.[id] ?? 0;

  if (state.isLoading) return <Spinner />;
  if (state.isError) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-300">Failed to load — check the worker &amp; console password.</div>;

  const distinctCh = new Set(channels.map((c) => c.channel)).size;
  const distinctRtv = new Set(channels.map((c) => c.runtimeVersion)).size;
  const mandatory = updates.filter((u) => u.forceUpdate).length;

  return (
    <>
      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard n={updates.length} label="Updates" />
        <StatCard n={distinctCh} label="Channels" />
        <StatCard n={distinctRtv} label="Runtime versions" />
        <StatCard n={mandatory} label="Mandatory" />
        <StatCard n={(builds.data?.builds ?? []).length} label="Builds" />
        <StatCard n={m.active7d ?? 0} label="Active devices (7d)" />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live now</h3>
        {updates.length > 0 && <span className="text-xs text-muted-foreground">last publish {rel(updates[0].createdAt)}</span>}
      </div>
      {channels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing published yet. Run <span className="font-mono">node ota-server/publish.mjs --app {app}</span>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((c) => (
            <div key={c.channel + '/' + c.runtimeVersion} className="rounded-xl border border-border bg-gradient-to-b from-card to-card2 p-4">
              <div className="flex items-center gap-2">
                <Badge tone="channel">{c.channel}</Badge>
                <RolloutBadge pct={c.rollout} />
                <span className="font-mono text-xs text-muted-foreground" title={c.runtimeVersion}>rtv {shortId(c.runtimeVersion)}</span>
              </div>
              <button onClick={() => setSel(updates.find((u) => u.id === c.updateId) ?? { id: c.updateId, liveOn: [], platforms: [], runtimeVersions: [], createdAt: null, runtimeVersion: null, forceUpdate: false, message: null, gitCommit: null })} className="mt-2 block font-mono text-[#9d7bff] hover:underline">
                {shortId(c.updateId)}
              </button>
              <div className="mt-1 text-xs text-muted-foreground">
                {fmt(c.createdAt)}{dc(c.updateId) ? ` · ${dc(c.updateId)} on this` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="mb-3 mt-7 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent updates</h3>
      {updates.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No updates yet.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-b from-card to-card2">
          <table className="w-full">
            <tbody>
              {updates.slice(0, 6).map((u) => (
                <tr key={u.id} onClick={() => setSel(u)} className="cursor-pointer border-t border-border first:border-t-0 hover:bg-primary/[0.06]">
                  <td className="px-4 py-3 font-mono text-sm">{shortId(u.id)}</td>
                  <td className="px-4 py-3"><UpdateBadges u={u} dc={dc(u.id)} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted-foreground">{rel(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UpdateDrawer app={app} update={sel} channels={channels} deviceCount={dc} onClose={() => setSel(null)} />
    </>
  );
}
