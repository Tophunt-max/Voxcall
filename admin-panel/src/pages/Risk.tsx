import { useState, useEffect, useCallback } from 'react';
import { Link } from 'wouter';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { ShieldAlert, RefreshCw, Search, AlertTriangle, Info } from 'lucide-react';

type Tier = 'low' | 'medium' | 'high';
interface FlaggedRow {
  user_id: string;
  name: string | null;
  email: string | null;
  score: number;
  tier: Tier;
  reasons: string[];
}

// tier → Badge variant (high = red, medium = amber, low = green).
const tierVariant: Record<Tier, string> = { high: 'danger', medium: 'warning', low: 'success' };

export default function Risk() {
  const [rows, setRows] = useState<FlaggedRow[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [assessed, setAssessed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [minTier, setMinTier] = useState<'medium' | 'high'>('medium');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api.riskFlagged(minTier, 150)
      .then((res) => {
        setEnabled(!!res.enabled);
        setAssessed(res.assessed ?? 0);
        setRows(Array.isArray(res.flagged) ? res.flagged : []);
      })
      .catch((e: any) => setLoadError(e?.message || 'Failed to load risk data'))
      .finally(() => setLoading(false));
  }, [minTier]);
  useEffect(load, [load]);

  const filtered = rows.filter((r) =>
    (r.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.user_id || '').toLowerCase().includes(search.toLowerCase())
  );

  const highCount = rows.filter((r) => r.tier === 'high').length;
  const medCount = rows.filter((r) => r.tier === 'medium').length;

  const cols = [
    {
      key: 'user', header: 'User',
      render: (r: FlaggedRow) => (
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${r.tier === 'high' ? 'bg-red-100' : 'bg-amber-100'}`}>
            <ShieldAlert size={14} className={r.tier === 'high' ? 'text-red-500' : 'text-amber-500'} />
          </div>
          <div>
            <p className="font-semibold text-sm">{r.name || '—'}</p>
            <p className="text-xs text-muted-foreground">{r.email || r.user_id}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'score', header: 'Risk Score',
      render: (r: FlaggedRow) => (
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full ${r.tier === 'high' ? 'bg-red-500' : r.tier === 'medium' ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }}
            />
          </div>
          <span className="text-sm font-bold tabular-nums w-8 text-right">{r.score}</span>
        </div>
      ),
    },
    {
      key: 'tier', header: 'Tier',
      render: (r: FlaggedRow) => <Badge variant={tierVariant[r.tier]}>{r.tier}</Badge>,
    },
    {
      key: 'reasons', header: 'Top signals', className: 'hidden md:table-cell',
      render: (r: FlaggedRow) => (
        <div className="flex flex-wrap gap-1 max-w-[320px]">
          {r.reasons.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            r.reasons.map((reason, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                {reason}
              </span>
            ))
          )}
        </div>
      ),
    },
  ];

  // Engine disabled → explain how to turn it on rather than showing an empty table.
  if (!loading && !enabled) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-bold text-lg">Fraud / Risk</h2>
          <p className="text-sm text-muted-foreground">Behavioural risk scoring for abuse & fraud detection</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
            <Info size={22} className="text-amber-500" />
          </div>
          <p className="font-semibold">Risk scoring is turned off</p>
          <p className="text-sm text-muted-foreground max-w-md">
            Enable <span className="font-semibold">Fraud / Abuse Risk Scoring</span> in App Config to start
            scoring users on recharge, refund and call-decline patterns. Nothing is scored or throttled while it's off.
          </p>
          <Link href="/app-config">
            <span className="mt-1 inline-flex items-center gap-1.5 bg-violet-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 cursor-pointer">
              Go to App Config
            </span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {loadError} — <button className="underline font-semibold" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'High risk', value: highCount, color: 'text-red-600' },
          { label: 'Medium risk', value: medCount, color: 'text-amber-600' },
          { label: 'Users assessed', value: assessed, color: 'text-slate-600' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/50 border border-border rounded-xl px-3 py-2">
        <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
        <span>
          Scores are a transparent blend of recharge velocity, refund ratio, chargebacks, new-account burst, ban
          history and call-decline rate. They are advisory — no user is auto-banned.
        </span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Fraud / Risk</h2>
          <p className="text-sm text-muted-foreground">Flagged users, highest score first</p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Tier filter */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['medium', 'high'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMinTier(t)}
                className={`px-3 py-2 text-sm font-semibold capitalize transition-colors ${
                  minTier === t ? 'bg-violet-500 text-white' : 'bg-card text-muted-foreground hover:bg-secondary'
                }`}
              >
                {t}+
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none w-48"
              placeholder="Search flagged users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 bg-secondary text-foreground px-3.5 py-2 rounded-xl text-sm font-semibold hover:bg-secondary/70 transition-colors whitespace-nowrap"
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      <Table columns={cols} data={filtered} loading={loading} empty="No flagged users in this tier" keyFn={(r: FlaggedRow) => r.user_id} />
    </div>
  );
}
