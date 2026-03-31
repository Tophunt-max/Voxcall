import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { StatCard } from '@/components/ui/StatCard';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import { Users, Mic2, PhoneCall, Coins, TrendingUp, Clock } from 'lucide-react';

const COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B', '#EF4444'];

// Generate mock time-series for charts until real analytics is connected
function mockWeekly() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days.map((day, i) => ({
    day,
    revenue: Math.floor(1200 + Math.random() * 800 + i * 120),
    calls: Math.floor(20 + Math.random() * 40 + i * 3),
    users: Math.floor(5 + Math.random() * 15 + i),
  }));
}

function mockRoleData(total: number) {
  return [
    { name: 'Users', value: Math.floor(total * 0.82) },
    { name: 'Hosts', value: Math.floor(total * 0.15) },
    { name: 'Admins', value: Math.max(1, Math.floor(total * 0.03)) },
  ];
}

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
  const [err, setErr] = useState('');
  const [weekly] = useState(mockWeekly);

  useEffect(() => {
    api.dashboard().then(setData).catch(e => setErr(e.message));
  }, []);

  const roleData = data ? mockRoleData(data.total_users || 10) : [];

  return (
    <div className="space-y-6">
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <span className="font-medium">API Error:</span> {err} — make sure the API server is running on port 8080
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Users" value={data?.total_users?.toLocaleString() ?? '–'} gradient="gradient-purple" change={12} />
        <StatCard icon={Mic2} label="Total Hosts" value={data?.total_hosts?.toLocaleString() ?? '–'} gradient="gradient-blue" change={8} />
        <StatCard icon={PhoneCall} label="Calls Today" value={data?.calls_today?.toLocaleString() ?? '0'} gradient="gradient-green" change={-3} />
        <StatCard icon={Coins} label="Revenue (Coins)" value={data?.total_revenue_coins?.toLocaleString() ?? '0'} gradient="gradient-orange" change={23} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Revenue Chart */}
        <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-base">Revenue Trend</h3>
              <p className="text-xs text-muted-foreground">Coins earned this week</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full font-semibold">
              <TrendingUp size={12} /> +18.4%
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={2.5} dot={false} name="Coins" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* User Roles Pie */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="mb-5">
            <h3 className="font-bold text-base">User Roles</h3>
            <p className="text-xs text-muted-foreground">Distribution by role</p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={roleData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value">
                {roleData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(val: any) => [val.toLocaleString(), '']} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 justify-center mt-2">
            {roleData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i] }} />
                <span>{d.name}</span>
                <span className="font-semibold text-foreground">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Calls Bar Chart */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-base">Daily Calls</h3>
              <p className="text-xs text-muted-foreground">Call volume this week</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weekly} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="calls" fill="#7C3AED" radius={[4, 4, 0, 0]} name="Calls" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* New Users Bar Chart */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-base">New Registrations</h3>
              <p className="text-xs text-muted-foreground">Sign-ups this week</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weekly} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="users" fill="#06B6D4" radius={[4, 4, 0, 0]} name="New Users" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Avg. Call Duration', value: '14.2 min', icon: Clock, color: 'text-violet-600 bg-violet-50' },
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
