import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, Flag, AlertTriangle, Eye } from 'lucide-react';

const categoryColor: Record<string, string> = {
  harassment: 'text-red-600 bg-red-50',
  spam: 'text-amber-600 bg-amber-50',
  inappropriate_content: 'text-orange-600 bg-orange-50',
  fraud: 'text-red-700 bg-red-100',
  policy_violation: 'text-blue-600 bg-blue-50',
};

function UserAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-red-500'];
  const c = colors[(name || 'U').charCodeAt(0) % colors.length];
  return <div className={`w-7 h-7 rounded-full ${c} flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0`}>{(name || 'U')[0]}</div>;
}

export default function ContentModeration() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.contentReports().then(setRows).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const filtered = rows.filter(r => {
    const matchSearch = (r.reported_user || '').toLowerCase().includes(search.toLowerCase()) || (r.reason || '').toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || r.status === filter;
    return matchSearch && matchFilter;
  });

  const takeAction = async (action: string) => {
    if (!selected) return;
    try {
      const newStatus = action === 'dismiss' ? 'dismissed' : 'actioned';
      await api.updateContentReport(selected.id, { status: newStatus, action_taken: action === 'dismiss' ? null : action });
      setRows(rows.map(r => r.id === selected.id ? { ...r, status: newStatus, action_taken: action } : r));
      showToast(action === 'dismiss' ? 'Report dismissed' : `Action taken: ${action}`);
      setSelected(null);
    } catch { showToast('Failed to take action'); }
  };

  const cols = [
    {
      key: 'report', header: 'Report',
      render: (r: any) => (
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${r.status === 'pending' ? 'bg-red-100' : 'bg-secondary'}`}>
            <Flag size={14} className={r.status === 'pending' ? 'text-red-500' : 'text-muted-foreground'} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{r.reason}</p>
            <p className="text-xs text-muted-foreground">Reporter: {r.reporter_name || r.reporter || '—'}</p>
          </div>
        </div>
      )
    },
    {
      key: 'reported', header: 'Reported',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={r.reported_user || 'U'} />
          <div>
            <p className="text-sm font-semibold">{r.reported_user || '—'}</p>
            <Badge variant={r.reported_type}>{r.reported_type}</Badge>
          </div>
        </div>
      )
    },
    {
      key: 'category', header: 'Category', className: 'hidden sm:table-cell',
      render: (r: any) => <span className={`text-xs font-medium px-2 py-0.5 rounded-lg ${categoryColor[r.category] || 'bg-secondary text-foreground'}`}>{(r.category || '').replace('_', ' ')}</span>
    },
    {
      key: 'status', header: 'Status',
      render: (r: any) => {
        const v = r.status === 'pending' ? 'pending' : r.status === 'actioned' ? 'banned' : r.status;
        return <Badge variant={v}>{r.status === 'actioned' ? r.action_taken || 'actioned' : r.status}</Badge>;
      }
    },
    {
      key: 'date', header: 'Date', className: 'hidden lg:table-cell',
      render: (r: any) => <span className="text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : '—'}</span>
    },
    {
      key: 'actions', header: '',
      render: (r: any) => r.status === 'pending' && (
        <button onClick={() => setSelected(r)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline px-2 py-1">
          <Eye size={13} /> Review
        </button>
      )
    },
  ];

  const pendingCount = rows.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Pending Review', value: pendingCount, color: 'text-red-600' },
          { label: 'Reviewed', value: rows.filter(r => r.status === 'reviewed').length, color: 'text-blue-600' },
          { label: 'Actioned', value: rows.filter(r => r.status === 'actioned').length, color: 'text-amber-600' },
          { label: 'Dismissed', value: rows.filter(r => r.status === 'dismissed').length, color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Content Moderation</h2>
          <p className="text-sm text-muted-foreground">{pendingCount} reports need review</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none w-48"
              placeholder="Search reports..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="px-3 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none"
            value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
      </div>

      <Table columns={cols} data={filtered} loading={loading} empty="No reports found" keyFn={r => r.id} />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Review Report #${(selected?.id || '').slice(0, 8)}`}>
        {selected && (
          <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={15} className="text-red-500" />
                <span className="text-sm font-semibold text-red-700">Reported Content</span>
              </div>
              <p className="text-sm text-red-600">{selected.reason}</p>
              {selected.evidence && <p className="text-xs text-red-400 mt-1">Evidence: {selected.evidence}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-secondary rounded-xl">
                <p className="text-xs text-muted-foreground">Reporter</p>
                <p className="font-semibold mt-0.5">{selected.reporter_name || selected.reporter || '—'}</p>
              </div>
              <div className="p-3 bg-secondary rounded-xl">
                <p className="text-xs text-muted-foreground">Reported</p>
                <p className="font-semibold mt-0.5">{selected.reported_user || '—'}</p>
              </div>
            </div>
            <p className="text-sm"><span className="text-muted-foreground">Category:</span> <strong>{(selected.category || '').replace('_', ' ')}</strong></p>
            <div className="space-y-2 pt-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Take Action</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Warn User', action: 'warned', color: 'bg-amber-500 hover:bg-amber-600 text-white' },
                  { label: 'Ban User', action: 'banned', color: 'bg-red-500 hover:bg-red-600 text-white' },
                  { label: 'Remove Content', action: 'content_removed', color: 'bg-orange-500 hover:bg-orange-600 text-white' },
                  { label: 'Dismiss', action: 'dismiss', color: 'bg-secondary hover:bg-secondary/80 text-foreground' },
                ].map(a => (
                  <button key={a.action} onClick={() => takeAction(a.action)}
                    className={`${a.color} px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors`}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
