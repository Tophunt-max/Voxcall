import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import {
  Search, Download, Coins, CheckCircle, Clock, XCircle,
  DollarSign, RefreshCw, CreditCard, Eye, ArrowRightLeft,
  TrendingUp, Undo2
} from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  success: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'info',
};

function UserAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500', 'bg-cyan-500'];
  const c = colors[(name || '').charCodeAt(0) % colors.length];
  return <div className={`w-8 h-8 rounded-full ${c} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>{(name || '?')[0]}</div>;
}

export default function Deposits() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [toast, setToast] = useState('');

  const load = () => {
    setLoading(true);
    api.deposits().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const methods = Array.from(new Set(rows.map(r => r.payment_method || 'unknown').filter(Boolean)));

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (r.user_name || '').toLowerCase().includes(q) ||
      (r.user_email || '').toLowerCase().includes(q) ||
      (r.payment_ref || '').toLowerCase().includes(q) ||
      (r.utr_id || '').toLowerCase().includes(q) ||
      (r.plan_name || '').toLowerCase().includes(q) ||
      (r.id || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchMethod = methodFilter === 'all' || r.payment_method === methodFilter;
    return matchSearch && matchStatus && matchMethod;
  });

  const totalRevenue = rows.filter(r => r.status === 'success').reduce((s, r) => s + (r.amount || 0), 0);
  const totalCoins = rows.filter(r => r.status === 'success').reduce((s, r) => s + (r.coins || 0) + (r.bonus_coins || 0), 0);
  const pendingCount = rows.filter(r => r.status === 'pending').length;
  const successCount = rows.filter(r => r.status === 'success').length;

  const updateDeposit = async (id: string, status: string) => {
    setSaving(true);
    try {
      await api.updateDeposit(id, { status, admin_note: adminNote || null });
      showToast(`Deposit ${status} successfully`);
      setSelected(null);
      setAdminNote('');
      load();
    } catch (e: any) {
      showToast('Error: ' + (e?.message || 'Update failed'));
    } finally {
      setSaving(false);
    }
  };

  const exportCSV = () => {
    const csv = ['ID,User,Email,Phone,Plan,Coins,Bonus,Amount,Currency,Gateway,Payment Method,Payment Ref,UTR ID,Promo Code,Status,Date',
      ...rows.map(r =>
        `"${r.id}","${r.user_name || ''}","${r.user_email || ''}","${r.user_phone || ''}","${r.plan_name || ''}",${r.coins || 0},${r.bonus_coins || 0},${r.amount || 0},"${r.currency || 'INR'}","${r.gateway_name || ''}","${r.payment_method || ''}","${r.payment_ref || ''}","${r.utr_id || ''}","${r.promo_code || ''}",${r.status},"${r.created_at ? new Date(r.created_at * 1000).toLocaleString() : ''}"`
      )
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'deposits.csv';
    a.click();
  };

  const cols = [
    {
      key: 'user', header: 'User',
      render: (r: any) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={r.user_name || '?'} />
          <div>
            <p className="font-semibold text-sm">{r.user_name || r.user_id || '—'}</p>
            <p className="text-xs text-muted-foreground">{r.user_email || '—'}</p>
            {r.user_phone && <p className="text-xs text-muted-foreground">{r.user_phone}</p>}
          </div>
        </div>
      )
    },
    {
      key: 'plan', header: 'Plan',
      render: (r: any) => (
        <div>
          <p className="font-medium text-sm">{r.plan_name || '—'}</p>
          <p className="text-xs text-muted-foreground">{(r.coins || 0).toLocaleString()} coins{r.bonus_coins ? ` + ${r.bonus_coins} bonus` : ''}</p>
        </div>
      )
    },
    {
      key: 'amount', header: 'Amount',
      render: (r: any) => (
        <span className="font-bold text-sm text-green-600">
          ₹{(r.amount || 0).toFixed(2)} <span className="text-xs font-normal text-muted-foreground">{r.currency || 'INR'}</span>
        </span>
      )
    },
    {
      key: 'gateway', header: 'Payment',
      render: (r: any) => (
        <div>
          <p className="text-sm capitalize font-medium">{r.gateway_name || r.payment_method || '—'}</p>
          {r.payment_ref && <p className="text-xs text-muted-foreground font-mono">Ref: {r.payment_ref}</p>}
          {r.utr_id && <p className="text-xs text-blue-600 font-mono">UTR: {r.utr_id}</p>}
        </div>
      )
    },
    {
      key: 'status', header: 'Status',
      render: (r: any) => <Badge variant={STATUS_COLORS[r.status] || 'default'}>{r.status}</Badge>
    },
    {
      key: 'date', header: 'Date', className: 'hidden lg:table-cell',
      render: (r: any) => (
        <span className="text-xs text-muted-foreground">
          {r.created_at ? new Date(r.created_at * 1000).toLocaleString() : '—'}
        </span>
      )
    },
    {
      key: 'actions', header: '',
      render: (r: any) => (
        <button
          onClick={() => { setSelected(r); setAdminNote(r.admin_note || ''); }}
          className="text-xs font-semibold text-primary hover:underline px-2 py-1 flex items-center gap-1"
        >
          <Eye size={13} /> View
        </button>
      )
    },
  ];

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div>
        <h2 className="font-bold text-lg">Deposits</h2>
        <p className="text-sm text-muted-foreground">Track all coin purchases and deposits from users</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Total Revenue" value={`₹${totalRevenue.toFixed(2)}`} gradient="gradient-green" />
        <StatCard icon={Coins} label="Coins Sold" value={totalCoins.toLocaleString()} gradient="gradient-purple" />
        <StatCard icon={CheckCircle} label="Successful" value={successCount} gradient="gradient-blue" />
        <StatCard icon={Clock} label="Pending" value={pendingCount} gradient="gradient-orange" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 w-full"
            placeholder="Search by user, email, payment ref, UTR ID..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-border rounded-xl px-3 py-2 text-sm bg-card focus:outline-none">
          <option value="all">All Status</option>
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </select>
        <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)}
          className="border border-border rounded-xl px-3 py-2 text-sm bg-card focus:outline-none">
          <option value="all">All Methods</option>
          {methods.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={load}
          className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
          <RefreshCw size={15} /> Refresh
        </button>
        <button onClick={exportCSV}
          className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
          <Download size={15} /> Export
        </button>
      </div>

      <Table columns={cols} data={filtered} loading={loading} empty="No deposits found" keyFn={r => r.id} />

      <Modal open={!!selected} onClose={() => { setSelected(null); setAdminNote(''); }} title="Deposit Details">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
              <UserAvatar name={selected.user_name || '?'} />
              <div className="flex-1">
                <p className="font-semibold text-sm">{selected.user_name || '—'}</p>
                <p className="text-xs text-muted-foreground">{selected.user_email || '—'}</p>
                {selected.user_phone && <p className="text-xs text-muted-foreground">{selected.user_phone}</p>}
              </div>
              <Badge variant={STATUS_COLORS[selected.status] || 'default'}>{selected.status}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-green-50 rounded-xl">
                <p className="text-xs text-muted-foreground">Amount Paid</p>
                <p className="font-bold text-green-600 mt-0.5">₹{(selected.amount || 0).toFixed(2)} {selected.currency || 'INR'}</p>
              </div>
              <div className="p-3 bg-violet-50 rounded-xl">
                <p className="text-xs text-muted-foreground">Coins Received</p>
                <p className="font-bold text-violet-600 mt-0.5">{(selected.coins || 0).toLocaleString()}{selected.bonus_coins ? ` + ${selected.bonus_coins} bonus` : ''}</p>
              </div>
            </div>

            <div className="bg-secondary rounded-xl p-4 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium">{selected.plan_name || '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payment Gateway</span>
                <span className="font-medium capitalize">{selected.gateway_name || selected.payment_method || '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payment Method</span>
                <span className="font-medium capitalize">{selected.payment_method || '—'}</span>
              </div>
              {selected.payment_ref && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Payment Ref / ID</span>
                  <span className="font-mono text-xs bg-card px-2 py-1 rounded">{selected.payment_ref}</span>
                </div>
              )}
              {selected.utr_id && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">UTR ID</span>
                  <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">{selected.utr_id}</span>
                </div>
              )}
              {selected.promo_code && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Promo Code</span>
                  <span className="font-mono text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded">{selected.promo_code}</span>
                </div>
              )}
              {selected.gateway_id && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Gateway ID</span>
                  <span className="font-mono text-xs text-muted-foreground">{selected.gateway_id}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Purchase ID</span>
                <span className="font-mono text-xs text-muted-foreground">{selected.id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">{selected.created_at ? new Date(selected.created_at * 1000).toLocaleString() : '—'}</span>
              </div>
            </div>

            {selected.admin_note && (
              <div className="p-3 bg-amber-50 rounded-xl text-sm">
                <p className="text-xs text-amber-600 font-semibold mb-1">Admin Note</p>
                <p className="text-amber-800">{selected.admin_note}</p>
              </div>
            )}

            <div>
              <label className="text-sm font-semibold block mb-2">Admin Note</label>
              <textarea
                value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={2}
                placeholder="Add a note..."
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>

            {selected.status !== 'refunded' && (
              <div className="flex gap-2">
                {selected.status === 'pending' && (
                  <button onClick={() => updateDeposit(selected.id, 'success')} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-green-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-600 disabled:opacity-50 transition-colors">
                    <CheckCircle size={15} /> Mark Success
                  </button>
                )}
                {selected.status === 'pending' && (
                  <button onClick={() => updateDeposit(selected.id, 'failed')} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-destructive text-destructive-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
                    <XCircle size={15} /> Mark Failed
                  </button>
                )}
                {selected.status === 'success' && (
                  <button onClick={() => updateDeposit(selected.id, 'refunded')} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-amber-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors">
                    <Undo2 size={15} /> Refund Deposit
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
