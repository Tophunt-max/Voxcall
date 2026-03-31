import { useState } from 'react';
import { Search, Shield, User, Coins, Bell, Settings, Trash2, Edit, CheckCircle, XCircle, Download } from 'lucide-react';

const ACTION_ICONS: Record<string, any> = { approve: CheckCircle, reject: XCircle, ban: Shield, unban: Shield, edit: Edit, delete: Trash2, send: Bell, update: Settings, coins: Coins, login: User };
const ACTION_COLORS: Record<string, string> = { approve: 'text-green-600 bg-green-100', reject: 'text-red-600 bg-red-100', ban: 'text-red-600 bg-red-100', unban: 'text-green-600 bg-green-100', edit: 'text-blue-600 bg-blue-100', delete: 'text-red-600 bg-red-100', send: 'text-violet-600 bg-violet-100', update: 'text-amber-600 bg-amber-100', coins: 'text-amber-600 bg-amber-100', login: 'text-gray-600 bg-gray-100' };

const MOCK = [
  { id: '1', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'approve', target_type: 'host_application', target: 'Priya Sharma', detail: 'KYC application approved', ip: '192.168.1.1', ts: '2026-03-31 14:32:00' },
  { id: '2', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'coins', target_type: 'user', target: 'User Rahul', detail: 'Coins updated: 500 → 600', ip: '192.168.1.1', ts: '2026-03-31 13:15:00' },
  { id: '3', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'ban', target_type: 'user', target: 'User_Harsh99', detail: 'Permanent ban: spam + reports', ip: '192.168.1.1', ts: '2026-03-30 18:22:00' },
  { id: '4', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'send', target_type: 'notification', target: 'All Users (4,821)', detail: 'Bulk notification: New Feature Alert!', ip: '192.168.1.1', ts: '2026-03-30 10:00:00' },
  { id: '5', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'reject', target_type: 'withdrawal', target: 'Sneha Tiwari', detail: 'Withdrawal rejected: invalid bank details', ip: '192.168.1.1', ts: '2026-03-29 16:45:00' },
  { id: '6', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'update', target_type: 'settings', target: 'App Config', detail: 'Min app version updated to 2.1.0', ip: '192.168.1.1', ts: '2026-03-29 11:00:00' },
  { id: '7', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'delete', target_type: 'faq', target: 'FAQ #12', detail: 'Deleted outdated FAQ entry', ip: '192.168.1.1', ts: '2026-03-28 15:30:00' },
  { id: '8', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'approve', target_type: 'withdrawal', target: 'Anjali Kumar', detail: 'Withdrawal of ₹720 approved', ip: '192.168.1.1', ts: '2026-03-28 12:00:00' },
  { id: '9', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'login', target_type: 'admin', target: 'Admin Panel', detail: 'Admin login successful', ip: '192.168.1.1', ts: '2026-03-28 09:00:00' },
  { id: '10', admin: 'Super Admin', admin_email: 'admin@voxlink.app', action: 'edit', target_type: 'coin_plan', target: 'Plan: 500 Coins', detail: 'Price updated ₹99 → ₹79', ip: '192.168.1.1', ts: '2026-03-27 17:20:00' },
];

const TARGET_LABELS: Record<string, string> = { host_application: 'KYC App', user: 'User', notification: 'Notification', withdrawal: 'Withdrawal', settings: 'Settings', faq: 'FAQ', admin: 'Admin', coin_plan: 'Coin Plan' };

export default function AuditLogs() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');

  const filtered = MOCK.filter(r => {
    const matchSearch = r.detail.toLowerCase().includes(search.toLowerCase()) || r.target.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || r.action === filter || r.target_type === filter;
    return matchSearch && matchFilter;
  });

  const exportCSV = () => {
    const csv = ['Admin,Action,Target,Detail,IP,Timestamp', ...MOCK.map(r =>
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
            <option value="send">Notifications</option>
            <option value="update">Settings</option>
            <option value="login">Logins</option>
          </select>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
            <Download size={15} /> Export
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No logs found</div>
          ) : filtered.map(log => {
            const Icon = ACTION_ICONS[log.action] || Settings;
            const colorClass = ACTION_COLORS[log.action] || 'text-gray-600 bg-gray-100';
            return (
              <div key={log.id} className="flex items-start gap-4 p-4 hover:bg-secondary/30 transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{log.admin}</span>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${colorClass}`}>{log.action}</span>
                    <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">{TARGET_LABELS[log.target_type] || log.target_type}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5 truncate">{log.detail}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-muted-foreground">Target: <strong className="text-foreground">{log.target}</strong></span>
                    <span className="text-[10px] text-muted-foreground">IP: {log.ip}</span>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground flex-shrink-0 text-right">
                  {log.ts.split(' ')[0]}<br />{log.ts.split(' ')[1]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
