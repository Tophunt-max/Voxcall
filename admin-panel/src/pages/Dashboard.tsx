import { useEffect, useState } from 'react';
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

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dashboard().then(setData).catch(e => setErr(e.message));
    api.analytics().then(setAnalytics).catch(() => {});
  }, []);

  const weekly = analytics?.weekly ?? [];
  const roleData = analytics?.role_distribution ?? [];
  const avgDuration = analytics?.avg_call_duration ?? 0;
  const avgDurationMin = avgDuration > 0 ? `${(avgDuration / 60).toFixed(1)} min` : '—';

  return (
    <div className="space-y-6">
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <span className="font-medium">API Error:</span> {err}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Users" value={data?.total_users?.toLocaleString() ?? '–'} gradient="gradient-purple" />
        <StatCard icon={Mic2} label="Total Hosts" value={data?.total_hosts?.toLocaleString() ?? '–'} gradient="gradient-blue" />
        <StatCard icon={PhoneCall} label="Calls Today" value={data?.calls_today?.toLocaleString() ?? '0'} gradient="gradient-green" />
        <StatCard icon={Coins} label="Revenue (Coins)" value={data?.total_revenue_coins?.toLocaleString() ?? '0'} gradient="gradient-orange" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-base">Revenue Trend</h3>
              <p className="text-xs text-muted-foreground">Coins earned — last 7 days</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 px-2.5 py-1 rounded-full font-semibold">
              <TrendingUp size={12} /> Live
            </div>
          </div>
          {weekly.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              No data yet — charts populate once calls happen
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={2.5} dot={{ fill: '#7C3AED', r: 3 }} name="Revenue (Coins)" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="mb-5">
            <h3 className="font-bold text-base">User Breakdown</h3>
            <p className="text-xs text-muted-foreground">Users vs Hosts vs Admins</p>
          </div>
          {roleData.every((r: any) => r.value === 0) ? (
            <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">No users yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={roleData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                  {roleData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any, n: any) => [v, n]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="mb-5">
            <h3 className="font-bold text-base">Daily Calls</h3>
            <p className="text-xs text-muted-foreground">Call count — last 7 days</p>
          </div>
          {weekly.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">No calls yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weekly} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="calls" fill="#7C3AED" radius={[4, 4, 0, 0]} name="Calls" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="mb-5">
            <h3 className="font-bold text-base">New Registrations</h3>
            <p className="text-xs text-muted-foreground">Sign-ups — last 7 days</p>
          </div>
          {weekly.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">No registrations yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weekly} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="users" fill="#06B6D4" radius={[4, 4, 0, 0]} name="New Users" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Avg. Call Duration', value: avgDurationMin, icon: Clock, color: 'text-violet-600 bg-violet-50' },
          { label: 'Host Payout Rate', value: '70%', icon: Coins, color: 'text-green-600 bg-green-50' },
          { label: 'Coin → USD', value: '$0.01', icon: TrendingUp, color: 'text-blue-600 bg-blue-50' },
          { label: 'Active Hosts', value: `${data?.total_hosts ?? 0}`, icon: Mic2, color: 'text-orange-600 bg-orange-50' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg ${s.color} flex items-center justify-center flex-shrink-0`}>
              <s.icon size={17} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm">{s.value}</p>
              <p className="text-xs text-muted-foreground truncate">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
