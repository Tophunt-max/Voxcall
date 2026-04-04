import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatCard } from '@/components/ui/StatCard';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import { Users, Mic2, PhoneCall, Coins, TrendingUp, Clock } from 'lucide-react';

const COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B', '#EF4444'];

const CustomTooltip = ({ active, payload, label }: any) => {
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

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />
      ))}
    </div>
  );
}

export default function Dashboard() {
  // OPTIMIZATION #14: useQuery replaces manual useEffect+useState
  //   - Automatic background refetch every 30 s (live dashboard feel — optimization #17)
  //   - Deduplicates concurrent requests on the same page
  //   - Automatic retry on network failure (3 attempts)
  //   - Cached in React Query's in-memory store so navigating back is instant
  const { data, isLoading: loadingDash, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { data: analytics, isLoading: loadingAnalytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: () => api.analytics(),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  const { data: settings = {} as Record<string, string> } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings(),
    staleTime: 5 * 60_000,
  });

  const weekly = (analytics as any)?.weekly ?? [];
  const roleData = (analytics as any)?.role_distribution ?? [];
  const avgDuration = (analytics as any)?.avg_call_duration ?? 0;
  const avgDurationMin = avgDuration > 0 ? `${(avgDuration / 60).toFixed(1)} min` : '—';

  const payoutRate = (settings as any)['host_revenue_share']
    ? `${parseFloat((settings as any)['host_revenue_share']) * 100}%`
    : '70%';
  const coinValue = (settings as any)['coin_value_inr']
    ? `₹${(settings as any)['coin_value_inr']}`
    : '₹0.01';

  const loading = loadingDash || loadingAnalytics;

  if (loading) {
    return (
      <div className="space-y-6">
        <StatsSkeleton />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 h-72 rounded-2xl bg-muted animate-pulse" />
          <div className="h-72 rounded-2xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <span className="font-medium">API Error:</span> {(error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Users" value={(data as any)?.total_users?.toLocaleString() ?? '–'} gradient="gradient-purple" />
        <StatCard icon={Mic2} label="Total Hosts" value={(data as any)?.total_hosts?.toLocaleString() ?? '–'} gradient="gradient-blue" />
        <StatCard icon={PhoneCall} label="Calls Today" value={(data as any)?.calls_today?.toLocaleString() ?? '0'} gradient="gradient-green" />
        <StatCard icon={Coins} label="Revenue (Coins)" value={(data as any)?.total_revenue_coins?.toLocaleString() ?? '0'} gradient="gradient-orange" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-base">Revenue Trend</h3>
              <p className="text-xs text-muted-foreground">Coins earned — last 7 days</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
              <TrendingUp className="w-3 h-3" />
              Live · auto-refreshes
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="revenue_coins" stroke="#7C3AED" strokeWidth={2} dot={false} name="Coins" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-5">User Roles</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={roleData} dataKey="count" nameKey="role" cx="50%" cy="50%" outerRadius={70} label={({ role, percent }) => `${role} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                {roleData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-5">Daily Calls</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d?.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="calls" fill="#06B6D4" radius={[4, 4, 0, 0]} name="Calls" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-base">Quick Stats</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" /> Avg Call Duration
              </div>
              <span className="font-semibold text-sm">{avgDurationMin}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Host Payout Rate</span>
              <span className="font-semibold text-sm">{payoutRate}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Coin Value</span>
              <span className="font-semibold text-sm">{coinValue}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Active Hosts</span>
              <span className="font-semibold text-sm">{(data as any)?.online_hosts ?? '—'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
