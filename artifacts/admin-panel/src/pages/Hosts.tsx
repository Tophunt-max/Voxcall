import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Star, CheckCircle, XCircle, Circle } from 'lucide-react';

function Toggle({ value, onChange, color = 'bg-green-500' }: { value: boolean; onChange: () => void; color?: string }) {
  return (
    <button onClick={onChange} className={`w-10 h-5 rounded-full transition-colors relative ${value ? color : 'bg-slate-200'}`}>
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${value ? 'left-[calc(100%-18px)]' : 'left-0.5'}`} />
    </button>
  );
}

function HostAvatar({ name, rating }: { name: string; rating: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl gradient-purple flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
        {name?.[0]?.toUpperCase() || 'H'}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-sm">{name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <Star size={10} className="text-amber-400 fill-amber-400" />
          <span className="text-xs text-muted-foreground">{rating?.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Hosts() {
  const [hosts, setHosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const load = () => { setLoading(true); api.hosts().then(setHosts).finally(() => setLoading(false)); };
  useEffect(load, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const toggle = async (id: string, field: string, cur: boolean) => {
    try {
      await api.updateHost(id, { [field]: !cur ? 1 : 0 });
      load();
      showToast('Host updated');
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const cols = [
    {
      key: 'host', header: 'Host',
      render: (h: any) => <HostAvatar name={h.display_name || h.name} rating={h.rating} />
    },
    { key: 'email', header: 'Email', className: 'hidden md:table-cell',
      render: (h: any) => <span className="text-sm text-muted-foreground">{h.email}</span>
    },
    { key: 'rate', header: 'Rate', className: 'hidden sm:table-cell',
      render: (h: any) => (
        <span className="text-sm font-semibold text-violet-600">{h.coins_per_minute} <span className="text-muted-foreground font-normal">coins/min</span></span>
      )
    },
    { key: 'reviews', header: 'Reviews', className: 'hidden lg:table-cell',
      render: (h: any) => <span className="text-sm">{(h.review_count || 0).toLocaleString()}</span>
    },
    { key: 'status', header: 'Online',
      render: (h: any) => (
        <Badge variant={h.is_online ? 'success' : 'default'}>{h.is_online ? 'Online' : 'Offline'}</Badge>
      )
    },
    { key: 'active', header: 'Active',
      render: (h: any) => <Toggle value={!!h.is_active} onChange={() => toggle(h.id, 'is_active', !!h.is_active)} />
    },
    { key: 'top', header: 'Top Rated', className: 'hidden sm:table-cell',
      render: (h: any) => (
        <button onClick={() => toggle(h.id, 'is_top_rated', !!h.is_top_rated)}>
          <Star size={17} className={h.is_top_rated ? 'text-amber-400 fill-amber-400' : 'text-slate-300'} />
        </button>
      )
    },
    { key: 'id_verified', header: 'ID Verified', className: 'hidden lg:table-cell',
      render: (h: any) => (
        <button onClick={() => toggle(h.id, 'identity_verified', !!h.identity_verified)}>
          {h.identity_verified
            ? <CheckCircle size={17} className="text-green-500" />
            : <Circle size={17} className="text-slate-300" />
          }
        </button>
      )
    },
  ];

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      <div>
        <h2 className="font-bold text-lg">Hosts</h2>
        <p className="text-sm text-muted-foreground">{hosts.length} registered hosts — click toggles to update instantly</p>
      </div>

      <Table columns={cols} data={hosts} loading={loading} empty="No hosts registered yet" keyFn={h => h.id} />
    </div>
  );
}
