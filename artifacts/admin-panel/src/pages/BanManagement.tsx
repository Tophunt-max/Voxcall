import { useState } from 'react';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, UserX, RotateCcw, Plus, ShieldOff } from 'lucide-react';

const MOCK: any[] = [
  { id: 'B001', user: 'User_Harsh99', email: 'harsh@ex.com', type: 'user', reason: 'Spam messages + multiple reports', banned_by: 'Admin', ban_type: 'permanent', banned_at: '2026-03-28', expires_at: null, device_id: 'android_abc123' },
  { id: 'B002', user: 'Host_Fake22', email: 'fake@ex.com', type: 'host', reason: 'Fraudulent activity - fake profile', banned_by: 'System', ban_type: 'permanent', banned_at: '2026-03-27', expires_at: null, device_id: null },
  { id: 'B003', user: 'User_Rude01', email: 'rude@ex.com', type: 'user', reason: 'Harassment reported by 3 hosts', banned_by: 'Admin', ban_type: 'temporary', banned_at: '2026-03-25', expires_at: '2026-04-25', device_id: 'android_xyz789' },
  { id: 'B004', user: 'User_Spam44', email: 'spam@ex.com', type: 'user', reason: 'Sending unsolicited promotional messages', banned_by: 'Admin', ban_type: 'temporary', banned_at: '2026-03-20', expires_at: '2026-04-05', device_id: 'ios_qwe456' },
];

function UserAvatar({ name }: { name: string }) {
  return <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0"><UserX size={14} className="text-red-500" /></div>;
}

export default function BanManagement() {
  const [rows, setRows] = useState<any[]>(MOCK);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState('');
  const [form, setForm] = useState({ user_id: '', email: '', reason: '', ban_type: 'temporary', expires_at: '', device_id: '' });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const filtered = rows.filter(r =>
    r.user.toLowerCase().includes(search.toLowerCase()) ||
    r.email.toLowerCase().includes(search.toLowerCase()) ||
    r.reason.toLowerCase().includes(search.toLowerCase())
  );

  const unban = (id: string) => {
    setRows(rows.filter(r => r.id !== id));
    showToast('User unbanned successfully');
  };

  const addBan = () => {
    const newBan = { ...form, id: `B${Date.now()}`, user: form.email.split('@')[0], type: 'user', banned_by: 'Admin', banned_at: new Date().toISOString().slice(0, 10) };
    setRows([newBan, ...rows]);
    setCreating(false);
    setForm({ user_id: '', email: '', reason: '', ban_type: 'temporary', expires_at: '', device_id: '' });
    showToast('User banned');
  };

  const cols = [
    {
      key: 'user', header: 'User',
      render: (r: any) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={r.user} />
          <div>
            <p className="font-semibold text-sm">{r.user}</p>
            <p className="text-xs text-muted-foreground">{r.email}</p>
          </div>
        </div>
      )
    },
    {
      key: 'reason', header: 'Reason', className: 'hidden sm:table-cell',
      render: (r: any) => <p className="text-xs text-muted-foreground max-w-[200px] truncate">{r.reason}</p>
    },
    {
      key: 'ban_type', header: 'Type',
      render: (r: any) => <Badge variant={r.ban_type === 'permanent' ? 'banned' : 'pending'}>{r.ban_type}</Badge>
    },
    {
      key: 'expires', header: 'Expires', className: 'hidden lg:table-cell',
      render: (r: any) => <span className="text-xs text-muted-foreground">{r.expires_at || 'Never'}</span>
    },
    {
      key: 'device', header: 'Device ID', className: 'hidden xl:table-cell',
      render: (r: any) => <span className="text-xs font-mono text-muted-foreground">{r.device_id || '—'}</span>
    },
    {
      key: 'actions', header: '',
      render: (r: any) => (
        <button onClick={() => unban(r.id)}
          className="flex items-center gap-1 text-xs font-semibold text-green-600 hover:text-green-700 px-2 py-1 rounded-lg hover:bg-green-50 transition-colors">
          <RotateCcw size={12} /> Unban
        </button>
      )
    },
  ];

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Banned', value: rows.length, color: 'text-red-600' },
          { label: 'Permanent', value: rows.filter(r => r.ban_type === 'permanent').length, color: 'text-red-700' },
          { label: 'Temporary', value: rows.filter(r => r.ban_type === 'temporary').length, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Ban Management</h2>
          <p className="text-sm text-muted-foreground">Manage banned users and devices</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none w-48"
              placeholder="Search banned users..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 bg-red-500 text-white px-3.5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap">
            <Plus size={15} /> Ban User
          </button>
        </div>
      </div>

      <Table columns={cols} data={filtered} loading={false} empty="No banned users" keyFn={r => r.id} />

      <Modal open={creating} onClose={() => setCreating(false)} title="Ban User">
        <div className="space-y-4">
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2">
            <ShieldOff size={15} className="text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-600">This will immediately restrict the user's access.</p>
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">User Email</label>
            <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="user@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Device ID (optional)</label>
            <input className="w-full px-3 py-2.5 border border-border rounded-xl text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="android_xxx or ios_xxx" value={form.device_id} onChange={e => setForm({ ...form, device_id: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Reason</label>
            <textarea rows={2} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              placeholder="Reason for ban..." value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Ban Type</label>
              <select className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                value={form.ban_type} onChange={e => setForm({ ...form, ban_type: e.target.value })}>
                <option value="temporary">Temporary</option>
                <option value="permanent">Permanent</option>
              </select>
            </div>
            {form.ban_type === 'temporary' && (
              <div>
                <label className="text-sm font-semibold block mb-1.5">Expires On</label>
                <input type="date" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                  value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} />
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={addBan} disabled={!form.email || !form.reason}
              className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              <UserX size={15} /> Confirm Ban
            </button>
            <button onClick={() => setCreating(false)} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
