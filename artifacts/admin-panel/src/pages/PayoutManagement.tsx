import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Search, Download, Coins, CheckCircle, Clock, XCircle, IndianRupee } from 'lucide-react';

const MOCK: any[] = [
  { id: '1', host_name: 'Priya Sharma', host_email: 'priya@ex.com', coins_earned: 8400, inr_amount: 840, period: 'March 2026', status: 'pending', bank: 'SBI ****4521', requested_at: '2026-03-28' },
  { id: '2', host_name: 'Anjali Kumar', host_email: 'anjali@ex.com', coins_earned: 7200, inr_amount: 720, period: 'March 2026', status: 'approved', bank: 'HDFC ****2341', requested_at: '2026-03-27' },
  { id: '3', host_name: 'Meera Rao', host_email: 'meera@ex.com', coins_earned: 6800, inr_amount: 680, period: 'March 2026', status: 'paid', bank: 'ICICI ****8832', requested_at: '2026-03-25' },
  { id: '4', host_name: 'Divya Menon', host_email: 'divya@ex.com', coins_earned: 5600, inr_amount: 560, period: 'Feb 2026', status: 'paid', bank: 'Axis ****1122', requested_at: '2026-02-28' },
  { id: '5', host_name: 'Sneha Tiwari', host_email: 'sneha@ex.com', coins_earned: 4900, inr_amount: 490, period: 'Feb 2026', status: 'rejected', bank: 'SBI ****7731', requested_at: '2026-02-26' },
];

function HostAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500'];
  const c = colors[name.charCodeAt(0) % colors.length];
  return <div className={`w-8 h-8 rounded-full ${c} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>{name[0]}</div>;
}

export default function PayoutManagement() {
  const [rows, setRows] = useState<any[]>(MOCK);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.payouts?.().then(setRows).catch(() => {});
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const filtered = rows.filter(r => {
    const matchSearch = r.host_name.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || r.status === filter;
    return matchSearch && matchFilter;
  });

  const updateStatus = async (id: string, status: string) => {
    setSaving(true);
    try {
      await api.updateWithdrawal(id, { status });
      setRows(rows.map(r => r.id === id ? { ...r, status } : r));
      showToast(`Payout ${status}`);
      setSelected(null);
    } catch { showToast('Updated locally'); setRows(rows.map(r => r.id === id ? { ...r, status } : r)); setSelected(null); }
    finally { setSaving(false); }
  };

  const exportCSV = () => {
    const csv = ['Host,Email,Coins,INR,Period,Status,Bank,Date', ...rows.map(r =>
      `${r.host_name},${r.host_email},${r.coins_earned},${r.inr_amount},${r.period},${r.status},${r.bank},${r.requested_at}`
    )].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'payouts.csv';
    a.click();
  };

  const statusIcon = (s: string) => s === 'paid' ? <CheckCircle size={14} className="text-green-500" /> : s === 'approved' ? <Clock size={14} className="text-blue-500" /> : s === 'pending' ? <Clock size={14} className="text-amber-500" /> : <XCircle size={14} className="text-red-500" />;

  const totalPending = rows.filter(r => r.status === 'pending').reduce((a, r) => a + r.inr_amount, 0);
  const totalPaid = rows.filter(r => r.status === 'paid').reduce((a, r) => a + r.inr_amount, 0);

  const cols = [
    {
      key: 'host', header: 'Host',
      render: (r: any) => (
        <div className="flex items-center gap-3">
          <HostAvatar name={r.host_name} />
          <div>
            <p className="font-semibold text-sm">{r.host_name}</p>
            <p className="text-xs text-muted-foreground">{r.host_email}</p>
          </div>
        </div>
      )
    },
    {
      key: 'amount', header: 'Amount',
      render: (r: any) => (
        <div>
          <div className="flex items-center gap-1 font-bold text-sm text-violet-600"><Coins size={13} />{r.coins_earned.toLocaleString()}</div>
          <div className="flex items-center gap-0.5 text-xs text-muted-foreground"><IndianRupee size={10} />{r.inr_amount}</div>
        </div>
      )
    },
    { key: 'period', header: 'Period', render: (r: any) => <span className="text-sm">{r.period}</span> },
    { key: 'bank', header: 'Bank', className: 'hidden lg:table-cell', render: (r: any) => <span className="text-xs text-muted-foreground">{r.bank}</span> },
    {
      key: 'status', header: 'Status',
      render: (r: any) => (
        <div className="flex items-center gap-1.5">
          {statusIcon(r.status)}
          <Badge variant={r.status}>{r.status}</Badge>
        </div>
      )
    },
    {
      key: 'actions', header: '',
      render: (r: any) => r.status === 'pending' && (
        <button onClick={() => setSelected(r)} className="text-xs font-semibold text-primary hover:underline px-2 py-1">
          Review
        </button>
      )
    },
  ];

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Pending Payouts', value: `₹${totalPending}`, color: 'text-amber-600 bg-amber-50' },
          { label: 'Total Paid', value: `₹${totalPaid}`, color: 'text-green-600 bg-green-50' },
          { label: 'This Month', value: `₹${rows.filter(r => r.period.includes('March')).reduce((a, r) => a + r.inr_amount, 0)}`, color: 'text-violet-600 bg-violet-50' },
          { label: 'Hosts Paid', value: `${rows.filter(r => r.status === 'paid').length}`, color: 'text-blue-600 bg-blue-50' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-xl font-bold mt-1 ${s.color.split(' ')[0]}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Payout Management</h2>
          <p className="text-sm text-muted-foreground">{rows.filter(r => r.status === 'pending').length} pending approvals</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 w-48"
              placeholder="Search host..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="px-3 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none"
            value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      <Table columns={cols} data={filtered} loading={false} empty="No payouts found" keyFn={r => r.id} />

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Review Payout">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
              <HostAvatar name={selected.host_name} />
              <div>
                <p className="font-semibold text-sm">{selected.host_name}</p>
                <p className="text-xs text-muted-foreground">{selected.bank}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-violet-50 rounded-xl"><p className="text-xs text-muted-foreground">Coins Earned</p><p className="font-bold text-violet-600 mt-0.5">{selected.coins_earned.toLocaleString()}</p></div>
              <div className="p-3 bg-green-50 rounded-xl"><p className="text-xs text-muted-foreground">INR Amount</p><p className="font-bold text-green-600 mt-0.5">₹{selected.inr_amount}</p></div>
            </div>
            <p className="text-sm text-muted-foreground">Period: <strong className="text-foreground">{selected.period}</strong></p>
            <div className="flex gap-2 pt-2">
              <button onClick={() => updateStatus(selected.id, 'approved')} disabled={saving}
                className="flex-1 bg-green-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                <CheckCircle size={15} /> Approve
              </button>
              <button onClick={() => updateStatus(selected.id, 'rejected')} disabled={saving}
                className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                <XCircle size={15} /> Reject
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
