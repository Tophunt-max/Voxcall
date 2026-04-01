import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { Coins, TrendingUp, TrendingDown, ArrowRightLeft, Search } from 'lucide-react';

const TYPE_COLORS: Record<string, string> = {
  purchase: 'primary',
  spend: 'warning',
  bonus: 'success',
  refund: 'info',
  withdrawal: 'danger',
};

export default function CoinTransactions() {
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    api.coinTransactions().then(setTxns).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = txns.filter(t => {
    const matchType = typeFilter === 'all' || t.type === typeFilter;
    const matchSearch = !search || (t.user_name || '').toLowerCase().includes(search.toLowerCase()) || (t.description || '').toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const totalIn = txns.filter(t => ['purchase', 'bonus', 'refund'].includes(t.type)).reduce((s, t) => s + (t.amount || 0), 0);
  const totalOut = txns.filter(t => ['spend', 'withdrawal'].includes(t.type)).reduce((s, t) => s + Math.abs(t.amount || 0), 0);

  const cols = [
    { key: 'user', header: 'User',
      render: (t: any) => (
        <div>
          <p className="font-semibold text-sm">{t.user_name || t.user_id}</p>
          <p className="text-xs text-muted-foreground">{t.user_email || ''}</p>
        </div>
      )
    },
    { key: 'type', header: 'Type',
      render: (t: any) => <Badge variant={TYPE_COLORS[t.type] || 'default'}>{t.type}</Badge>
    },
    { key: 'amount', header: 'Coins',
      render: (t: any) => (
        <span className={`font-bold text-sm ${['purchase','bonus','refund'].includes(t.type) ? 'text-green-600' : 'text-red-500'}`}>
          {['purchase','bonus','refund'].includes(t.type) ? '+' : '-'}{Math.abs(t.amount || 0).toLocaleString()}
        </span>
      )
    },
    { key: 'desc', header: 'Description', className: 'hidden md:table-cell',
      render: (t: any) => <span className="text-sm text-muted-foreground">{t.description || '—'}</span>
    },
    { key: 'date', header: 'Date', className: 'hidden lg:table-cell',
      render: (t: any) => <span className="text-xs text-muted-foreground">{t.created_at ? new Date(t.created_at * 1000).toLocaleString() : '—'}</span>
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-bold text-lg">Coin Transactions</h2>
        <p className="text-sm text-muted-foreground">Full transaction history for all users</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard icon={ArrowRightLeft} label="Total Transactions" value={txns.length} gradient="gradient-purple" />
        <StatCard icon={TrendingUp} label="Coins Earned" value={totalIn.toLocaleString()} gradient="gradient-green" />
        <StatCard icon={TrendingDown} label="Coins Spent" value={totalOut.toLocaleString()} gradient="gradient-orange" />
        <StatCard icon={Coins} label="Net Balance" value={(totalIn - totalOut).toLocaleString()} gradient="gradient-blue" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 w-full"
            placeholder="Search by user or description..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-border rounded-xl px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">All Types</option>
          <option value="purchase">Purchase</option>
          <option value="spend">Spend</option>
          <option value="bonus">Bonus</option>
          <option value="refund">Refund</option>
          <option value="withdrawal">Withdrawal</option>
        </select>
      </div>

      <Table columns={cols} data={filtered} loading={loading} empty="No transactions found" keyFn={t => t.id} />
    </div>
  );
}
