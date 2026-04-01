import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import { Search, Download, Coins, CheckCircle, Clock, XCircle, IndianRupee, Wallet, DollarSign, RefreshCw } from 'lucide-react';

function HostAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500'];
  const c = colors[(name || '').charCodeAt(0) % colors.length];
  return <div className={`w-8 h-8 rounded-full ${c} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>{(name || '?')[0]}</div>;
}

export default function PayoutManagement() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');

  const load = () => {
    setLoading(true);
    api.payouts().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const filtered = rows.filter(r => {
    const matchSearch = (r.host_name || r.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.host_email || '').toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || r.status === filter;
    return matchSearch && matchFilter;
  });

  const updateStatus = async (id: string, status: string) => {
    setSaving(true);
    try {
      await api.updateWithdrawal(id, { status, admin_note: note || null });
      showToast(`Payout ${status} successfully`);
      setSelected(null);
      setNote('');
      load();
    } catch (e: any) {
      showToast('Error: ' + (e?.message || 'Update failed'));
    } finally {
      setSaving(false);
    }
  };

  const exportCSV = () => {
    const csv = ['Host,Email,Coins,Amount,Period,Status,Payment Method,Date', ...rows.map(r =>
      `"${r.host_name || r.name || ''}","${r.host_email || ''}",${r.coins_earned || 0},${r.inr_amount || 0},"${r.period || ''}",${r.status},"${r.bank || ''}","${r.requested_at ? new Date(r.requested_at * 1000).toLocaleDateString() : ''}"`
    )].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'payouts.csv';
    a.click();
  };

  const statusIcon = (s: string) => s === 'paid' ? <CheckCircle size={14} className="text-green-500" /> : s === 'approved' ? <Clock size={14} className="text-blue-500" /> : s === 'pending' ? <Clock size={14} className="text-amber-500" /> : <XCircle size={14} className="text-red-500" />;

  const pending = rows.filter(r => r.status === 'pending');
  const totalPending = pending.reduce((a, r) => a + (r.inr_amount || 0), 0);
  const totalPaid = rows.filter(r => r.status === 'paid').reduce((a, r) => a + (r.inr_amount || 0), 0);
  const totalApproved = rows.filter(r => r.status === 'approved').reduce((a, r) => a + (r.inr_amount || 0), 0);

  const cols = [
    {
      key: 'host', header: 'Host',
      render: (r: any) => (
        <div className="flex items-center gap-3">
          <HostAvatar name={r.host_name || r.name || '?'} />
          <div>
            <p className="font-semibold text-sm">{r.host_name || r.name || '—'}</p>
            <p className="text-xs text-muted-foreground">{r.host_email || '—'}</p>
          </div>
        </div>
      )
    },
    {
      key: 'amount', header: 'Amount',
      render: (r: any) => (
        <div>
          <div className="flex items-center gap-1 font-bold text-sm text-violet-600"><Coins size={13} />{(r.coins_earned || 0).toLocaleString()}</div>
          <div className="flex items-center gap-0.5 text-xs text-muted-foreground"><DollarSign size={10} />{(r.inr_amount || 0).toFixed(2)}</div>
        </div>
      )
    },
    { key: 'period', header: 'Period', render: (r: any) => <span className="text-sm">{r.period || '—'}</span> },
    { key: 'bank', header: 'Payment Method', className: 'hidden lg:table-cell', render: (r: any) => <span className="text-xs text-muted-foreground capitalize">{r.bank || '—'}</span> },
    { key: 'date', header: 'Date', className: 'hidden md:table-cell',
      render: (r: any) => <span className="text-xs text-muted-foreground">{r.requested_at ? new Date(r.requested_at * 1000).toLocaleDateString() : '—'}</span>
    },
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
      render: (r: any) => r.status === 'pending' ? (
        <button onClick={() => { setSelected(r); setNote(r.admin_note || ''); }} className="text-xs font-semibold text-primary hover:underline px-2 py-1">
          Review →
        </button>
      ) : r.status === 'approved' ? (
        <button onClick={() => { setSelected(r); setNote(r.admin_note || ''); }} className="text-xs font-semibold text-blue-500 hover:underline px-2 py-1">
          Mark Paid
        </button>
      ) : null
    },
  ];

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="Pending Payouts" value={`$${totalPending.toFixed(2)}`} gradient="gradient-orange" />
        <StatCard icon={CheckCircle} label="Approved" value={`$${totalApproved.toFixed(2)}`} gradient="gradient-blue" />
        <StatCard icon={Wallet} label="Total Paid" value={`$${totalPaid.toFixed(2)}`} gradient="gradient-green" />
        <StatCard icon={IndianRupee} label="Total Requests" value={rows.length} gradient="gradient-purple" />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Payout Management</h2>
          <p className="text-sm text-muted-foreground">{pending.length} pending approvals</p>
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
          <button onClick={load}
            className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
            <RefreshCw size={15} /> Refresh
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      <Table columns={cols} data={filtered} loading={loading} empty="No payout requests yet" keyFn={r => r.id} />

      <Modal open={!!selected} onClose={() => { setSelected(null); setNote(''); }} title="Review Payout">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
              <HostAvatar name={selected.host_name || selected.name || '?'} />
              <div>
                <p className="font-semibold text-sm">{selected.host_name || selected.name || '—'}</p>
                <p className="text-xs text-muted-foreground">{selected.host_email || '—'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-violet-50 rounded-xl">
                <p className="text-xs text-muted-foreground">Coins Earned</p>
                <p className="font-bold text-violet-600 mt-0.5">{(selected.coins_earned || 0).toLocaleString()}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-xl">
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="font-bold text-green-600 mt-0.5">${(selected.inr_amount || 0).toFixed(2)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Period</p>
                <p className="font-medium">{selected.period || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payment Method</p>
                <p className="font-medium capitalize">{selected.bank || '—'}</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Admin Note (optional)</label>
              <textarea
                value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder="Add a note for the host..."
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {selected.status === 'pending' && (
                <>
                  <button onClick={() => updateStatus(selected.id, 'approved')} disabled={saving}
                    className="flex items-center justify-center gap-1.5 bg-green-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-600 disabled:opacity-50 transition-colors">
                    <CheckCircle size={15} /> Approve
                  </button>
                  <button onClick={() => updateStatus(selected.id, 'rejected')} disabled={saving}
                    className="flex items-center justify-center gap-1.5 bg-destructive text-destructive-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
                    <XCircle size={15} /> Reject
                  </button>
                </>
              )}
              {(selected.status === 'approved' || selected.status === 'pending') && (
                <button onClick={() => updateStatus(selected.id, 'paid')} disabled={saving}
                  className={`flex items-center justify-center gap-1.5 bg-blue-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 transition-colors ${selected.status === 'pending' ? 'col-span-2' : 'col-span-2'}`}>
                  <DollarSign size={15} /> Mark as Paid
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
