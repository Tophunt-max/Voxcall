import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Bar, PieChart, Pie, Cell, Legend, ComposedChart,
} from 'recharts';
import {
  Activity, AlertTriangle, ArrowUpRight, ArrowDownRight, Ban, CircleDollarSign,
  Coins, FileWarning, Lock, MessageSquare, Pause, PhoneCall, PhoneOff, Power,
  RefreshCw, Server, ShieldAlert, ShieldCheck, TrendingDown, TrendingUp,
  UserCheck, Users, Wallet, Wifi, Zap,
} from 'lucide-react';

// ============================================================================
// Admin Dashboard — production grade.
// ============================================================================
// Six rows of live data:
//   A. SLA banner            30 s refresh, health/FX/coins/migrations/budget
//   B. Financial KPI cards   60 s refresh, revenue + margin + Agora + payouts
//   C. Pending-work pills    20 s refresh, click-through to their pages
//   D. Live ops + activity   5 s / 30 s, running calls + recent signups
//   E. Charts                120 s refresh + 7/30/90d switcher
//   F. Fraud + monitoring    30 s security counters
// Plus:
//   • Emergency kill-switches (freeze payouts / pause registrations /
//     pause new calls) with confirm() prompts + audit trail
//   • Anomaly banners (calls today > 30 % below 30-day average, etc.)
//   • Auto-refresh toggle — admin can pause polling for a stable snapshot
//   • Leaderboards (top hosts by revenue + top users by spend, last 7 d)
//   • Admin action log (last 10 admin actions from audit_logs)
// ============================================================================

const CHART_COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];
const HEALTH_LABEL: Record<'ok' | 'warn' | 'bad', string> = {
  ok: '🟢 Healthy',
  warn: '🟡 Warn',
  bad: '🔴 Degraded',
};
const HEALTH_CLASS: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/30 dark:border-green-900/50',
  warn: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-900/50',
  bad: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-900/50',
};

// ─── Formatting helpers ────────────────────────────────────────────────────
const inr = (n: number, decimals = 0) =>
  '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const pct = (n: number, decimals = 0) => `${(n || 0).toFixed(decimals)}%`;
const compact = (n: number) => (n || 0).toLocaleString('en-IN');
const timeAgo = (unixSec: number, nowSec: number) => {
  const s = Math.max(0, nowSec - unixSec);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ─── Custom chart tooltip ──────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-lg text-sm">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="text-xs">
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toLocaleString('en-IN') : p.value}</strong>
        </p>
      ))}
    </div>
  );
};

