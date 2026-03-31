import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { Phone, Clock, Coins, Video } from 'lucide-react';

function formatDuration(secs: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export default function CallSessions() {
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.callSessions().then(setCalls).catch(console.error).finally(() => setLoading(false));
  }, []);

  const totalMins = calls.reduce((s, c) => s + Math.floor((c.duration_seconds || 0) / 60), 0);
  const totalRevenue = calls.reduce((s, c) => s + (c.coins_charged || 0), 0);
  const completed = calls.filter(c => c.status === 'ended').length;

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
      <div>
        <h2 className="font-bold text-lg">Call Sessions</h2>
        <p className="text-sm text-muted-foreground">All audio and video call history</p>
      </div>

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
