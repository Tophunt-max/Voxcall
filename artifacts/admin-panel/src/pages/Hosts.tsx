import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CheckCircle, XCircle, Star } from 'lucide-react';

export default function Hosts() {
  const [hosts, setHosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); api.hosts().then(setHosts).finally(() => setLoading(false)); };
  useEffect(load, []);

  const toggle = async (id: string, field: string, cur: boolean) => {
    await api.updateHost(id, { [field]: !cur });
    load();
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">Hosts</h2>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Host</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">Rate</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Rating</th>
              <th className="px-4 py-3 text-muted-foreground font-medium">Active</th>
              <th className="px-4 py-3 text-muted-foreground font-medium">Top</th>
              <th className="px-4 py-3 text-muted-foreground font-medium hidden sm:table-cell">ID Verified</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
            ) : hosts.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No hosts yet</td></tr>
            ) : hosts.map(h => (
              <tr key={h.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium">{h.display_name || h.name}</p>
                  <p className="text-xs text-muted-foreground">{h.email}</p>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">{h.coins_per_minute} coins/min</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Star size={13} className="text-amber-400 fill-amber-400" />
                    <span>{(h.rating || 0).toFixed(1)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggle(h.id, 'is_active', !!h.is_active)}>
                    {h.is_active ? <CheckCircle size={16} className="text-green-500 mx-auto" /> : <XCircle size={16} className="text-muted-foreground mx-auto" />}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggle(h.id, 'is_top_rated', !!h.is_top_rated)}>
                    <Star size={16} className={`mx-auto ${h.is_top_rated ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground'}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-center hidden sm:table-cell">
                  <button onClick={() => toggle(h.id, 'identity_verified', !!h.identity_verified)}>
                    {h.identity_verified ? <CheckCircle size={16} className="text-green-500 mx-auto" /> : <XCircle size={16} className="text-muted-foreground mx-auto" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
