import { useState } from 'react';
import { useScope } from '@/scope';
import { useOtaState, useMetrics } from '@/lib/queries';
import { rel, fmt, shortId } from '@/lib/format';
import type { UpdateSummary } from '@/lib/api';
import { UpdateBadges, Spinner } from '@/components/bits';
import { UpdateDrawer } from '@/components/UpdateDrawer';

export function Updates() {
  const { app } = useScope();
  const state = useOtaState(app);
  const metrics = useMetrics(app);
  const [sel, setSel] = useState<UpdateSummary | null>(null);
  const [q, setQ] = useState('');

  const channels = state.data?.channels ?? [];
  const updates = state.data?.updates ?? [];
  const dc = (id: string) => metrics.data?.byUpdate?.[id] ?? 0;

  if (state.isLoading) return <Spinner />;

  const f = q.toLowerCase();
  const list = updates.filter((u) =>
    !f || (u.id + ' ' + (u.message ?? '') + ' ' + (u.gitCommit ?? '') + ' ' + u.runtimeVersions.join(' ')).toLowerCase().includes(f),
  );

  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by id, message, commit, runtime…"
        className="mb-4 w-full rounded-lg border border-border bg-card2 px-3.5 py-2.5 text-sm outline-none focus:border-primary"
      />
      {list.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {q ? 'No updates match your search.' : 'No updates published for this app yet.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-b from-card to-card2">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 pb-2.5 pt-3.5 font-semibold">Update</th>
                <th className="px-4 pb-2.5 pt-3.5 font-semibold">Runtime</th>
                <th className="px-4 pb-2.5 pt-3.5 font-semibold">Status</th>
                <th className="px-4 pb-2.5 pt-3.5 text-right font-semibold">Published</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} onClick={() => setSel(u)} className="cursor-pointer border-t border-border hover:bg-primary/[0.06]">
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm font-semibold">{shortId(u.id)}</div>
                    {u.message && <div className="mt-0.5 text-xs text-muted-foreground">{u.message.length > 60 ? u.message.slice(0, 58) + '…' : u.message}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground" title={u.runtimeVersions.join(', ')}>
                    {u.runtimeVersions.map(shortId).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3"><UpdateBadges u={u} dc={dc(u.id)} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted-foreground" title={fmt(u.createdAt)}>{rel(u.createdAt)}</td>
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
