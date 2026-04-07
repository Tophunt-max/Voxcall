import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { Phone, Clock, Coins, Video, Trash2 } from 'lucide-react';

function formatDuration(secs: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export default function CallSessions() {
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<{ pending_ended: number; active_ended: number } | null>(null);

  const loadCalls = () => {
    setLoading(true);
    api.callSessions().then(setCalls).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { loadCalls(); }, []);

  const handleCleanup = async () => {
    if (!confirm('This will mark all stuck pending calls (>10 min) and stuck active calls (>6 hr) as ended. Proceed?')) return;
    setCleaning(true);
    try {
      const res = await api.post('/api/admin/calls/cleanup-stuck', {});
      setCleanResult(res);
      loadCalls();
    } catch (e) {
      alert('Cleanup failed: ' + (e as any)?.message);
    } finally {
      setCleaning(false);
    }
  };

  const totalMins = calls.reduce((s, c) => s + Math.floor((c.duration_seconds || 0) / 60), 0);
  const totalRevenue = calls.reduce((s, c) => s + (c.coins_charged || 0), 0);
  const completed = calls.filter(c => c.status === 'ended').length;
  const stuckPending = calls.filter(c => c.status === 'pending').length;
  const stuckActive = calls.filter(c => c.status === 'active').length;

  const cols = [
    { key: 'caller', header: 'Caller',
      render: (c: any) => (
        <div>
          <p className="font-semibold text-sm">{c.caller_name || c.caller_id}</p>
          <p className="text-xs text-muted-foreground">{c.caller_email || ''}</p>
        </div>
      )
    },
    { key: 'host', header: 'Host',
      render: (c: any) => <span className="text-sm">{c.host_display_name || c.host_id}</span>
    },
    { key: 'type', header: 'Type',
      render: (c: any) => <Badge variant={c.type}>{c.type}</Badge>
    },
    { key: 'status', header: 'Status',
      render: (c: any) => <Badge variant={c.status}>{c.status}</Badge>
    },
    { key: 'duration', header: 'Duration', className: 'hidden sm:table-cell',
      render: (c: any) => <span className="text-sm">{formatDuration(c.duration_seconds)}</span>
    },
    { key: 'coins', header: 'Coins', className: 'hidden md:table-cell',
      render: (c: any) => (
        <span className="font-semibold text-amber-600 text-sm">{(c.coins_charged || 0).toLocaleString()}</span>
      )
    },
    { key: 'date', header: 'Date', className: 'hidden lg:table-cell',
      render: (c: any) => <span className="text-xs text-muted-foreground">{c.created_at ? new Date(c.created_at * 1000).toLocaleString() : '—'}</span>
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-bold text-lg">Call Sessions</h2>
          <p className="text-sm text-muted-foreground">All audio and video call history</p>
        </div>
        <button
          onClick={handleCleanup}
          disabled={cleaning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
          {cleaning ? 'Cleaning…' : 'Cleanup Stuck Calls'}
        </button>
      </div>

      {cleanResult && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          Cleanup done — {cleanResult.pending_ended} stuck-pending + {cleanResult.active_ended} stuck-active calls ended.
        </div>
      )}

      {(stuckPending > 0 || stuckActive > 0) && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
          ⚠️ {stuckPending} pending calls + {stuckActive} active calls may be stuck. Use "Cleanup Stuck Calls" to resolve.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard icon={Phone} label="Total Calls" value={calls.length} gradient="gradient-purple" />
        <StatCard icon={Clock} label="Total Minutes" value={totalMins.toLocaleString()} gradient="gradient-blue" />
        <StatCard icon={Coins} label="Revenue (Coins)" value={totalRevenue.toLocaleString()} gradient="gradient-orange" />
        <StatCard icon={Video} label="Completed" value={completed} gradient="gradient-green" />
      </div>

      <Table columns={cols} data={calls} loading={loading} empty="No call sessions yet" keyFn={c => c.id} />
    </div>
  );
}
