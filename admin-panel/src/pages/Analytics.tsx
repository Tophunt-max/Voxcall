import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { StatCard } from '@/components/ui/StatCard';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, Legend
} from 'recharts';
import { TrendingUp, Users, Clock, Coins, Activity, Smartphone, Globe, UserCheck } from 'lucide-react';

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

const MOCK_WEEKLY = [
  { day: 'Mon', revenue: 1200, users: 45, calls: 30, retention: 68 },
  { day: 'Tue', revenue: 1800, users: 62, calls: 48, retention: 72 },
  { day: 'Wed', revenue: 1400, users: 38, calls: 35, retention: 65 },
  { day: 'Thu', revenue: 2200, users: 80, calls: 60, retention: 78 },
  { day: 'Fri', revenue: 2800, users: 95, calls: 75, retention: 82 },
  { day: 'Sat', revenue: 3200, users: 110, calls: 90, retention: 85 },
  { day: 'Sun', revenue: 2600, users: 88, calls: 68, retention: 79 },
];

const MOCK_MONTHLY = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1}`,
  revenue: Math.floor(1000 + Math.random() * 2000),
  users: Math.floor(30 + Math.random() * 80),
}));

const MOCK_PLATFORM = [
  { name: 'Android', value: 65 },
  { name: 'iOS', value: 28 },
  { name: 'Web', value: 7 },
];

const MOCK_TOP_HOSTS = [
  { name: 'Priya S.', earnings: 8400, calls: 210, rating: 4.9 },
  { name: 'Anjali K.', earnings: 7200, calls: 185, rating: 4.8 },
  { name: 'Meera R.', earnings: 6800, calls: 170, rating: 4.7 },
  { name: 'Divya M.', earnings: 5600, calls: 142, rating: 4.8 },
  { name: 'Sneha T.', earnings: 4900, calls: 125, rating: 4.6 },
];

export default function Analytics() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [range, setRange] = useState<'7d' | '30d'>('7d');

  useEffect(() => {
    api.analytics().then(setAnalytics).catch(() => {});
  }, []);

  const weekly = analytics?.weekly ?? MOCK_WEEKLY;
  const data = range === '7d' ? MOCK_WEEKLY : MOCK_MONTHLY;

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
        <StatCard icon={Users} label="DAU" value="342" gradient="gradient-purple" />
        <StatCard icon={UserCheck} label="MAU" value="4,821" gradient="gradient-blue" />
        <StatCard icon={Activity} label="Retention Rate" value="74%" gradient="gradient-green" />
        <StatCard icon={Coins} label="Avg Revenue/User" value="₹48" gradient="gradient-orange" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-base">Revenue & Users Trend</h3>
              <p className="text-xs text-muted-foreground">{range === '7d' ? 'Last 7 days' : 'Last 30 days'}</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 px-2.5 py-1 rounded-full font-semibold">
              <TrendingUp size={12} /> Live
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data}>
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
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-1">Platform Split</h3>
          <p className="text-xs text-muted-foreground mb-4">Users by device</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={MOCK_PLATFORM} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                {MOCK_PLATFORM.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => `${v}%`} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-2">
            {MOCK_PLATFORM.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i] }} />
                  <span>{p.name}</span>
                </div>
                <span className="font-semibold">{p.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-1">Retention Rate</h3>
          <p className="text-xs text-muted-foreground mb-4">Daily user retention %</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={MOCK_WEEKLY}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis domain={[50, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CT />} />
              <Line type="monotone" dataKey="retention" stroke="#10B981" strokeWidth={2.5} dot={{ fill: '#10B981', r: 3 }} name="Retention %" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-1">Top Earning Hosts</h3>
          <p className="text-xs text-muted-foreground mb-4">This month</p>
          <div className="space-y-3">
            {MOCK_TOP_HOSTS.map((h, i) => (
              <div key={h.name} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{h.name}</p>
                  <p className="text-xs text-muted-foreground">{h.calls} calls · ⭐ {h.rating}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-violet-600">{h.earnings.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">coins</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
