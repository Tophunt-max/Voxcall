import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Users, Mic2, PhoneCall, Coins } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color }: any) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value ?? '–'}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dashboard().then(setData).catch(e => setErr(e.message));
  }, []);

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">Overview</h2>
      {err && <p className="text-destructive text-sm mb-4 bg-destructive/10 px-3 py-2 rounded-lg">{err} — make sure the API server is running</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Users" value={data?.total_users} color="bg-primary" />
        <StatCard icon={Mic2} label="Total Hosts" value={data?.total_hosts} color="bg-accent" />
        <StatCard icon={PhoneCall} label="Calls Today" value={data?.calls_today} color="bg-green-500" />
        <StatCard icon={Coins} label="Revenue (Coins)" value={data?.total_revenue_coins?.toLocaleString()} color="bg-amber-500" />
      </div>
      {!data && !err && (
        <div className="mt-8 text-center text-muted-foreground text-sm py-16">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          Loading stats...
        </div>
      )}
    </div>
  );
}
