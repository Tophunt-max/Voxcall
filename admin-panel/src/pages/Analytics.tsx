import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { StatCard } from '@/components/ui/StatCard';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, Legend
} from 'recharts';
import { TrendingUp, Users, Clock, Coins, Activity, UserCheck } from 'lucide-react';

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
  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const days = range === '30d' ? 30 : 7;
    Promise.all([
      api.analytics(days).catch(() => null),
      api.hosts().catch(() => []),
    ]).then(([a, h]) => {
      setAnalytics(a);
      setHosts(Array.isArray(h) ? h.slice(0, 5) : []);
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-base">Revenue & Users Trend</h3>
              <p className="text-xs text-muted-foreground">
                {range === '7d' ? 'Last 7 days (live data)' : 'Last 7 days — 30-day view coming soon'}
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
          <p className="text-xs text-muted-foreground mb-4">Call count — last 7 days</p>
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
