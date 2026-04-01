import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Search, Shield, User, Coins, Bell, Settings, Trash2, Edit, CheckCircle, XCircle, Download, RefreshCw } from 'lucide-react';

const ACTION_ICONS: Record<string, any> = { approve: CheckCircle, reject: XCircle, ban: Shield, unban: Shield, edit: Edit, delete: Trash2, send: Bell, update: Settings, create: Edit, coins: Coins, login: User };
const ACTION_COLORS: Record<string, string> = {
  approve: 'text-green-600 bg-green-100', reject: 'text-red-600 bg-red-100',
  ban: 'text-red-600 bg-red-100', unban: 'text-green-600 bg-green-100',
  edit: 'text-blue-600 bg-blue-100', delete: 'text-red-600 bg-red-100',
  create: 'text-violet-600 bg-violet-100', send: 'text-violet-600 bg-violet-100',
  update: 'text-amber-600 bg-amber-100', coins: 'text-amber-600 bg-amber-100',
  login: 'text-gray-600 bg-gray-100',
};
const TARGET_LABELS: Record<string, string> = {
  host_application: 'KYC App', user: 'User', content_report: 'Report', notification: 'Notification',
  withdrawal: 'Withdrawal', settings: 'Settings', faq: 'FAQ', admin: 'Admin',
  coin_plan: 'Coin Plan', promo_code: 'Promo', banner: 'Banner',
};

export default function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const load = () => {
    setLoading(true);
    api.auditLogs().then(setLogs).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = logs.filter(r => {
    const matchSearch = (r.detail || '').toLowerCase().includes(search.toLowerCase()) || (r.target || '').toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || r.action === filter || r.target_type === filter;
    return matchSearch && matchFilter;
  });

  const exportCSV = () => {
    const csv = ['Admin,Action,Target,Detail,IP,Timestamp', ...logs.map(r =>
      `${r.admin},${r.action},${r.target},"${r.detail}",${r.ip},${r.ts}`
    )].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'audit_logs.csv';
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Audit Logs</h2>
          <p className="text-sm text-muted-foreground">All admin actions tracked in real-time</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none w-44"
              placeholder="Search logs..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="px-3 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none"
            value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Actions</option>
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
            <option value="ban">Ban</option>
            <option value="create">Create</option>
            <option value="delete">Delete</option>
            <option value="update">Settings</option>
            <option value="login">Logins</option>
          </select>
          <button onClick={load} className="p-2 border border-border rounded-xl hover:bg-secondary transition-colors" title="Refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
            <Download size={15} /> Export
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
              <Shield size={20} className="text-muted-foreground" />
            </div>
            <p className="font-semibold text-sm">No audit logs yet</p>
            <p className="text-xs text-muted-foreground mt-1">Admin actions like bans, approvals, and settings changes will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(log => {
              const Icon = ACTION_ICONS[log.action] || Settings;
              const colorClass = ACTION_COLORS[log.action] || 'text-gray-600 bg-gray-100';
              return (
                <div key={log.id} className="flex items-start gap-4 p-4 hover:bg-secondary/30 transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                    <Icon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{log.admin || log.admin_name || 'Admin'}</span>
                      <span className="text-muted-foreground text-xs">→</span>
                      <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${colorClass}`}>{log.action}</span>
                      <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">{TARGET_LABELS[log.target_type] || log.target_type}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 truncate">{log.detail}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-muted-foreground">Target: <strong className="text-foreground">{log.target}</strong></span>
                      {log.ip && <span className="text-[10px] text-muted-foreground">IP: {log.ip}</span>}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0 text-right">
                    {(log.ts || '').split(' ')[0]}<br />{(log.ts || '').split(' ')[1]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
