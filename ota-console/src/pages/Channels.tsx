import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useScope } from '@/scope';
import { useOtaState } from '@/lib/queries';
import { rel, shortId } from '@/lib/format';
import { api, type Pointer } from '@/lib/api';
import { RolloutBadge, Spinner } from '@/components/bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function Channels() {
  const { app } = useScope();
  const state = useOtaState(app);
  const qc = useQueryClient();
  const [rollInputs, setRollInputs] = useState<Record<string, string>>({});
  const [promoteSel, setPromoteSel] = useState<Record<string, string>>({});
  const [promoteRoll, setPromoteRoll] = useState<Record<string, string>>({});

  if (state.isLoading) return <Spinner />;
  const channels = state.data?.channels ?? [];
  const updates = state.data?.updates ?? [];
  if (updates.length === 0) {
    return <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Publish an update first — then you can promote / roll back channels here.</div>;
  }

  const names = Array.from(new Set(channels.map((c) => c.channel)));
  if (names.length === 0) names.push('production');
  const byName: Record<string, Pointer[]> = {};
  channels.forEach((p) => { (byName[p.channel] = byName[p.channel] || []).push(p); });

  function invalidate() { qc.invalidateQueries({ queryKey: ['state', app] }); }

  async function setRollout(ch: string, cur: number) {
    const pct = parseInt(rollInputs[ch] ?? String(cur), 10);
    if (!(pct >= 1 && pct <= 100)) { toast.error('Rollout must be 1–100'); return; }
    try { const r = await api.setRollout({ app, channel: ch, rollout: pct }); toast.success(`Rollout ${r.rollout}% on ${ch}`); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  }
  async function promote(ch: string) {
    const updateId = promoteSel[ch] || updates[0].id;
    const pct = parseInt(promoteRoll[ch] ?? '100', 10);
    if (!window.confirm(`Make ${shortId(updateId)} live on "${ch}" at ${pct}%?`)) return;
    try { const r = await api.promote({ app, channel: ch, updateId, rollout: pct >= 1 && pct <= 100 ? pct : 100 }); toast.success(`Live on ${ch} · ${r.rollout}%`); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Promote failed'); }
  }

  return (
    <div className="space-y-3">
      {names.map((ch) => {
        const ptrs = byName[ch] ?? [];
        const cur = ptrs.length ? ptrs[0].rollout ?? 100 : 100;
        return (
          <div key={ch} className="rounded-xl border border-border bg-gradient-to-b from-card to-card2 p-4">
            <div className="flex items-center gap-2">
              <Badge tone="channel">{ch}</Badge>
              <RolloutBadge pct={cur} />
              <span className="text-xs text-muted-foreground">{ptrs.length} runtime version{ptrs.length === 1 ? '' : 's'}</span>
            </div>

            {ptrs.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {ptrs.map((pt) => (
                  <div key={pt.runtimeVersion} className="flex items-center justify-between border-t border-border pt-1.5 text-[12.5px]">
                    <span className="font-mono text-muted-foreground" title={pt.runtimeVersion}>rtv {shortId(pt.runtimeVersion)}</span>
                    <span className="font-mono">{shortId(pt.updateId)}</span>
                    <span className="text-muted-foreground">{rel(pt.createdAt)}</span>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span className="text-xs text-muted-foreground">Rollout</span>
                  <input
                    type="number" min={1} max={100} defaultValue={cur}
                    onChange={(e) => setRollInputs((s) => ({ ...s, [ch]: e.target.value }))}
                    className="w-20 rounded-lg border border-border bg-card2 px-2 py-1.5 text-sm outline-none focus:border-primary"
                  />
                  <span className="text-xs text-muted-foreground">% of devices</span>
                  <Button size="sm" variant="outline" onClick={() => setRollout(ch, cur)}>Update</Button>
                  {cur < 100 && <Button size="sm" variant="outline" onClick={() => { setRollInputs((s) => ({ ...s, [ch]: '100' })); api.setRollout({ app, channel: ch, rollout: 100 }).then(() => { toast.success('Rolled out to 100%'); invalidate(); }).catch((e) => toast.error(e instanceof Error ? e.message : 'Failed')); }}>Roll out 100%</Button>}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-[12.5px] text-muted-foreground">No pointer yet.</div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <select
                value={promoteSel[ch] ?? updates[0].id}
                onChange={(e) => setPromoteSel((s) => ({ ...s, [ch]: e.target.value }))}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card2 px-2.5 py-2 text-sm outline-none focus:border-primary"
              >
                {updates.map((u) => (
                  <option key={u.id} value={u.id}>{shortId(u.id)} · rtv {u.runtimeVersions.map(shortId).join(', ')} · {rel(u.createdAt)}</option>
                ))}
              </select>
              <input
                type="number" min={1} max={100} defaultValue={100} title="rollout %"
                onChange={(e) => setPromoteRoll((s) => ({ ...s, [ch]: e.target.value }))}
                className="w-16 rounded-lg border border-border bg-card2 px-2 py-2 text-sm outline-none focus:border-primary"
              />
              <Button size="sm" onClick={() => promote(ch)}>Set live</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
