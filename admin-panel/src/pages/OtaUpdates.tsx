import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmDialog';
import {
  RefreshCw, Rocket, Smartphone, Zap, ZapOff, GitCommit, Radio, History, ArrowUpCircle,
} from 'lucide-react';

// ─── OTA Update Console ──────────────────────────────────────────────────────
// Manages the self-hosted Expo Updates objects in R2 (published by
// ota-server/publish.mjs, served by the OTA Worker). This screen does NOT
// publish bundles — that stays in the CLI/CI which runs `expo export`. Here an
// operator can: see the update history + which update is live on each channel,
// promote or roll back a channel pointer, and toggle the forced-update flag.

type AppId = 'user' | 'host';

type Channel = { channel: string; runtimeVersion: string; updateId: string; createdAt: string | null };
type Update = {
  id: string;
  createdAt: string | null;
  runtimeVersion: string | null;
  forceUpdate: boolean;
  message: string | null;
  gitCommit: string | null;
  platforms: string[];
  liveOn: string[];
};

const APPS: { id: AppId; label: string }[] = [
  { id: 'user', label: 'User app (voxlink)' },
  { id: 'host', label: 'Host app (voxlink-host)' },
];

function short(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}
function when(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function OtaUpdates() {
  const { confirm } = useConfirm();
  const [app, setApp] = useState<AppId>('user');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>(''); // updateId currently mutating
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api
      .otaState(app)
      .then((d) => {
        setChannels(d.channels ?? []);
        setUpdates(d.updates ?? []);
        setErr('');
      })
      .catch((e: unknown) => {
        console.error('Failed to load OTA state:', e);
        setErr(e instanceof Error ? e.message : 'Failed to load OTA state');
      })
      .finally(() => setLoading(false));
  }, [app]);

  useEffect(() => {
    load();
  }, [load]);

  // Distinct channel names seen in R2 — the promote targets. Fall back to the
  // conventional "production" channel when nothing has been published yet.
  const channelNames = useMemo(() => {
    const set = new Set(channels.map((c) => c.channel));
    if (set.size === 0) set.add('production');
    return [...set].sort();
  }, [channels]);

  async function promote(u: Update, channel: string) {
    if (!u.runtimeVersion) {
      toast.error('This update has no runtimeVersion and cannot be promoted.');
      return;
    }
    const isLiveHere = u.liveOn.includes(`${channel} @ ${u.runtimeVersion}`);
    if (isLiveHere) {
      toast.info(`Already live on ${channel} @ ${u.runtimeVersion}.`);
      return;
    }
    const ok = await confirm({
      title: `Make this update live on "${channel}"?`,
      description: `Clients on ${app} with runtimeVersion ${u.runtimeVersion} on the "${channel}" channel will receive update ${short(u.id)} on their next check. Use this to roll forward or to roll back to an older update.`,
      confirmLabel: 'Set live',
    });
    if (!ok) return;
    setBusy(u.id);
    try {
      await api.otaPromote({ app, channel, runtimeVersion: u.runtimeVersion, updateId: u.id });
      toast.success(`Live on ${channel} @ ${u.runtimeVersion}`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Promote failed');
    } finally {
      setBusy('');
    }
  }

  async function toggleForce(u: Update) {
    const next = !u.forceUpdate;
    const ok = await confirm({
      title: next ? 'Mark update as mandatory?' : 'Remove mandatory flag?',
      description: next
        ? `Any client that receives update ${short(u.id)} will show a blocking updater and reload immediately instead of applying silently on next restart.`
        : `Update ${short(u.id)} will apply silently on the next app cold start instead of forcing an immediate reload.`,
      confirmLabel: next ? 'Make mandatory' : 'Make optional',
      variant: next ? 'destructive' : 'default',
    });
    if (!ok) return;
    setBusy(u.id);
    try {
      await api.otaSetForce({ app, updateId: u.id, force: next });
      toast.success(next ? 'Update marked mandatory' : 'Mandatory flag removed');
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to update flag');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Rocket size={20} className="text-violet-600" /> OTA Updates
          </h2>
          <p className="text-sm text-muted-foreground">
            Self-hosted Expo Updates — manage published bundles: history, live channel pointers, promote / rollback, and forced updates. Publishing runs from the CLI/CI.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-xl bg-card hover:bg-accent"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* App selector */}
      <div className="flex flex-wrap gap-2">
        {APPS.map((a) => (
          <button
            key={a.id}
            onClick={() => setApp(a.id)}
            className={`px-3 py-1.5 text-xs rounded-full border ${
              app === a.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {err && <div className="px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">{err}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {/* Live channel pointers */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
              <Radio size={15} /> Live channels
            </h3>
            {channels.length === 0 ? (
              <div className="text-sm text-muted-foreground px-4 py-6 rounded-xl border border-dashed border-border text-center">
                No channel pointers yet. Publish an update with{' '}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">node ota-server/publish.mjs --app {app}</code>.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {channels.map((c) => (
                  <div key={`${c.channel}/${c.runtimeVersion}`} className="p-4 rounded-xl border border-border bg-card">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-violet-100 text-violet-700">{c.channel}</span>
                      <span className="text-xs text-muted-foreground">rtv {c.runtimeVersion}</span>
                    </div>
                    <p className="text-sm mt-2 font-mono">{short(c.updateId)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{when(c.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Update history */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
              <History size={15} /> Update history ({updates.length})
            </h3>
            {updates.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-16">No updates published for this app yet.</div>
            ) : (
              <div className="space-y-2">
                {updates.map((u) => {
                  const isBusy = busy === u.id;
                  return (
                    <div key={u.id} className="p-4 rounded-xl border border-border bg-card">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-mono font-semibold">{short(u.id)}</span>
                        <span className="text-xs text-muted-foreground">rtv {u.runtimeVersion ?? '—'}</span>
                        {u.platforms.map((p) => (
                          <span key={p} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            <Smartphone size={10} /> {p}
                          </span>
                        ))}
                        {u.forceUpdate && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                            <Zap size={10} /> mandatory
                          </span>
                        )}
                        {u.liveOn.map((l) => (
                          <span key={l} className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                            <Radio size={10} /> live · {l}
                          </span>
                        ))}
                      </div>

                      {u.message && <p className="text-sm mt-2 break-words">{u.message}</p>}
                      <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{when(u.createdAt)}</span>
                        {u.gitCommit && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <GitCommit size={11} /> {u.gitCommit.slice(0, 8)}
                          </span>
                        )}
                      </p>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border">
                        {channelNames.map((ch) => {
                          const liveHere = u.runtimeVersion ? u.liveOn.includes(`${ch} @ ${u.runtimeVersion}`) : false;
                          return (
                            <button
                              key={ch}
                              disabled={isBusy || liveHere}
                              onClick={() => promote(u, ch)}
                              title={liveHere ? `Already live on ${ch}` : `Make live on ${ch}`}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                                liveHere
                                  ? 'border-green-200 bg-green-50 text-green-700 cursor-default'
                                  : 'border-border bg-card hover:bg-accent'
                              }`}
                            >
                              <ArrowUpCircle size={13} />
                              {liveHere ? `Live · ${ch}` : `Set live · ${ch}`}
                            </button>
                          );
                        })}
                        <button
                          disabled={isBusy}
                          onClick={() => toggleForce(u)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ml-auto ${
                            u.forceUpdate
                              ? 'border-border bg-card hover:bg-accent'
                              : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                          }`}
                        >
                          {u.forceUpdate ? <ZapOff size={13} /> : <Zap size={13} />}
                          {u.forceUpdate ? 'Make optional' : 'Make mandatory'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
