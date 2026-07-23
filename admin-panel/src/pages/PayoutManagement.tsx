import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import { formatCoins, formatMoney, formatUnixDate } from '@/lib/format';
import { Search, Download, Coins, CheckCircle, Clock, XCircle, IndianRupee, Wallet, DollarSign, RefreshCw } from 'lucide-react';

function HostAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500'];
  const c = colors[(name || '').charCodeAt(0) % colors.length];
  return <div className={`w-8 h-8 rounded-full ${c} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>{(name || '?')[0]}</div>;
}

// Sum payout amounts grouped by currency so a mix of ₹/$/€ requests never
// collapses into one meaningless number. Renders e.g. "₹4,400  ·  $12.00".
function moneyTotals(list: any[]): string {
  const byCurrency: Record<string, number> = {};
  for (const r of list) {
    const cur = (r.currency || 'INR').toUpperCase();
    byCurrency[cur] = (byCurrency[cur] || 0) + (Number(r.inr_amount) || 0);
  }
  const parts = Object.keys(byCurrency).sort().map((cur) => formatMoney(byCurrency[cur], cur));
  return parts.length ? parts.join('  ·  ') : formatMoney(0, 'INR');
}

export default function PayoutManagement() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const load = () => {
    setLoading(true);
    api.payouts().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  };

  useEffect(load, []);

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
      toast.success(`Payout ${status} successfully`);
      setSelected(null);
      setNote('');
      load();
    } catch (e: any) {
      toast.error((e?.message || 'Update failed'));
    } finally {
      setSaving(false);
    }
  };

  const exportCSV = () => {
    // CSV-safe cell: quote + escape embedded quotes/newlines, and neutralize
    // formula-injection (leading = + - @) so a crafted name can't execute in Excel.
    const esc = (v: any) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const rowsCsv = rows.map(r => [
      r.host_name || r.name || '', r.host_email || '', r.coins_earned || 0,
      r.inr_amount || 0, r.period || '', r.status, r.bank || '',
      r.requested_at ? new Date(r.requested_at * 1000).toLocaleDateString() : '',
    ].map(esc).join(','));
    const csv = ['Host,Email,Coins,Amount,Period,Status,Payment Method,Date', ...rowsCsv].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'payouts.csv';
    a.click();
    URL.revokeObjectURL(url); // FIX: was leaked (never revoked)
  };

  const statusIcon = (s: string) => s === 'paid' ? <CheckCircle size={14} className="text-green-500" /> : s === 'approved' ? <Clock size={14} className="text-blue-500" /> : s === 'pending' ? <Clock size={14} className="text-amber-500" /> : <XCircle size={14} className="text-red-500" />;

  const pending = rows.filter(r => r.status === 'pending');
  const totalPending = moneyTotals(pending);
  const totalPaid = moneyTotals(rows.filter(r => r.status === 'paid'));
  const totalApproved = moneyTotals(rows.filter(r => r.status === 'approved'));

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
          <div className="flex items-center gap-1 font-bold text-sm text-violet-600"><Coins size={13} />{formatCoins(r.coins_earned)}</div>
          <div className="text-xs text-muted-foreground">{formatMoney(r.inr_amount, r.currency)}</div>
        </div>
      )
    },
    { key: 'period', header: 'Period', render: (r: any) => <span className="text-sm">{r.period || '—'}</span> },
    { key: 'bank', header: 'Payment Method', className: 'hidden lg:table-cell', render: (r: any) => <span className="text-xs text-muted-foreground capitalize">{r.bank || '—'}</span> },
    { key: 'date', header: 'Date', className: 'hidden md:table-cell',
      render: (r: any) => <span className="text-xs text-muted-foreground">{formatUnixDate(r.requested_at)}</span>
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="Pending Payouts" value={totalPending} gradient="gradient-orange" />
        <StatCard icon={CheckCircle} label="Approved" value={totalApproved} gradient="gradient-blue" />
        <StatCard icon={Wallet} label="Total Paid" value={totalPaid} gradient="gradient-green" />
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
                <p className="font-bold text-violet-600 mt-0.5">{formatCoins(selected.coins_earned)}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-xl">
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="font-bold text-green-600 mt-0.5">{formatMoney(selected.inr_amount, selected.currency)}</p>
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
