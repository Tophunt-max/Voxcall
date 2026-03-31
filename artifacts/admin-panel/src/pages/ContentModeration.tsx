import { useState } from 'react';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, Shield, Flag, AlertTriangle, CheckCircle, XCircle, Eye } from 'lucide-react';

const MOCK: any[] = [
  { id: 'R001', reporter: 'Rahul V.', reported_user: 'Host_X23', reported_type: 'host', reason: 'Inappropriate language during call', category: 'harassment', evidence: 'Call ID: C8821', status: 'pending', created_at: '2026-03-30' },
  { id: 'R002', reporter: 'Sunita R.', reported_user: 'User_Arjun', reported_type: 'user', reason: 'Sending spam messages in chat', category: 'spam', evidence: 'Chat ID: CH4421', status: 'reviewed', created_at: '2026-03-29' },
  { id: 'R003', reporter: 'Kavya N.', reported_user: 'Host_Priya', reported_type: 'host', reason: 'Profile photo is inappropriate', category: 'inappropriate_content', evidence: 'Profile URL shared', status: 'pending', created_at: '2026-03-29' },
  { id: 'R004', reporter: 'Arun P.', reported_user: 'User_Harsh', reported_type: 'user', reason: 'Fake profile with misleading info', category: 'fraud', evidence: 'Screenshots attached', status: 'actioned', action_taken: 'banned', created_at: '2026-03-28' },
  { id: 'R005', reporter: 'Meera S.', reported_user: 'Host_Ravi', reported_type: 'host', reason: 'Not respecting call duration limits', category: 'policy_violation', evidence: 'Session log', status: 'dismissed', created_at: '2026-03-27' },
];

const categoryColor: Record<string, string> = {
  harassment: 'text-red-600 bg-red-50',
  spam: 'text-amber-600 bg-amber-50',
  inappropriate_content: 'text-orange-600 bg-orange-50',
  fraud: 'text-red-700 bg-red-100',
  policy_violation: 'text-blue-600 bg-blue-50',
};

function UserAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-red-500'];
  const c = colors[name.charCodeAt(0) % colors.length];
  return <div className={`w-7 h-7 rounded-full ${c} flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0`}>{name[0]}</div>;
}

export default function ContentModeration() {
  const [rows, setRows] = useState<any[]>(MOCK);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const filtered = rows.filter(r => {
    const matchSearch = r.reported_user.toLowerCase().includes(search.toLowerCase()) || r.reason.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || r.status === filter;
    return matchSearch && matchFilter;
  });

  const takeAction = (action: string) => {
    if (!selected) return;
    setRows(rows.map(r => r.id === selected.id ? { ...r, status: action === 'dismiss' ? 'dismissed' : 'actioned', action_taken: action } : r));
    showToast(action === 'dismiss' ? 'Report dismissed' : `Action taken: ${action}`);
    setSelected(null);
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
            <p className="text-xs text-muted-foreground">Reporter: {r.reporter}</p>
          </div>
        </div>
      )
    },
    {
      key: 'reported', header: 'Reported',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={r.reported_user} />
          <div>
            <p className="text-sm font-semibold">{r.reported_user}</p>
            <Badge variant={r.reported_type}>{r.reported_type}</Badge>
          </div>
        </div>
      )
    },
    {
      key: 'category', header: 'Category', className: 'hidden sm:table-cell',
      render: (r: any) => <span className={`text-xs font-medium px-2 py-0.5 rounded-lg ${categoryColor[r.category] || 'bg-secondary text-foreground'}`}>{r.category.replace('_', ' ')}</span>
    },
    {
      key: 'status', header: 'Status',
      render: (r: any) => {
        const v = r.status === 'pending' ? 'pending' : r.status === 'actioned' ? 'banned' : r.status;
        return <Badge variant={v}>{r.status === 'actioned' ? r.action_taken || 'actioned' : r.status}</Badge>;
      }
    },
    { key: 'date', header: 'Date', className: 'hidden lg:table-cell', render: (r: any) => <span className="text-xs text-muted-foreground">{r.created_at}</span> },
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

      <Table columns={cols} data={filtered} loading={false} empty="No reports found" keyFn={r => r.id} />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Review Report ${selected?.id}`}>
        {selected && (
          <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={15} className="text-red-500" />
                <span className="text-sm font-semibold text-red-700">Reported Content</span>
              </div>
              <p className="text-sm text-red-600">{selected.reason}</p>
              <p className="text-xs text-red-400 mt-1">Evidence: {selected.evidence}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-secondary rounded-xl">
                <p className="text-xs text-muted-foreground">Reporter</p>
                <p className="font-semibold mt-0.5">{selected.reporter}</p>
              </div>
              <div className="p-3 bg-secondary rounded-xl">
                <p className="text-xs text-muted-foreground">Reported</p>
                <p className="font-semibold mt-0.5">{selected.reported_user}</p>
              </div>
            </div>
            <p className="text-sm"><span className="text-muted-foreground">Category:</span> <strong>{selected.category.replace('_', ' ')}</strong></p>
            <div className="space-y-2 pt-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Take Action</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Warn User', action: 'warned', color: 'bg-amber-500 hover:bg-amber-600' },
                  { label: 'Ban User', action: 'banned', color: 'bg-red-500 hover:bg-red-600' },
                  { label: 'Remove Content', action: 'content_removed', color: 'bg-orange-500 hover:bg-orange-600' },
                  { label: 'Dismiss', action: 'dismiss', color: 'bg-secondary hover:bg-secondary/80 text-foreground' },
                ].map(a => (
                  <button key={a.action} onClick={() => takeAction(a.action)}
                    className={`${a.color} text-white px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors`}>
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
