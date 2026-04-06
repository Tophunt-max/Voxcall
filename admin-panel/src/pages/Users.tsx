import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import {
  Search, Coins, CheckCircle, XCircle, ChevronLeft, ChevronRight,
  X, Phone, Mail, Calendar, Shield, User as UserIcon, Edit3
} from 'lucide-react';

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500', 'bg-cyan-500'];
  const color = colors[(name || 'U').charCodeAt(0) % colors.length];
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'sm' ? 'w-7 h-7 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-full ${color} flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {(name || 'U')[0].toUpperCase()}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <span className="text-muted-foreground mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium mt-0.5 break-all">{value}</div>
      </div>
    </div>
  );
}

function UserDetailSheet({
  user,
  onClose,
  onSaved,
}: {
  user: any;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [tab, setTab] = useState<'details' | 'edit'>('details');
  const [coins, setCoins] = useState(String(user.coins || 0));
  const [role, setRole] = useState(user.role || 'user');
  const [status, setStatus] = useState(user.status || 'active');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const qc = useQueryClient();

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await api.updateUser(user.id, {
        coins: parseInt(coins),
        role,
        status,
      });
      qc.invalidateQueries({ queryKey: ['users'] });
      onSaved('User updated successfully');
      onClose();
    } catch (e: any) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <Avatar name={user.name || 'U'} size="md" />
            <div>
              <p className="font-bold text-base leading-tight">{user.name || '—'}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-secondary text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-border">
          {(['details', 'edit'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${tab === t ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
            >
              {t === 'details' ? 'Details' : 'Edit'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {tab === 'details' ? (
            <div>
              <InfoRow icon={<Mail size={14} />} label="Email" value={user.email || '—'} />
              <InfoRow icon={<Phone size={14} />} label="Phone" value={user.phone || '—'} />
              <InfoRow icon={<Shield size={14} />} label="Role" value={<Badge variant={user.role}>{user.role}</Badge>} />
              <InfoRow
                icon={<UserIcon size={14} />}
                label="Status"
                value={
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    user.status === 'active' ? 'bg-green-100 text-green-700' :
                    user.status === 'banned' ? 'bg-red-100 text-red-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {user.status || 'active'}
                  </span>
                }
              />
              <InfoRow
                icon={<Coins size={14} />}
                label="Coin Balance"
                value={<span className="text-amber-600 font-bold">{(user.coins || 0).toLocaleString()} coins</span>}
              />
              <InfoRow
                icon={<CheckCircle size={14} />}
                label="Verified"
                value={user.is_verified
                  ? <span className="text-green-600 flex items-center gap-1"><CheckCircle size={14} /> Verified</span>
                  : <span className="text-muted-foreground flex items-center gap-1"><XCircle size={14} /> Not verified</span>
                }
              />
              <InfoRow
                icon={<Calendar size={14} />}
                label="Joined"
                value={user.created_at ? new Date(user.created_at * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              />
              {user.gender && <InfoRow icon={<UserIcon size={14} />} label="Gender" value={user.gender} />}
              {user.referral_code && <InfoRow icon={<Shield size={14} />} label="Referral Code" value={<code className="font-mono text-violet-600">{user.referral_code}</code>} />}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-1.5">Coin Balance</label>
                <div className="relative">
                  <Coins size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                  <input
                    type="number" value={coins} onChange={e => setCoins(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold block mb-1.5">Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {['user', 'host', 'admin'].map(r => (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className={`py-2 rounded-xl border-2 text-sm font-semibold transition-all ${role === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold block mb-1.5">Account Status</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { val: 'active', label: '✅ Active', cls: 'border-green-400 bg-green-50 text-green-700' },
                    { val: 'banned', label: '🚫 Banned', cls: 'border-red-400 bg-red-50 text-red-700' },
                  ].map(s => (
                    <button
                      key={s.val}
                      onClick={() => setStatus(s.val)}
                      className={`py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${status === s.val ? s.cls : 'border-border text-muted-foreground hover:border-primary/40'}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {err && <p className="text-red-500 text-sm">{err}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
                >
                  <Edit3 size={14} />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-secondary transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Users() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any>(null);
  const [toast, setToast] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ['users', page, debouncedSearch],
    queryFn: () => api.users(String(page), debouncedSearch) as Promise<any[]>,
    placeholderData: prev => prev,
    staleTime: 30_000,
  });

  const hasMore = users.length === 20;

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 400);
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      {selected && (
        <UserDetailSheet user={selected} onClose={() => setSelected(null)} onSaved={showToast} />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Users</h2>
          <p className="text-sm text-muted-foreground">{users.length} members on this page</p>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 w-full sm:w-64"
            placeholder="Search by name or email..."
            value={search} onChange={e => handleSearchChange(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No users found</div>
      ) : (
        <div className="space-y-2">
          {users.map((u: any) => (
            <button
              key={u.id}
              onClick={() => setSelected(u)}
              className="w-full text-left bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-secondary/50 active:bg-secondary transition-colors"
            >
              <Avatar name={u.name || 'U'} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">{u.name}</p>
                  <Badge variant={u.role}>{u.role}</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{u.email}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-xs font-semibold text-amber-600 flex items-center gap-0.5">
                  <Coins size={11} />{(u.coins || 0).toLocaleString()}
                </span>
                {u.is_verified
                  ? <CheckCircle size={12} className="text-green-500" />
                  : <XCircle size={12} className="text-slate-300" />
                }
              </div>
            </button>
          ))}
        </div>
      )}

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={page <= 1 || isLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-secondary disabled:opacity-40 transition-colors"
          >
            <ChevronLeft size={15} /> Prev
          </button>
          <span className="text-sm text-muted-foreground font-medium">Page {page}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!hasMore || isLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-secondary disabled:opacity-40 transition-colors"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
