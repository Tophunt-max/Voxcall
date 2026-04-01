import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { StatCard } from '@/components/ui/StatCard';
import { Bell, Send, Users, CheckCircle, Search } from 'lucide-react';

const NOTIF_TYPES = [
  { value: 'system', label: 'System Announcement' },
  { value: 'promo', label: 'Promotion / Offer' },
  { value: 'update', label: 'App Update' },
  { value: 'warning', label: 'Warning' },
];

export default function Notifications() {
  const [notifs, setNotifs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Compose form
  const [form, setForm] = useState({ title: '', body: '', type: 'system', target: 'all', userId: '' });

  useEffect(() => {
    api.notifications().then(setNotifs).catch(console.error).finally(() => setLoading(false));
    api.users().then(setUsers).catch(console.error);
  }, []);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 2500); };

  const send = async () => {
    if (!form.title.trim() || !form.body.trim()) return;
    if (form.target === 'user' && !form.userId) { showToast('Please select a user', false); return; }
    setSending(true);
    try {
      await api.sendNotification(form);
      showToast('Notification sent successfully!');
      setForm({ title: '', body: '', type: 'system', target: 'all', userId: '' });
      api.notifications().then(setNotifs).catch(console.error);
    } catch (e: any) { showToast('Error: ' + e.message, false); }
    finally { setSending(false); }
  };

  const filtered = notifs.filter(n => !search || (n.title || '').toLowerCase().includes(search.toLowerCase()) || (n.user_name || '').toLowerCase().includes(search.toLowerCase()));
  const readCount = notifs.filter(n => n.is_read).length;

  const cols = [
    { key: 'user', header: 'Recipient',
      render: (n: any) => (
        <div>
          <p className="font-semibold text-sm">{n.user_name || n.user_id}</p>
          <p className="text-xs text-muted-foreground">{n.type}</p>
        </div>
      )
    },
    { key: 'title', header: 'Notification',
      render: (n: any) => (
        <div>
          <p className="font-semibold text-sm">{n.title}</p>
          {n.body && <p className="text-xs text-muted-foreground truncate max-w-xs">{n.body}</p>}
        </div>
      )
    },
    { key: 'status', header: 'Read',
      render: (n: any) => n.is_read
        ? <CheckCircle size={15} className="text-green-500" />
        : <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
    },
    { key: 'date', header: 'Sent', className: 'hidden lg:table-cell',
      render: (n: any) => <span className="text-xs text-muted-foreground">{n.created_at ? new Date(n.created_at * 1000).toLocaleString() : '—'}</span>
    },
  ];

  return (
    <div className="space-y-5">
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 text-white text-sm px-4 py-2.5 rounded-xl shadow-xl ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div>
        <h2 className="font-bold text-lg">Notifications</h2>
        <p className="text-sm text-muted-foreground">Send push notifications to users</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Bell} label="Total Sent" value={notifs.length} gradient="gradient-purple" />
        <StatCard icon={CheckCircle} label="Read" value={readCount} gradient="gradient-green" />
        <StatCard icon={Users} label="Unread" value={notifs.length - readCount} gradient="gradient-orange" />
      </div>

      {/* Compose Notification */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg gradient-purple flex items-center justify-center">
            <Send size={15} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Send Notification</h3>
            <p className="text-xs text-muted-foreground">Push notification to users or all</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-semibold block mb-1.5">Title</label>
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Notification title..." maxLength={100}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
              {NOTIF_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-semibold block mb-1.5">Message</label>
            <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={3}
              placeholder="Write your notification message..." maxLength={500}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Recipients</label>
            <select value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="all">All Users</option>
              <option value="hosts">Hosts Only</option>
              <option value="user">Specific User</option>
            </select>
          </div>
          {form.target === 'user' && (
            <div>
              <label className="text-sm font-semibold block mb-1.5">Select User</label>
              <select value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">— Choose user —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={send} disabled={sending || !form.title.trim() || !form.body.trim()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 shadow-sm">
            <Send size={14} />{sending ? 'Sending...' : 'Send Notification'}
          </button>
        </div>
      </div>

      {/* History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Notification History</h3>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-xl bg-card focus:outline-none w-48"
              placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <Table columns={cols} data={filtered} loading={loading} empty="No notifications sent yet" keyFn={n => n.id} />
      </div>
    </div>
  );
}
