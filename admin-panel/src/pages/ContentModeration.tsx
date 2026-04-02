import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, Flag, AlertTriangle, Eye, Shield, Clock, Phone, Mail, User, ChevronRight } from 'lucide-react';

const categoryColor: Record<string, string> = {
  harassment: 'text-red-600 bg-red-50',
  spam: 'text-amber-600 bg-amber-50',
  inappropriate_content: 'text-orange-600 bg-orange-50',
  fake_profile: 'text-purple-600 bg-purple-50',
  fraud: 'text-red-700 bg-red-100',
  policy_violation: 'text-blue-600 bg-blue-50',
  other: 'text-gray-600 bg-gray-50',
};

const categoryLabel: Record<string, string> = {
  harassment: 'Harassment',
  spam: 'Spam',
  inappropriate_content: 'Inappropriate Content',
  fake_profile: 'Fake Profile',
  fraud: 'Fraud / Scam',
  policy_violation: 'Policy Violation',
  other: 'Other',
};

function UserAvatar({ name, avatar }: { name: string; avatar?: string }) {
  if (avatar) return <img src={avatar} alt={name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />;
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-red-500'];
  const c = colors[(name || 'U').charCodeAt(0) % colors.length];
  return <div className={`w-8 h-8 rounded-full ${c} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>{(name || 'U')[0].toUpperCase()}</div>;
}

function timeAgo(ts: number) {
  if (!ts) return '—';
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ContentModeration() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [toast, setToast] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    api.contentReports().then(setRows).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q || (r.reported_user || '').toLowerCase().includes(q) ||
      (r.reporter_name || r.reporter_display_name || '').toLowerCase().includes(q) ||
      (r.reason || '').toLowerCase().includes(q) ||
      (r.reported_user_phone || '').includes(q);
    const matchFilter = filter === 'all' || r.status === filter;
    return matchSearch && matchFilter;
  });

  const takeAction = async (action: string) => {
    if (!selected || actionLoading) return;
    setActionLoading(true);
    try {
      const newStatus = action === 'dismiss' ? 'dismissed' : action === 'review' ? 'reviewed' : 'actioned';
      const actionTaken = action === 'dismiss' || action === 'review' ? null : action;
      await api.updateContentReport(selected.id, { status: newStatus, action_taken: actionTaken });
      setRows(rows.map(r => r.id === selected.id ? { ...r, status: newStatus, action_taken: actionTaken } : r));
      showToast(action === 'dismiss' ? 'Report dismissed' : action === 'review' ? 'Marked as reviewed' : `Action taken: ${action}`);
      setSelected(null);
    } catch { showToast('Failed to take action'); }
    setActionLoading(false);
  };

  const cols = [
    {
      key: 'report', header: 'Report',
      render: (r: any) => (
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${r.status === 'pending' ? 'bg-red-100' : r.status === 'actioned' ? 'bg-amber-100' : 'bg-secondary'}`}>
            <Flag size={15} className={r.status === 'pending' ? 'text-red-500' : r.status === 'actioned' ? 'text-amber-600' : 'text-muted-foreground'} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate max-w-[200px]">{r.reason}</p>
            <p className="text-xs text-muted-foreground">by {r.reporter_display_name || r.reporter_name || 'Unknown'} · {timeAgo(r.created_at)}</p>
          </div>
        </div>
      )
    },
    {
      key: 'reported', header: 'Reported User',
      render: (r: any) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar name={r.reported_user_name || r.reported_user || 'U'} avatar={r.reported_user_avatar} />
          <div>
            <p className="text-sm font-semibold">{r.reported_user_name || r.reported_user || '—'}</p>
            <p className="text-xs text-muted-foreground">{r.reported_type === 'host' ? '🎙 Host' : '👤 User'}</p>
          </div>
        </div>
      )
    },
    {
      key: 'category', header: 'Category', className: 'hidden md:table-cell',
      render: (r: any) => (
        <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${categoryColor[r.category] || 'bg-secondary text-foreground'}`}>
          {categoryLabel[r.category] || (r.category || 'other').replace(/_/g, ' ')}
        </span>
      )
    },
    {
      key: 'status', header: 'Status',
      render: (r: any) => {
        const actionVariant: Record<string, string> = {
          banned: 'banned', warned: 'warning', suspended_7d: 'actioned',
          content_removed: 'actioned', warned_actioned: 'warning',
        };
        const v = r.status === 'actioned'
          ? (actionVariant[r.action_taken] || 'actioned')
          : (r.status || 'default');
        const label = r.status === 'actioned'
          ? (r.action_taken || 'actioned').replace(/_/g, ' ')
          : r.status;
        return <Badge variant={v}>{label}</Badge>;
      }
    },
    {
      key: 'actions', header: '',
      render: (r: any) => (
        <button onClick={() => setSelected(r)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline px-2 py-1.5 rounded-lg hover:bg-primary/5 transition-colors">
          <Eye size={13} /> Review
        </button>
      )
    },
  ];

  const pendingCount = rows.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl animate-in fade-in slide-in-from-bottom-2">{toast}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Pending Review', value: pendingCount, color: 'text-red-600', icon: AlertTriangle, iconColor: 'text-red-400' },
          { label: 'Reviewed', value: rows.filter(r => r.status === 'reviewed').length, color: 'text-blue-600', icon: Eye, iconColor: 'text-blue-400' },
          { label: 'Actioned', value: rows.filter(r => r.status === 'actioned').length, color: 'text-amber-600', icon: Shield, iconColor: 'text-amber-400' },
          { label: 'Dismissed', value: rows.filter(r => r.status === 'dismissed').length, color: 'text-green-600', icon: Clock, iconColor: 'text-green-400' },
        ].map(st => (
          <div key={st.label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between">
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
              <st.icon size={18} className={st.iconColor} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{st.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Content Moderation</h2>
          <p className="text-sm text-muted-foreground">{pendingCount > 0 ? `${pendingCount} reports need review` : 'All reports reviewed'}</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 w-52"
              placeholder="Search by name, reason..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="px-3 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
            value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
      </div>

      <Table columns={cols} data={filtered} loading={loading} empty="No reports found" keyFn={r => r.id} />

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Review Report">
        {selected && (
          <div className="space-y-5">
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-red-500" />
                <span className="text-sm font-bold text-red-700">Report Reason</span>
              </div>
              <p className="text-sm text-red-600 font-medium">{selected.reason}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-lg ${categoryColor[selected.category] || 'bg-secondary text-foreground'}`}>
                  {categoryLabel[selected.category] || (selected.category || '').replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-red-400">{timeAgo(selected.created_at)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 bg-secondary rounded-xl space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><User size={12} /> Reporter</p>
                <p className="font-semibold text-sm">{selected.reporter_display_name || selected.reporter_name || '—'}</p>
                {selected.reporter_phone && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone size={11} /> {selected.reporter_phone}</p>
                )}
                {selected.reporter_email && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail size={11} /> {selected.reporter_email}</p>
                )}
              </div>
              <div className="p-4 bg-secondary rounded-xl space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Flag size={12} /> Reported {selected.reported_type === 'host' ? 'Host' : 'User'}</p>
                <div className="flex items-center gap-2">
                  <UserAvatar name={selected.reported_user_name || selected.reported_user || 'U'} avatar={selected.reported_user_avatar} />
                  <div>
                    <p className="font-semibold text-sm">{selected.reported_user_name || selected.reported_user || '—'}</p>
                    {selected.reported_user_phone && <p className="text-xs text-muted-foreground">{selected.reported_user_phone}</p>}
                  </div>
                </div>
              </div>
            </div>

            {selected.status !== 'pending' && (
              <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                <p className="text-xs font-semibold text-amber-700">Previous Action: <span className="capitalize">{(selected.action_taken || selected.status || '').replace(/_/g, ' ')}</span></p>
              </div>
            )}

            {(selected.status === 'pending' || selected.status === 'reviewed') ? (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Take Action</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Warn User', action: 'warned', color: 'bg-amber-500 hover:bg-amber-600 text-white' },
                    { label: 'Ban User', action: 'banned', color: 'bg-red-500 hover:bg-red-600 text-white' },
                    { label: 'Suspend 7 Days', action: 'suspended_7d', color: 'bg-orange-500 hover:bg-orange-600 text-white' },
                    { label: 'Remove Content', action: 'content_removed', color: 'bg-purple-500 hover:bg-purple-600 text-white' },
                  ].map(a => (
                    <button key={a.action} onClick={() => takeAction(a.action)} disabled={actionLoading}
                      className={`${a.color} px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50`}>
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {selected.status === 'pending' && (
                    <button onClick={() => takeAction('review')} disabled={actionLoading}
                      className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                      Mark Reviewed
                    </button>
                  )}
                  <button onClick={() => takeAction('dismiss')} disabled={actionLoading}
                    className={`bg-secondary hover:bg-secondary/80 text-foreground px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${selected.status === 'pending' ? '' : 'col-span-2'}`}>
                    Dismiss Report
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-1">
                <button onClick={() => setSelected(null)}
                  className="w-full bg-secondary hover:bg-secondary/80 text-foreground px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
