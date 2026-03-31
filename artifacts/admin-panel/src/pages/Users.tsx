import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Search, CheckCircle, XCircle } from 'lucide-react';

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [coins, setCoins] = useState('');

  const load = () => {
    setLoading(true);
    api.users('1', search).then(setUsers).finally(() => setLoading(false));
  };
  useEffect(load, [search]);

  const save = async () => {
    if (!editing) return;
    await api.updateUser(editing.id, { coins: parseInt(coins) });
    setEditing(null);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Users</h2>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 w-56"
            placeholder="Search name or email..."
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-4">Edit User: {editing.name}</h3>
            <label className="text-sm font-medium block mb-1.5">Coins Balance</label>
            <input
              type="number" value={coins} onChange={e => setCoins(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex gap-2">
              <button onClick={save} className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-semibold">Save</button>
              <button onClick={() => setEditing(null)} className="flex-1 border border-border rounded-lg py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Name</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">Email</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Role</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Coins</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium hidden sm:table-cell">Verified</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No users found</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-accent/20 text-accent' : u.role === 'host' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">{u.coins?.toLocaleString()}</td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  {u.is_verified ? <CheckCircle size={16} className="text-green-500" /> : <XCircle size={16} className="text-muted-foreground" />}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => { setEditing(u); setCoins(String(u.coins || 0)); }}
                    className="text-xs text-primary hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
