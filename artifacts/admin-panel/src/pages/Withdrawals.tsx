import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const statusColor: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  paid: 'bg-blue-100 text-blue-800',
};

export default function Withdrawals() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [note, setNote] = useState('');

  const load = () => { setLoading(true); api.withdrawals().then(setItems).finally(() => setLoading(false)); };
  useEffect(load, []);

  const update = async (status: string) => {
    if (!selected) return;
    await api.updateWithdrawal(selected.id, { status, admin_note: note });
    setSelected(null);
    load();
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">Withdrawal Requests</h2>

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-1">Review Request</h3>
            <p className="text-sm text-muted-foreground mb-4">{selected.display_name} — {selected.coins_requested} coins (${((selected.coins_requested || 0) * 0.01 * 0.7).toFixed(2)})</p>
            <label className="text-sm font-medium block mb-1.5">Admin Note (optional)</label>
            <textarea
              value={note} onChange={e => setNote(e.target.value)} rows={3}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => update('approved')} className="flex-1 bg-green-500 text-white rounded-lg py-2 text-sm font-semibold">Approve</button>
              <button onClick={() => update('paid')} className="flex-1 bg-blue-500 text-white rounded-lg py-2 text-sm font-semibold">Mark Paid</button>
              <button onClick={() => update('rejected')} className="flex-1 bg-destructive text-destructive-foreground rounded-lg py-2 text-sm font-semibold">Reject</button>
              <button onClick={() => setSelected(null)} className="w-full border border-border rounded-lg py-2 text-sm mt-1">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Host</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Coins</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">Method</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No withdrawal requests</td></tr>
            ) : items.map(w => (
              <tr key={w.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium">{w.display_name || w.name}</p>
                  <p className="text-xs text-muted-foreground">{w.email}</p>
                </td>
                <td className="px-4 py-3">{w.coins_requested?.toLocaleString()} <span className="text-muted-foreground text-xs">(${((w.coins_requested || 0) * 0.007).toFixed(2)})</span></td>
                <td className="px-4 py-3 hidden md:table-cell capitalize">{w.method}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[w.status] || ''}`}>{w.status}</span>
                </td>
                <td className="px-4 py-3">
                  {w.status === 'pending' && (
                    <button onClick={() => { setSelected(w); setNote(w.admin_note || ''); }}
                      className="text-xs text-primary hover:underline">Review</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
