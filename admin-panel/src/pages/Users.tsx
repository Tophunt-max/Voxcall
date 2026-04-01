import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, Edit2, Coins, CheckCircle, XCircle } from 'lucide-react';

function Avatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500', 'bg-cyan-500'];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [coins, setCoins] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => {
    setLoading(true);
    api.users('1', search).then(setUsers).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, [search]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateUser(editing.id, { coins: parseInt(coins) });
      showToast('User updated successfully');
      setEditing(null);
      load();
    } catch (e: any) { showToast('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const cols = [
    {
      key: 'name', header: 'User',
      render: (u: any) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name || 'U'} />
          <div className="min-w-0">
            <p className="font-semibold text-sm">{u.name}</p>
            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
          </div>
        </div>
      )
    },
    { key: 'role', header: 'Role', render: (u: any) => <Badge variant={u.role}>{u.role}</Badge> },
    {
      key: 'coins', header: 'Coins',
      render: (u: any) => (
        <div className="flex items-center gap-1 font-semibold text-amber-600">
          <Coins size={13} />
          {u.coins?.toLocaleString()}
        </div>
      )
    },
    {
      key: 'verified', header: 'Verified', className: 'hidden sm:table-cell',
      render: (u: any) => u.is_verified
        ? <CheckCircle size={16} className="text-green-500" />
        : <XCircle size={16} className="text-slate-300" />
    },
    {
      key: 'joined', header: 'Joined', className: 'hidden lg:table-cell',
      render: (u: any) => <span className="text-muted-foreground text-xs">{u.created_at ? new Date(u.created_at * 1000).toLocaleDateString() : '—'}</span>
    },
    {
      key: 'actions', header: '',
      render: (u: any) => (
        <button
          onClick={() => { setEditing(u); setCoins(String(u.coins || 0)); }}
          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
        >
          <Edit2 size={14} />
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Users</h2>
          <p className="text-sm text-muted-foreground">{users.length} total members</p>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 w-full sm:w-64"
            placeholder="Search by name or email..."
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Table columns={cols} data={users} loading={loading} empty="No users found" keyFn={u => u.id} />

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit User">
        {editing && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
              <Avatar name={editing.name || 'U'} />
              <div>
                <p className="font-semibold text-sm">{editing.name}</p>
                <p className="text-xs text-muted-foreground">{editing.email}</p>
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold block mb-2">Coin Balance</label>
              <div className="relative">
                <Coins size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                <input
                  type="number" value={coins} onChange={e => setCoins(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={save} disabled={saving}
                className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditing(null)} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
