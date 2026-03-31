import { useState } from 'react';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, MessageSquare, Clock, CheckCircle, AlertCircle, Send, ChevronDown } from 'lucide-react';

const MOCK: any[] = [
  { id: 'T001', user: 'Rahul Verma', email: 'rahul@ex.com', subject: 'Coins not credited after payment', category: 'billing', priority: 'high', status: 'open', created_at: '2026-03-30', messages: [{ from: 'user', text: 'I purchased 500 coins but they were not added to my account.', time: '10:30 AM' }, { from: 'admin', text: 'We are investigating this. Could you share your transaction ID?', time: '11:00 AM' }] },
  { id: 'T002', user: 'Sunita Rao', email: 'sunita@ex.com', subject: 'Host was rude during call', category: 'conduct', priority: 'medium', status: 'in_progress', created_at: '2026-03-29', messages: [{ from: 'user', text: 'The host was very rude and disconnected without reason.', time: '3:15 PM' }] },
  { id: 'T003', user: 'Arun Patel', email: 'arun@ex.com', subject: 'Cannot login to account', category: 'technical', priority: 'high', status: 'open', created_at: '2026-03-29', messages: [{ from: 'user', text: 'App shows error when I try to login.', time: '9:45 AM' }] },
  { id: 'T004', user: 'Kavya Nair', email: 'kavya@ex.com', subject: 'Refund request for failed call', category: 'billing', priority: 'medium', status: 'resolved', created_at: '2026-03-28', messages: [{ from: 'user', text: 'Call disconnected within 2 mins, coins were deducted.', time: '2:00 PM' }, { from: 'admin', text: 'Refund of 50 coins has been processed.', time: '4:30 PM' }] },
  { id: 'T005', user: 'Raj Singh', email: 'raj@ex.com', subject: 'App crashing on Android 14', category: 'technical', priority: 'low', status: 'resolved', created_at: '2026-03-27', messages: [{ from: 'user', text: 'App crashes when I open voice call screen.', time: '11:00 AM' }, { from: 'admin', text: 'Fixed in v2.1.3. Please update your app.', time: '5:00 PM' }] },
];

const priorityColor: Record<string, string> = { high: 'text-red-600 bg-red-50', medium: 'text-amber-600 bg-amber-50', low: 'text-green-600 bg-green-50' };
const statusIcon: Record<string, any> = { open: AlertCircle, in_progress: Clock, resolved: CheckCircle };

function UserAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500'];
  const c = colors[name.charCodeAt(0) % colors.length];
  return <div className={`w-8 h-8 rounded-full ${c} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>{name[0]}</div>;
}

export default function SupportTickets() {
  const [rows, setRows] = useState<any[]>(MOCK);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const filtered = rows.filter(r => {
    const matchSearch = r.user.toLowerCase().includes(search.toLowerCase()) || r.subject.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || r.status === filter;
    return matchSearch && matchFilter;
  });

  const sendReply = async () => {
    if (!reply.trim() || !selected) return;
    setSending(true);
    const newMsg = { from: 'admin', text: reply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    const updatedTicket = { ...selected, messages: [...selected.messages, newMsg], status: 'in_progress' };
    setRows(rows.map(r => r.id === selected.id ? updatedTicket : r));
    setSelected(updatedTicket);
    setReply('');
    setSending(false);
    showToast('Reply sent');
  };

  const updateStatus = (id: string, status: string) => {
    setRows(rows.map(r => r.id === id ? { ...r, status } : r));
    if (selected?.id === id) setSelected({ ...selected, status });
    showToast('Status updated');
  };

  const cols = [
    {
      key: 'ticket', header: 'Ticket',
      render: (r: any) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={r.user} />
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{r.subject}</p>
            <p className="text-xs text-muted-foreground">{r.user} · #{r.id}</p>
          </div>
        </div>
      )
    },
    {
      key: 'category', header: 'Category', className: 'hidden sm:table-cell',
      render: (r: any) => <span className="text-xs capitalize bg-secondary px-2 py-0.5 rounded-lg">{r.category}</span>
    },
    {
      key: 'priority', header: 'Priority',
      render: (r: any) => <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg capitalize ${priorityColor[r.priority]}`}>{r.priority}</span>
    },
    {
      key: 'status', header: 'Status',
      render: (r: any) => {
        const Icon = statusIcon[r.status] || Clock;
        return (
          <div className="flex items-center gap-1.5">
            <Icon size={14} className={r.status === 'resolved' ? 'text-green-500' : r.status === 'in_progress' ? 'text-blue-500' : 'text-amber-500'} />
            <Badge variant={r.status}>{r.status.replace('_', ' ')}</Badge>
          </div>
        );
      }
    },
    { key: 'date', header: 'Date', className: 'hidden lg:table-cell', render: (r: any) => <span className="text-xs text-muted-foreground">{r.created_at}</span> },
    {
      key: 'actions', header: '',
      render: (r: any) => (
        <button onClick={() => setSelected(r)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline px-2 py-1">
          <MessageSquare size={13} /> View
        </button>
      )
    },
  ];

  const openCount = rows.filter(r => r.status === 'open').length;
  const inProgressCount = rows.filter(r => r.status === 'in_progress').length;

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Open', value: openCount, color: 'text-red-600 bg-red-50 border-red-100' },
          { label: 'In Progress', value: inProgressCount, color: 'text-blue-600 bg-blue-50 border-blue-100' },
          { label: 'Resolved', value: rows.filter(r => r.status === 'resolved').length, color: 'text-green-600 bg-green-50 border-green-100' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 border ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Support Tickets</h2>
          <p className="text-sm text-muted-foreground">{openCount} need attention</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none w-48"
              placeholder="Search tickets..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="px-3 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none"
            value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      <Table columns={cols} data={filtered} loading={false} empty="No tickets found" keyFn={r => r.id} />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Ticket #${selected?.id}`}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-secondary rounded-xl">
              <UserAvatar name={selected.user} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{selected.subject}</p>
                <p className="text-xs text-muted-foreground">{selected.user} · {selected.created_at}</p>
              </div>
              <select className="text-xs border border-border rounded-lg px-2 py-1 bg-background"
                value={selected.status} onChange={e => updateStatus(selected.id, e.target.value)}>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="space-y-3 max-h-56 overflow-y-auto">
              {selected.messages.map((m: any, i: number) => (
                <div key={i} className={`flex ${m.from === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.from === 'admin' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>
                    <p>{m.text}</p>
                    <p className={`text-[10px] mt-1 ${m.from === 'admin' ? 'text-white/60' : 'text-muted-foreground'}`}>{m.time}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="flex-1 px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Type your reply..." value={reply} onChange={e => setReply(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendReply()} />
              <button onClick={sendReply} disabled={!reply.trim() || sending}
                className="bg-primary text-primary-foreground px-4 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity">
                <Send size={16} />
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
