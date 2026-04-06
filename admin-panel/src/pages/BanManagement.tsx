import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, UserX, RotateCcw, Plus, ShieldOff } from 'lucide-react';

function UserAvatar() {
  return <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0"><UserX size={14} className="text-red-500" /></div>;
}

const blankForm = () => ({ email: '', reason: '', ban_type: 'temporary', expires_at: '', device_id: '' });

export default function BanManagement() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [form, setForm] = useState(blankForm());

  const load = () => {
    setLoading(true);
    setLoadError('');
    api.bannedUsers().then(setRows).catch((e: any) => setLoadError(e.message || 'Failed to load bans')).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const filtered = rows.filter(r =>
    (r.user_name || r.user || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.user_email || r.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.reason || '').toLowerCase().includes(search.toLowerCase())
  );

  const unban = async (id: string) => {
    try {
      await api.unbanUser(id);
      setRows(rows.filter(r => r.id !== id));
      showToast('User unbanned successfully');
    } catch { showToast('Failed to unban user'); }
  };

  const addBan = async () => {
    if (!form.email || !form.reason) return;
    setSaving(true);
    try {
      const res = await api.banUser({
        email: form.email,
        reason: form.reason,
        ban_type: form.ban_type,
        expires_at: form.ban_type === 'temporary' ? form.expires_at : null,
        device_id: form.device_id || null,
      });
      const newBan = {
        id: res.id,
        user_name: form.email.split('@')[0],
        user_email: form.email,
        type: 'user',
        reason: form.reason,
        ban_type: form.ban_type,
        device_id: form.device_id || null,
        banned_by: 'Admin',
        banned_at: Math.floor(Date.now() / 1000),
        expires_at: form.ban_type === 'temporary' ? form.expires_at : null,
      };
      setRows([newBan, ...rows]);
      setCreating(false);
      setForm(blankForm());
      showToast('User banned');
    } catch (e: any) { showToast('Error: ' + (e?.message || 'Failed to ban user')); }
    finally { setSaving(false); }
  };

  const cols = [
    {
      key: 'user', header: 'User',
      render: (r: any) => (
        <div className="flex items-center gap-3">
          <UserAvatar />
          <div>
            <p className="font-semibold text-sm">{r.user_name || r.user || '—'}</p>
            <p className="text-xs text-muted-foreground">{r.user_email || r.email || '—'}</p>
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
      render: (r: any) => {
        if (!r.expires_at) return <span className="text-xs text-muted-foreground">Never</span>;
        try {
          return <span className="text-xs text-muted-foreground">{new Date(r.expires_at).toLocaleDateString()}</span>;
        } catch {
          return <span className="text-xs text-muted-foreground">{r.expires_at}</span>;
        }
      }
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

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          Failed to load bans: {loadError} — <button className="underline font-semibold" onClick={load}>Retry</button>
        </div>
      )}

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

      <Table columns={cols} data={filtered} loading={loading} empty="No banned users" keyFn={r => r.id} />

      <Modal open={creating} onClose={() => { setCreating(false); setForm(blankForm()); }} title="Ban User">
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
            <button onClick={addBan} disabled={!form.email || !form.reason || saving}
              className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              <UserX size={15} /> {saving ? 'Banning...' : 'Confirm Ban'}
            </button>
            <button onClick={() => { setCreating(false); setForm(blankForm()); }} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
