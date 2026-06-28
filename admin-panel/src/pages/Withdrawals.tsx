import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Wallet, CheckCircle, XCircle, DollarSign, Coins } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import { formatCoins, formatInr, sumBy, formatUnixDate } from '@/lib/format';

export default function Withdrawals() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [loadError, setLoadError] = useState('');
  const load = () => {
    setLoading(true);
    setLoadError('');
    // Bug 17 Fix: Add .catch() so load failures show an error message instead of empty/broken page
    api.withdrawals().then(setItems).catch((e: any) => setLoadError(e.message || 'Failed to load withdrawals')).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const update = async (status: string) => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updateWithdrawal(selected.id, { status, admin_note: note || null });
      toast.success(`Request ${status} successfully`);
      setSelected(null);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const pending = items.filter(i => i.status === 'pending');
  const totalCoins = sumBy(items.filter(i => i.status === 'paid'), 'coins');

  const cols = [
    { key: 'host', header: 'Host',
      render: (w: any) => (
        <div>
          <p className="font-semibold text-sm">{w.display_name || w.name}</p>
          <p className="text-xs text-muted-foreground">{w.email}</p>
        </div>
      )
    },
    { key: 'coins', header: 'Amount',
      render: (w: any) => (
        <div>
          <div className="flex items-center gap-1 font-semibold text-amber-600 text-sm">
            <Coins size={13} />{formatCoins(w.coins)}
          </div>
          <p className="text-xs text-muted-foreground">{formatInr(w.amount)} INR</p>
        </div>
      )
    },
    { key: 'method', header: 'Method', className: 'hidden md:table-cell',
      render: (w: any) => <span className="capitalize text-sm">{w.payment_method || '—'}</span>
    },
    { key: 'date', header: 'Date', className: 'hidden lg:table-cell',
      render: (w: any) => <span className="text-xs text-muted-foreground">{formatUnixDate(w.created_at)}</span>
    },
    { key: 'status', header: 'Status',
      render: (w: any) => <Badge variant={w.status}>{w.status}</Badge>
    },
    { key: 'actions', header: '',
      render: (w: any) => ['pending', 'approved'].includes(w.status) ? (
        <button
          onClick={() => { setSelected(w); setNote(w.admin_note || ''); }}
          className="text-xs font-semibold text-primary hover:underline"
        >
          {w.status === 'approved' ? 'Mark Paid →' : 'Review →'}
        </button>
      ) : null
    },
  ];

  return (
    <div className="space-y-5">

      <div>
        <h2 className="font-bold text-lg">Withdrawal Requests</h2>
        <p className="text-sm text-muted-foreground">Review and process host payout requests</p>
      </div>
      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          Failed to load withdrawals: {loadError} — <button className="underline font-semibold" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Wallet} label="Pending Requests" value={pending.length} gradient="gradient-orange" />
        <StatCard icon={Coins} label="Total Paid (Coins)" value={formatCoins(totalCoins)} gradient="gradient-green" />
        <StatCard icon={DollarSign} label="Total Requests" value={items.length} gradient="gradient-purple" />
      </div>

      <Table columns={cols} data={items} loading={loading} empty="No withdrawal requests yet" keyFn={w => w.id} />

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Review Withdrawal Request">
        {selected && (
          <div className="space-y-4">
            <div className="bg-secondary rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Host</span>
                <span className="font-semibold">{selected.display_name || selected.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <div className="text-right">
                  <p className="font-bold text-amber-600">{formatCoins(selected.coins)} coins</p>
                  <p className="text-xs text-muted-foreground">{formatInr(selected.amount)} INR</p>
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Method</span>
                <span className="capitalize font-medium">{selected.payment_method || '—'}</span>
              </div>
              {selected.account_details && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Account</span>
                  <span className="font-mono text-xs">{selected.account_details}</span>
                </div>
              )}
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
              <button
                onClick={() => update('approved')} disabled={saving}
                className="flex items-center justify-center gap-1.5 bg-green-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                <CheckCircle size={15} /> Approve
              </button>
              <button
                onClick={() => update('paid')} disabled={saving}
                className="flex items-center justify-center gap-1.5 bg-blue-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                <DollarSign size={15} /> Mark Paid
              </button>
              <button
                onClick={() => update('rejected')} disabled={saving}
                className="flex items-center justify-center gap-1.5 bg-destructive text-destructive-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 col-span-2 transition-opacity"
              >
                <XCircle size={15} /> Reject
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