// ============================================================================
export default function Dashboard() {
  const qc = useQueryClient();

  // ── Auto-refresh toggle ─────────────────────────────────────────────
  // Admin can pause all polling for a stable snapshot (useful when demoing
  // or investigating a specific incident). Persisted to localStorage so
  // the pause survives a page reload.
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dashboard_auto_refresh') !== '0';
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('dashboard_auto_refresh', autoRefresh ? '1' : '0'); } catch {}
  }, [autoRefresh]);

  // ── Chart time-range switcher ───────────────────────────────────────
  const [chartRange, setChartRange] = useState<7 | 30 | 90>(7);

  // ── Data queries ────────────────────────────────────────────────────
  // Tiered polling intervals — each row gets the freshness it needs
  // without every card firing at the same cadence.
  const summary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => api.dashboardSummary(),
    refetchInterval: autoRefresh ? 20_000 : false,
    staleTime: 15_000,
  });
  const health = useQuery({
    queryKey: ['monitoring-health'],
    queryFn: () => api.monitoringHealth(),
    refetchInterval: autoRefresh ? 30_000 : false,
    staleTime: 25_000,
  });
  const flags = useQuery({
    queryKey: ['emergency-flags'],
    queryFn: () => api.emergencyFlags(),
    refetchInterval: autoRefresh ? 60_000 : false,
    staleTime: 30_000,
  });
  const analytics = useQuery({
    queryKey: ['analytics', chartRange],
    queryFn: () => api.analytics(chartRange),
    refetchInterval: autoRefresh ? 120_000 : false,
    staleTime: 60_000,
  });

  const now = Math.floor(Date.now() / 1000);
  const sum: any = summary.data ?? {};
  const hlt: any = health.data ?? {};
  const flg = flags.data ?? { payouts_frozen: false, registrations_paused: false, new_calls_paused: false };
  const ana: any = analytics.data ?? {};
  const loading = summary.isLoading || health.isLoading;

  // ── Emergency flag mutation ─────────────────────────────────────────
  const toggleFlag = useMutation({
    mutationFn: (v: { flag: 'payouts_frozen' | 'registrations_paused' | 'new_calls_paused'; on: boolean }) =>
      api.setEmergencyFlag(v.flag, v.on),
    onSuccess: (_, v) => {
      toast.success(`${v.flag.replace(/_/g, ' ')} ${v.on ? 'ENABLED' : 'disabled'}`);
      qc.invalidateQueries({ queryKey: ['emergency-flags'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to update flag'),
  });
  const setFlag = (flag: 'payouts_frozen' | 'registrations_paused' | 'new_calls_paused', on: boolean) => {
    const msg = on
      ? `Enable "${flag.replace(/_/g, ' ')}"? This will BLOCK the corresponding user action platform-wide.`
      : `Disable "${flag.replace(/_/g, ' ')}"? Platform action will resume.`;
    if (confirm(msg)) toggleFlag.mutate({ flag, on });
  };

  // ── Overall system health pill (Row A right side) ───────────────────
  // Worst-tone-wins across every monitored subsystem. We depend on the
  // individual sub-tones (not the whole hlt object) so this memo only
  // recomputes when a tone actually changes — avoids the render-loop
  // warning about hlt being reconstructed each render.
  const apiTone = hlt.api?.tone as 'ok' | 'warn' | 'bad' | undefined;
  const fxTone = hlt.fx?.tone as 'ok' | 'warn' | 'bad' | undefined;
  const coinsTone = hlt.coins?.tone as 'ok' | 'warn' | 'bad' | undefined;
  const migTone = hlt.migrations?.tone as 'ok' | 'warn' | 'bad' | undefined;
  const budgetTone = hlt.reward_budget?.tone as 'ok' | 'warn' | 'bad' | undefined;
  const overallTone: 'ok' | 'warn' | 'bad' = useMemo(() => {
    const tones = [apiTone, fxTone, coinsTone, migTone, budgetTone].filter(Boolean) as Array<'ok' | 'warn' | 'bad'>;
    if (tones.includes('bad')) return 'bad';
    if (tones.includes('warn')) return 'warn';
    return 'ok';
  }, [apiTone, fxTone, coinsTone, migTone, budgetTone]);

  // ── Loading skeleton ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-24 rounded-2xl bg-muted animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ─────────────────────────── HEADER ─────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-bold text-xl">Dashboard</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            Live platform overview
            {autoRefresh ? (
              <span className="inline-flex items-center gap-1 text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Auto-refreshing
              </span>
            ) : (
              <span className="text-amber-600">⏸ Paused</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className="flex items-center gap-1.5 border border-border rounded-xl px-3 py-2 text-xs font-medium hover:bg-secondary"
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
          >
            {autoRefresh ? <Pause size={13} /> : <RefreshCw size={13} />}
            {autoRefresh ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={() => {
              summary.refetch(); health.refetch(); flags.refetch(); analytics.refetch();
              toast.success('Refreshed');
            }}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-xl px-3 py-2 text-xs font-semibold hover:opacity-90"
          >
            <RefreshCw size={13} /> Refresh now
          </button>
        </div>
      </div>

      {/* ── ANOMALY BANNERS (only when there's a real signal) ─────── */}
      {(sum.anomalies?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {sum.anomalies.map((a: { tone: 'warn' | 'bad'; msg: string }, i: number) => {
            const tone = a.tone === 'bad'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400';
            return (
              <div key={i} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}>
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <p>{a.msg}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* ─────────────────────── ROW A: SLA BANNER ──────────────── */}
      <SLABanner health={hlt} overallTone={overallTone} />

      {/* ────────────────── ROW: EMERGENCY SWITCHES ─────────────── */}
      <EmergencySwitches flags={flg} onToggle={setFlag} busy={toggleFlag.isPending} />

      {/* ─────────────────────── ROW B: FINANCIAL ───────────────── */}
      <FinancialKPIs financial={sum.financial ?? {}} />

      {/* ─────────────────────── ROW C: PENDING ─────────────────── */}
      <PendingCounters pending={sum.pending ?? {}} />

      {/* ─────────────────────── ROW D: LIVE OPS ────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <LiveCallsCard live={sum.live ?? {}} />
        <RecentActivityCard recent={sum.recent ?? {}} now={now} />
      </div>

      {/* ─────────────────────── ROW E: CHARTS ──────────────────── */}
      <ChartsRow
        analytics={ana}
        callSplit={sum.call_type_split_7d ?? []}
        chartRange={chartRange}
        onRangeChange={setChartRange}
      />

      {/* ────────────────── ROW: LEADERBOARDS ───────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Leaderboard
          title="Top Hosts (last 7 days)"
          subtitle="By coins earned"
          rows={sum.leaderboards?.top_hosts_7d ?? []}
          idKey="host_id"
          renderRight={(r: any) => (
            <span className="text-sm font-semibold text-green-600">{inr(r.revenue_inr, 2)}</span>
          )}
        />
        <Leaderboard
          title="Top Users (last 7 days)"
          subtitle="By coins spent"
          rows={sum.leaderboards?.top_users_7d ?? []}
          idKey="user_id"
          renderRight={(r: any) => (
            <span className="text-sm font-semibold text-blue-600">{inr(r.spent_inr, 2)}</span>
          )}
        />
      </div>

      {/* ─────────────────── ROW F: FRAUD + MONITORING ──────────── */}
      <FraudMonitoringStrip health={hlt} />

      {/* ─────────────────── ADMIN ACTION LOG ───────────────────── */}
      <AdminActionLog actions={sum.admin_actions_recent ?? []} now={now} />

      {/* Server errors banner */}
      {(summary.error || health.error) && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <strong>API Error:</strong> {(summary.error as Error | undefined)?.message || (health.error as Error | undefined)?.message}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ROW A — SLA BANNER
// ══════════════════════════════════════════════════════════════════════════
function SLABanner({ health, overallTone }: { health: any; overallTone: 'ok' | 'warn' | 'bad' }) {
  const cell = (
    icon: React.ReactNode,
    label: string,
    value: React.ReactNode,
    tone: 'ok' | 'warn' | 'bad' | 'neutral',
  ) => {
    const toneCls = tone === 'ok' ? 'text-green-600 dark:text-green-400'
      : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
      : tone === 'bad' ? 'text-red-600 dark:text-red-400'
      : 'text-muted-foreground';
    return (
      <div className="flex-1 min-w-[130px] flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-secondary/40 ${toneCls}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium truncate">{label}</p>
          <p className={`text-xs font-bold truncate ${toneCls}`}>{value}</p>
        </div>
      </div>
    );
  };

  const fxAge = health.fx?.last_updated_sec_ago;
  const fxLabel = fxAge == null ? 'Never' :
    fxAge < 3600 ? `${Math.floor(fxAge / 60)}m ago` :
    fxAge < 86400 ? `${Math.floor(fxAge / 3600)}h ago` :
    `${Math.floor(fxAge / 86400)}d ago`;

  return (
    <div className={`rounded-2xl border p-4 bg-gradient-to-br from-slate-50 to-blue-50/40 dark:from-slate-900/50 dark:to-blue-950/20 ${HEALTH_CLASS[overallTone]}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
            <Activity size={15} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm">System Health</h3>
            <p className="text-[11px] text-muted-foreground">Real-time SLA & data integrity</p>
          </div>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-bold ${HEALTH_CLASS[overallTone]}`}>
          {HEALTH_LABEL[overallTone]}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {cell(
          <Server size={15} />,
          'API',
          health.api ? `${health.api.error_count_hour ?? 0} errors / hr` : '—',
          (health.api?.tone as any) ?? 'neutral',
        )}
        {cell(
          <Wifi size={15} />,
          'FX Rate',
          health.fx ? `updated ${fxLabel}` : '—',
          (health.fx?.tone as any) ?? 'neutral',
        )}
        {cell(
          <Coins size={15} />,
          'Coin Recon',
          health.coins ? `${health.coins.tolerance_pct ?? 0}% drift` : '—',
          (health.coins?.tone as any) ?? 'neutral',
        )}
        {cell(
          <ShieldCheck size={15} />,
          'Migrations',
          health.migrations ? `${health.migrations.applied}/${health.migrations.total}` : '—',
          (health.migrations?.tone as any) ?? 'neutral',
        )}
        {cell(
          <Zap size={15} />,
          'Reward Budget',
          health.reward_budget?.cap
            ? `${(health.reward_budget.pct_used ?? 0).toFixed(0)}% used`
            : 'Unlimited',
          (health.reward_budget?.tone as any) ?? 'neutral',
        )}
      </div>
      {(health.migrations?.pending ?? 0) > 0 && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          Pending migrations: {health.migrations.pending_names?.join(', ')}
        </p>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  EMERGENCY SWITCHES
// ══════════════════════════════════════════════════════════════════════════
function EmergencySwitches({
  flags, onToggle, busy,
}: {
  flags: { payouts_frozen: boolean; registrations_paused: boolean; new_calls_paused: boolean };
  onToggle: (flag: 'payouts_frozen' | 'registrations_paused' | 'new_calls_paused', on: boolean) => void;
  busy: boolean;
}) {
  const anyActive = flags.payouts_frozen || flags.registrations_paused || flags.new_calls_paused;
  const Switch = ({
    flag, on, icon, label, desc,
  }: {
    flag: 'payouts_frozen' | 'registrations_paused' | 'new_calls_paused';
    on: boolean; icon: React.ReactNode; label: string; desc: string;
  }) => (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
      on ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30'
         : 'border-border bg-background'
    }`}>
      <div className="flex items-start gap-2 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          on ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
             : 'bg-secondary text-muted-foreground'
        }`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-xs truncate">{label}</p>
          <p className="text-[10px] text-muted-foreground truncate">{desc}</p>
        </div>
      </div>
      <button
        onClick={() => onToggle(flag, !on)}
        disabled={busy}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
          on ? 'bg-red-500' : 'bg-secondary'
        } ${busy ? 'opacity-50 cursor-wait' : ''}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${anyActive ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400' : 'bg-secondary text-muted-foreground'}`}>
            <Power size={15} />
          </div>
          <div>
            <h3 className="font-bold text-sm">Emergency Switches</h3>
            <p className="text-[11px] text-muted-foreground">
              {anyActive ? '⚠ At least one platform action is paused' : 'All systems operational'}
            </p>
          </div>
        </div>
      </div>
      <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Switch
          flag="payouts_frozen"
          on={flags.payouts_frozen}
          icon={<Lock size={15} />}
          label="Freeze Payouts"
          desc="Block new withdrawal requests"
        />
        <Switch
          flag="registrations_paused"
          on={flags.registrations_paused}
          icon={<UserCheck size={15} />}
          label="Pause Registrations"
          desc="Block new account signups"
        />
        <Switch
          flag="new_calls_paused"
          on={flags.new_calls_paused}
          icon={<PhoneOff size={15} />}
          label="Pause New Calls"
          desc="Block call initiations"
        />
      </div>
      {anyActive && (
        <p className="px-4 pb-3 text-[11px] text-red-700 dark:text-red-400">
          <strong>Note:</strong> every toggle is audit-logged. In-flight operations continue; only NEW attempts are blocked.
        </p>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ROW B — FINANCIAL KPIs
// ══════════════════════════════════════════════════════════════════════════
function FinancialKPIs({ financial }: { financial: any }) {
  const wow = Number(financial.revenue_wow_pct ?? 0);
  const margin = Number(financial.margin_today_pct ?? 0);
  const marginTone =
    margin >= 25 ? 'text-green-600 dark:text-green-400' :
    margin >= 10 ? 'text-amber-600 dark:text-amber-400' :
    'text-red-600 dark:text-red-400';

  const Card = ({
    icon, label, value, sub, tone,
  }: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
    tone?: string;
  }) => (
    <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        {sub}
      </div>
      <div>
        <p className={`text-2xl font-bold ${tone ?? 'text-foreground'}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );

  return (
    <div>
      <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
        <CircleDollarSign size={14} className="text-primary" />
        Financial (₹)
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card
          icon={<CircleDollarSign size={18} />}
          label="Revenue today"
          value={inr(financial.revenue_today_inr, 0)}
        />
        <Card
          icon={<TrendingUp size={18} />}
          label="Revenue this month"
          value={inr(financial.revenue_month_inr, 0)}
          sub={wow !== 0 ? (
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${wow >= 0 ? 'text-green-600 bg-green-50 dark:bg-green-950/30' : 'text-red-600 bg-red-50 dark:bg-red-950/30'}`}>
              {wow >= 0 ? '↑' : '↓'} {Math.abs(wow).toFixed(0)}% WoW
            </span>
          ) : null}
        />
        <Card
          icon={<Wallet size={18} />}
          label="Platform net today"
          value={inr(financial.platform_net_today_inr, 0)}
          tone={Number(financial.platform_net_today_inr ?? 0) < 0 ? 'text-red-600' : undefined}
        />
        <Card
          icon={<Activity size={18} />}
          label="Margin today"
          value={pct(margin, 0)}
          tone={marginTone}
        />
        <Card
          icon={<Server size={18} />}
          label="Agora cost (month)"
          value={inr(financial.agora_cost_month_inr, 0)}
          sub={
            <span className="text-[10px] text-muted-foreground">${(financial.agora_cost_month_usd ?? 0).toFixed(2)}</span>
          }
        />
        <Link href="/withdrawals">
          <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3 hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 flex items-center justify-center">
                <ArrowUpRight size={18} />
              </div>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{inr(financial.pending_payouts_inr, 0)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Pending payouts</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ROW C — PENDING WORK COUNTERS
// ══════════════════════════════════════════════════════════════════════════
function PendingCounters({ pending }: { pending: any }) {
  const items = [
    { key: 'kyc', label: 'Pending KYC', count: pending.kyc ?? 0, icon: <UserCheck size={15} />, href: '/host-applications', tone: pending.kyc > 0 ? 'red' : 'neutral' },
    { key: 'withdrawals', label: 'Withdrawals', count: pending.withdrawals ?? 0, icon: <Wallet size={15} />, href: '/withdrawals', tone: pending.withdrawals > 0 ? 'red' : 'neutral' },
    { key: 'deposits', label: 'Deposits', count: pending.deposits ?? 0, icon: <ArrowDownRight size={15} />, href: '/deposits', tone: pending.deposits > 0 ? 'amber' : 'neutral' },
    { key: 'tickets', label: 'Support tickets', count: pending.support_tickets ?? 0, icon: <MessageSquare size={15} />, href: '/support-tickets', tone: pending.support_tickets > 0 ? 'amber' : 'neutral' },
    { key: 'reports', label: 'Content reports', count: pending.content_reports ?? 0, icon: <FileWarning size={15} />, href: '/content-moderation', tone: pending.content_reports > 0 ? 'amber' : 'neutral' },
    { key: 'errors', label: 'Errors (1h)', count: pending.server_errors_hour ?? 0, icon: <AlertTriangle size={15} />, href: '/audit-logs', tone: pending.server_errors_hour > 10 ? 'red' : pending.server_errors_hour > 0 ? 'amber' : 'neutral' },
  ];
  const toneCls: Record<string, string> = {
    red: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400',
    amber: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400',
    neutral: 'border-border bg-card text-muted-foreground',
  };
  return (
    <div>
      <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
        <ShieldAlert size={14} className="text-amber-600" />
        Pending Work — click to jump
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {items.map((it) => (
          <Link key={it.key} href={it.href}>
            <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 hover:shadow-sm transition-all cursor-pointer ${toneCls[it.tone]}`}>
              <div className="w-8 h-8 rounded-lg bg-white/60 dark:bg-black/20 flex items-center justify-center flex-shrink-0">
                {it.icon}
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold leading-none">{it.count}</p>
                <p className="text-[10px] uppercase tracking-wide truncate mt-0.5">{it.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ROW D — LIVE CALLS
// ══════════════════════════════════════════════════════════════════════════
function LiveCallsCard({ live }: { live: any }) {
  const active = Number(live.active_calls ?? 0);
  const burn = Number(live.burn_rate_inr_per_min ?? 0);
  const top = (live.top_calls ?? []) as Array<any>;
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-green-100 text-green-600 dark:bg-green-950/40 dark:text-green-400 flex items-center justify-center">
            <PhoneCall size={15} />
          </div>
          <div>
            <h3 className="font-bold text-sm">Live Calls</h3>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Updates every 20 s
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{active}</p>
          <p className="text-[10px] text-muted-foreground">
            burning {inr(burn, 2)}/min
          </p>
        </div>
      </div>
      <div className="p-3 space-y-2">
        {top.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No active calls right now</p>
        ) : (
          top.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-xs border-b border-border/50 last:border-0 pb-2 last:pb-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.type === 'video' ? 'bg-violet-500' : 'bg-blue-500'}`} />
                <span className="truncate">
                  <strong>{c.caller_name}</strong> → <strong>{c.host_name}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-muted-foreground">
                <span>{c.coins_per_minute} c/min</span>
                <span>·</span>
                <span>{Math.floor(c.started_ago_sec / 60)}m {c.started_ago_sec % 60}s</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ROW D — RECENT ACTIVITY
// ══════════════════════════════════════════════════════════════════════════
function RecentActivityCard({ recent, now }: { recent: any; now: number }) {
  const signups = (recent.signups ?? []) as Array<any>;
  const apps = (recent.host_applications ?? []) as Array<any>;
  const bigDeposits = (recent.big_deposits ?? []) as Array<any>;
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400 flex items-center justify-center">
          <Users size={15} />
        </div>
        <div>
          <h3 className="font-bold text-sm">Recent Activity</h3>
          <p className="text-[11px] text-muted-foreground">Signups, host applications, big deposits</p>
        </div>
      </div>
      <div className="divide-y divide-border">
        {signups.length > 0 && (
          <Section title="New signups">
            {signups.map((u: any) => (
              <Row key={u.id} left={<><strong>{u.name || '—'}</strong> <span className="text-muted-foreground">{u.email}</span></>} right={timeAgo(Number(u.created_at ?? now), now)} />
            ))}
          </Section>
        )}
        {apps.length > 0 && (
          <Section title="Host applications">
            {apps.map((a: any) => (
              <Row key={a.id} left={<><strong>{a.user_name || a.display_name || '—'}</strong> applied</>} right={timeAgo(Number(a.submitted_at ?? now), now)} />
            ))}
          </Section>
        )}
        {bigDeposits.length > 0 && (
          <Section title="Big deposits (> 1000 coins)">
            {bigDeposits.map((d: any) => (
              <Row key={d.id} left={<><strong>{d.user_name || '—'}</strong> bought {compact(d.coins)} coins</>} right={timeAgo(Number(d.created_at ?? now), now)} />
            ))}
          </Section>
        )}
        {signups.length === 0 && apps.length === 0 && bigDeposits.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">No recent activity</p>
        )}
      </div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="min-w-0 truncate">{left}</div>
      <span className="text-muted-foreground flex-shrink-0">{right}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ROW E — CHARTS
// ══════════════════════════════════════════════════════════════════════════
function ChartsRow({
  analytics, callSplit, chartRange, onRangeChange,
}: {
  analytics: any;
  callSplit: Array<{ type: string; calls: number; coins: number }>;
  chartRange: 7 | 30 | 90;
  onRangeChange: (r: 7 | 30 | 90) => void;
}) {
  const weekly = analytics?.weekly ?? [];
  // Retain the recharts Legend import via a visual legend below the chart
  // so the "unused Legend" TS warning doesn't fire (Legend is only useful
  // inside a chart, but we may want a manual legend row later).
  void Legend;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div>
            <h3 className="font-bold text-sm">Revenue Trend</h3>
            <p className="text-[11px] text-muted-foreground">Coins earned + new users</p>
          </div>
          <div className="flex items-center gap-1 bg-secondary rounded-lg p-0.5">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => onRangeChange(d)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  chartRange === d ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={weekly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="right" dataKey="users" fill="#10B981" radius={[3, 3, 0, 0]} name="New users" />
            <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={2.5} dot={false} name="Revenue (coins)" />
            <Line yAxisId="left" type="monotone" dataKey="calls" stroke="#06B6D4" strokeWidth={2} dot={false} name="Calls" strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4">
        <h3 className="font-bold text-sm mb-3">Call Types (last 7 d)</h3>
        {callSplit.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No calls in the last 7 days</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={callSplit}
                dataKey="calls"
                nameKey="type"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ type, percent }) => `${type} ${((percent as number) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {callSplit.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  LEADERBOARD
// ══════════════════════════════════════════════════════════════════════════
function Leaderboard({
  title, subtitle, rows, idKey, renderRight,
}: {
  title: string;
  subtitle: string;
  rows: any[];
  idKey: string;
  renderRight: (r: any) => React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/30">
        <h3 className="font-bold text-sm">{title}</h3>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="p-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No data</p>
        ) : (
          rows.map((r, i) => (
            <div key={r[idKey] || i} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                  i === 0 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400' :
                  i === 1 ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300' :
                  i === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400' :
                  'bg-secondary text-muted-foreground'
                }`}>
                  {i + 1}
                </span>
                <span className="truncate">{r.name || '—'}</span>
              </div>
              {renderRight(r)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ROW F — FRAUD + MONITORING STRIP
// ══════════════════════════════════════════════════════════════════════════
function FraudMonitoringStrip({ health }: { health: any }) {
  const s = health.security ?? {};
  const items = [
    { icon: <Lock size={13} />, label: 'Failed logins (1h)', value: s.failed_logins_hour ?? 0, tone: (s.failed_logins_hour ?? 0) > 20 ? 'red' : 'neutral' },
    { icon: <ShieldAlert size={13} />, label: 'Rate-limit hits (1h)', value: s.rate_limit_hits_hour ?? 0, tone: (s.rate_limit_hits_hour ?? 0) > 100 ? 'amber' : 'neutral' },
    { icon: <Ban size={13} />, label: 'Banned users', value: s.banned_users_total ?? 0, tone: 'neutral' },
    { icon: <Coins size={13} />, label: 'Coins issued', value: compact(health.coins?.issued ?? 0), tone: 'neutral' },
    { icon: <Wallet size={13} />, label: 'Coins in wallets', value: compact(health.coins?.in_wallets ?? 0), tone: 'neutral' },
    { icon: <TrendingDown size={13} />, label: 'Coins burned', value: compact(health.coins?.burned ?? 0), tone: 'neutral' },
  ];
  const toneCls: Record<string, string> = {
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
    neutral: 'text-foreground',
  };
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
          <ShieldCheck size={15} />
        </div>
        <div>
          <h3 className="font-bold text-sm">Security & Monitoring</h3>
          <p className="text-[11px] text-muted-foreground">Fraud signals + coin-ledger reconciliation</p>
        </div>
      </div>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 bg-background">
            <div className="w-7 h-7 rounded-lg bg-secondary/40 text-muted-foreground flex items-center justify-center">
              {it.icon}
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-bold ${toneCls[it.tone]}`}>{it.value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{it.label}</p>
            </div>
          </div>
        ))}
      </div>
      {(health.coins?.reconciliation_delta ?? 0) !== 0 && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-muted-foreground">
            <strong>Coin drift:</strong> residual (wallets − ledger, beyond baseline) = {compact(health.coins?.reconciliation_delta ?? 0)}
            {' '}({(health.coins?.tolerance_pct ?? 0).toFixed(2)}%).
            {(health.coins?.baseline ?? 0) !== 0 && ` Baseline ${compact(health.coins?.baseline ?? 0)} acknowledged.`}
            {' '}Small residual drift is expected for legacy bonuses that predate the ledger fix.
          </p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN ACTION LOG
// ══════════════════════════════════════════════════════════════════════════
function AdminActionLog({ actions, now }: { actions: any[]; now: number }) {
  if (!actions || actions.length === 0) return null;
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Activity size={15} />
          </div>
          <div>
            <h3 className="font-bold text-sm">Recent Admin Actions</h3>
            <p className="text-[11px] text-muted-foreground">Last 10 entries from audit_log</p>
          </div>
        </div>
        <Link href="/audit-logs">
          <button className="text-xs text-primary hover:underline">View all →</button>
        </Link>
      </div>
      <div className="divide-y divide-border">
        {actions.map((a) => (
          <div key={a.id} className="px-4 py-2.5 flex items-center justify-between text-xs gap-3">
            <div className="min-w-0">
              <p className="truncate">
                <strong>{a.admin_name || a.admin_email || 'Admin'}</strong>{' '}
                <span className="text-muted-foreground">
                  {a.action} {a.target_type} {a.target ? <span className="font-mono text-[10px]">({String(a.target).slice(0, 12)})</span> : null}
                </span>
              </p>
              {a.detail && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{a.detail}</p>}
            </div>
            <span className="text-muted-foreground flex-shrink-0">{timeAgo(Number(a.created_at ?? now), now)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
