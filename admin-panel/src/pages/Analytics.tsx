import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { StatCard } from '@/components/ui/StatCard';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { TrendingUp, Users, Clock, Coins, Activity, UserCheck, Gift } from 'lucide-react';

const COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B', '#EF4444'];

const CT = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-lg text-sm">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="text-xs">{p.name}: <strong>{p.value?.toLocaleString()}</strong></p>
      ))}
    </div>
  );
};

const PLATFORM_SIMULATED = [
  { name: 'Android', value: 65 },
  { name: 'iOS', value: 28 },
  { name: 'Web', value: 7 },
];

export default function Analytics() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [hosts, setHosts] = useState<any[]>([]);
  const [streak, setStreak] = useState<any>(null);
  const [recon, setRecon] = useState<any>(null);
  const [margins, setMargins] = useState<any>(null);
  const [freeMin, setFreeMin] = useState<any>(null);
  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const days = range === '30d' ? 30 : 7;
    Promise.all([
      api.analytics(days).catch(() => null),
      api.hosts().catch(() => []),
      api.streakAnalytics().catch(() => null),
      api.coinReconciliation().catch(() => null),
      api.marginAnalytics(days).catch(() => null),
      api.freeMinutesStats().catch(() => null),
    ]).then(([a, h, s, r, m, fm]) => {
      setAnalytics(a);
      setHosts(Array.isArray(h) ? h.slice(0, 5) : []);
      setStreak(s);
      setRecon(r);
      setMargins(m);
      setFreeMin(fm);
    }).finally(() => setLoading(false));
  }, [range]);

  const weekly: any[] = analytics?.weekly ?? [];
  const avgDuration = analytics?.avg_call_duration ?? 0;

  // Derive DAU/MAU from weekly data
  const totalWeeklyUsers = weekly.reduce((s: number, d: any) => s + (d.users || 0), 0);
  const avgDAU = weekly.length > 0 ? Math.round(totalWeeklyUsers / weekly.length) : 0;
  const estMAU = Math.round(avgDAU * 4.2);
  const totalWeeklyCalls = weekly.reduce((s: number, d: any) => s + (d.calls || 0), 0);
  const estRetention = totalWeeklyCalls > 0 && totalWeeklyUsers > 0
    ? `${Math.min(Math.round((totalWeeklyCalls / totalWeeklyUsers) * 100), 99)}%`
    : '—';
  const totalRevenue = weekly.reduce((s: number, d: any) => s + (d.revenue || 0), 0);
  const avgRevenuePerUser = totalWeeklyUsers > 0 ? Math.round(totalRevenue / totalWeeklyUsers) : 0;

  const topHosts = hosts
    .filter((h: any) => h.total_minutes > 0 || h.total_earnings > 0)
    .sort((a: any, b: any) => (b.total_earnings ?? 0) - (a.total_earnings ?? 0))
    .slice(0, 5);

  const chartData = weekly.length > 0 ? weekly : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Loading analytics…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Analytics</h2>
          <p className="text-sm text-muted-foreground">Platform performance overview</p>
        </div>
        <div className="flex gap-1 bg-secondary rounded-xl p-1">
          {(['7d', '30d'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {r === '7d' ? '7 Days' : '30 Days'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Avg DAU" value={avgDAU > 0 ? avgDAU.toLocaleString() : '—'} gradient="gradient-purple" />
        <StatCard icon={UserCheck} label="Est. MAU" value={estMAU > 0 ? estMAU.toLocaleString() : '—'} gradient="gradient-blue" />
        <StatCard icon={Activity} label="Call/User Rate" value={estRetention} gradient="gradient-green" />
        <StatCard icon={Coins} label="Avg Revenue/User" value={avgRevenuePerUser > 0 ? `${avgRevenuePerUser} coins` : '—'} gradient="gradient-orange" />
      </div>

      {/* ── Free-Trial Minutes: acquisition → conversion ────────────────── */}
      {freeMin && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Gift size={16} className="text-green-500" />
            <h3 className="font-bold text-base">Free Trial Minutes</h3>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard icon={Gift} label="Free Min Used" value={(freeMin.free_minutes_used_total || 0).toLocaleString()} gradient="gradient-green" />
            <StatCard icon={Activity} label="Free Calls" value={(freeMin.free_calls || 0).toLocaleString()} gradient="gradient-blue" />
            <StatCard icon={UserCheck} label="Tried → Paid" value={`${freeMin.converted_to_paid || 0} (${freeMin.conversion_pct || 0}%)`} gradient="gradient-purple" />
            <StatCard icon={Coins} label="Outstanding (min)" value={(freeMin.free_minutes_outstanding || 0).toLocaleString()} gradient="gradient-orange" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {freeMin.users_tried_free || 0} users tried free minutes; {freeMin.users_with_free_balance || 0} currently hold a free balance. Conversion = free-trial users who later recharged with real money.
          </p>
        </div>
      )}

      {/* ── Call Economics & Margins (Agora-aware P&L) ─────────────────── */}
      {margins && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
              <TrendingUp size={14} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="font-bold text-base">Call Economics &amp; Margins</h3>
              <p className="text-xs text-muted-foreground">
                Last {range === '7d' ? '7' : '30'} days · {(margins.calls ?? 0).toLocaleString()} calls ·{' '}
                {(margins.billed_minutes?.total ?? 0).toLocaleString()} billed min
                (🎤 {(margins.billed_minutes?.audio ?? 0).toLocaleString()} / 🎥 {(margins.billed_minutes?.video ?? 0).toLocaleString()})
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            {[
              { label: 'Revenue', value: margins.revenue_inr, color: 'text-green-600' },
              { label: 'Host payout', value: margins.host_payout_inr, color: 'text-amber-600' },
              { label: 'Agora cost', value: margins.agora_cost_inr, color: 'text-blue-600' },
              { label: 'Gateway fee', value: margins.gateway_fee_inr, color: 'text-muted-foreground' },
              { label: 'Platform net', value: margins.platform_net_inr, color: 'text-violet-600' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-background px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className={`font-bold text-lg ${s.color}`}>₹{(s.value ?? 0).toLocaleString()}</p>
              </div>
            ))}
            <div className="rounded-xl border border-border bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Margin</p>
              <p className="font-bold text-lg text-emerald-600">{(margins.margin_pct ?? 0).toFixed(1)}%</p>
            </div>
          </div>

          {/* Agora usage + volume discount (current month) */}
          {margins.agora_usage_month && (
            <div className="rounded-xl border border-border bg-blue-50/40 dark:bg-blue-950/10 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Agora Usage — This Month
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <span>Call min: <strong>{(margins.agora_usage_month.call_minutes ?? 0).toLocaleString()}</strong></span>
                <span>Participant min: <strong>{(margins.agora_usage_month.participant_minutes ?? 0).toLocaleString()}</strong></span>
                <span className="text-green-600">Free: {(margins.agora_usage_month.free_minutes ?? 0).toLocaleString()}</span>
                <span>Billable: <strong>{(margins.agora_usage_month.billable_minutes ?? 0).toLocaleString()}</strong></span>
                <span className="px-2 py-0.5 rounded-lg bg-secondary font-semibold">{margins.agora_usage_month.tier_label}</span>
                <span className="ml-auto">Est. bill: <strong className="text-blue-600">${(margins.agora_usage_month.est_bill_usd ?? 0).toLocaleString()}</strong> <span className="text-muted-foreground">(₹{(margins.agora_usage_month.est_bill_inr ?? 0).toLocaleString()})</span></span>
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground italic mt-3">
            Revenue = billed coins × ₹{margins.config?.coin_purchase_inr}/coin · Host payout = ledger bonus coins × ₹{margins.config?.coin_payout_inr}/coin ·
            Agora @ FX ₹{margins.config?.fx_inr_per_usd}/$ ({margins.config?.video_max_resolution} video). Volume discount tiers: 100k/500k/1M participant-min → 5/7/10%.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-base">Revenue & Users Trend</h3>
              <p className="text-xs text-muted-foreground">
                {range === '7d' ? 'Last 7 days (live data)' : 'Last 30 days (live data)'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 px-2.5 py-1 rounded-full font-semibold">
              <TrendingUp size={12} /> Live
            </div>
          </div>
          {chartData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
              No data yet — charts populate once calls happen
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CT />} />
                <Area type="monotone" dataKey="revenue" stroke="#7C3AED" fill="url(#revGrad)" strokeWidth={2.5} name="Revenue (Coins)" />
                <Line type="monotone" dataKey="users" stroke="#06B6D4" strokeWidth={2} dot={false} name="New Users" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-1">Platform Split</h3>
          <p className="text-xs text-muted-foreground mb-4">Estimated by device type</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={PLATFORM_SIMULATED} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                {PLATFORM_SIMULATED.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => `${v}%`} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-2">
            {PLATFORM_SIMULATED.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i] }} />
                  <span>{p.name}</span>
                </div>
                <span className="font-semibold text-muted-foreground">~{p.value}%</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground italic mt-1">* Estimated — platform tracking not yet instrumented</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-1">Daily Calls</h3>
          <p className="text-xs text-muted-foreground mb-4">Call count — last {range === '7d' ? '7' : '30'} days</p>
          {chartData.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">No calls yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CT />} />
                <Bar dataKey="calls" fill="#10B981" radius={[4, 4, 0, 0]} name="Calls" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-1">Top Earning Hosts</h3>
          <p className="text-xs text-muted-foreground mb-4">By total earnings</p>
          {topHosts.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">No host data yet</div>
          ) : (
            <div className="space-y-3">
              {topHosts.map((h: any, i: number) => (
                <div key={h.id ?? i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{h.display_name || h.name || 'Host'}</p>
                    <p className="text-xs text-muted-foreground">{h.total_calls ?? 0} calls · ⭐ {(h.rating ?? 0).toFixed(1)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-violet-600">{(h.total_earnings ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">coins</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Economy Health (coin reconciliation) ──────────────────────── */}
      {recon && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
              <Coins size={14} className="text-amber-600" />
            </div>
            <div>
              <h3 className="font-bold text-base">Economy Health</h3>
              <p className="text-xs text-muted-foreground">Coins in circulation vs the transaction ledger</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Coins in circulation</p>
              <p className="font-bold text-lg">{(recon.circulation?.total_coins ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{(recon.circulation?.users ?? 0).toLocaleString()} users</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ledger net</p>
              <p className="font-bold text-lg">{(recon.ledger_net ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Aggregate drift</p>
              <p className={`font-bold text-lg ${Math.abs(recon.aggregate_drift ?? 0) > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {(recon.aggregate_drift ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ledger entry types</p>
              <p className="font-bold text-lg">{(recon.ledger_by_type?.length ?? 0)}</p>
            </div>
          </div>
          {Array.isArray(recon.ledger_by_type) && recon.ledger_by_type.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {recon.ledger_by_type.map((t: any) => (
                <span key={t.type} className="text-xs bg-secondary px-2.5 py-1 rounded-lg">
                  <strong className="capitalize">{t.type}</strong>: {(t.total ?? 0).toLocaleString()} ({t.count})
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground italic mt-3">{recon.note}</p>
        </div>
      )}

      {/* ── Daily Streak engagement ────────────────────────────────────── */}
      {streak && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center">
              <Activity size={14} className="text-orange-600" />
            </div>
            <div>
              <h3 className="font-bold text-base">Daily Streak Engagement</h3>
              <p className="text-xs text-muted-foreground">Active streaks, claims, and length distribution</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active streaks</p>
              <p className="font-bold text-lg">{(streak.users_with_active_streak ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Claimed today</p>
              <p className="font-bold text-lg text-green-600">{(streak.claimed_today ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Longest streak</p>
              <p className="font-bold text-lg">{streak.longest_streak ?? 0} <span className="text-xs font-normal text-muted-foreground">days</span></p>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg streak</p>
              <p className="font-bold text-lg">{streak.average_streak ?? 0} <span className="text-xs font-normal text-muted-foreground">days</span></p>
            </div>
          </div>
          {streak.distribution && (
            <div className="flex flex-wrap gap-2">
              {([
                ['Day 1', streak.distribution.day_1],
                ['Day 2–6', streak.distribution.day_2_6],
                ['Day 7–29', streak.distribution.day_7_29],
                ['Day 30–99', streak.distribution.day_30_99],
                ['Day 100+', streak.distribution.day_100_plus],
              ] as const).map(([label, v]) => (
                <span key={label} className="text-xs bg-secondary px-2.5 py-1 rounded-lg">
                  <strong>{label}</strong>: {(v ?? 0).toLocaleString()}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {avgDuration > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg text-violet-600 bg-violet-50 flex items-center justify-center flex-shrink-0">
            <Clock size={17} />
          </div>
          <div>
            <p className="font-bold text-sm">{(avgDuration / 60).toFixed(1)} min</p>
            <p className="text-xs text-muted-foreground">Avg Call Duration (all time)</p>
          </div>
        </div>
      )}
    </div>
  );
}
