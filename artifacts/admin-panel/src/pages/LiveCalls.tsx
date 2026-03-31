import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Phone, PhoneOff, RefreshCw, Clock, Mic2, Users, Activity } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';

const MOCK_CALLS = [
  { id: 'C001', user: 'Rahul V.', host: 'Priya S.', started_at: Date.now() - 8 * 60000, coins_per_min: 10, type: 'voice', status: 'active' },
  { id: 'C002', user: 'Sunita R.', host: 'Anjali K.', started_at: Date.now() - 22 * 60000, coins_per_min: 15, type: 'video', status: 'active' },
  { id: 'C003', user: 'Arun P.', host: 'Meera R.', started_at: Date.now() - 3 * 60000, coins_per_min: 10, type: 'voice', status: 'active' },
  { id: 'C004', user: 'Kavya N.', host: 'Divya M.', started_at: Date.now() - 45 * 60000, coins_per_min: 20, type: 'video', status: 'active' },
  { id: 'C005', user: 'Raj S.', host: 'Sneha T.', started_at: Date.now() - 12 * 60000, coins_per_min: 10, type: 'voice', status: 'active' },
];

function useTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

function Duration({ startedAt }: { startedAt: number }) {
  useTicker();
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return <span className="font-mono text-sm font-bold text-violet-600">{m}:{s}</span>;
}

function UserAvatar({ name, color }: { name: string; color?: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500'];
  const c = color || colors[name.charCodeAt(0) % colors.length];
  return <div className={`w-7 h-7 rounded-full ${c} flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0`}>{name[0]}</div>;
}

export default function LiveCalls() {
  const [calls, setCalls] = useState(MOCK_CALLS);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const intervalRef = useRef<any>(null);

  const refresh = () => {
    api.callSessions?.().then(data => {
      const active = (data || []).filter((c: any) => c.status === 'active');
      if (active.length > 0) setCalls(active);
    }).catch(() => {});
    setLastRefresh(new Date());
  };

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(refresh, 5000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh]);

  const totalCoinsPerMin = calls.reduce((a, c) => a + c.coins_per_min, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Live Calls Monitor</h2>
          <p className="text-sm text-muted-foreground">
            Last updated: {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoRefresh ? 'bg-primary' : 'bg-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoRefresh ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-muted-foreground">Auto-refresh</span>
          </div>
          <button onClick={refresh} className="p-2 rounded-xl border border-border hover:bg-secondary transition-colors">
            <RefreshCw size={15} className={autoRefresh ? 'animate-spin' : ''} style={autoRefresh ? { animationDuration: '3s' } : {}} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Phone} label="Active Calls" value={calls.length.toString()} gradient="gradient-green" />
        <StatCard icon={Users} label="Users on Call" value={calls.length.toString()} gradient="gradient-purple" />
        <StatCard icon={Mic2} label="Hosts Active" value={calls.length.toString()} gradient="gradient-blue" />
        <StatCard icon={Activity} label="Coins/min" value={totalCoinsPerMin.toString()} gradient="gradient-orange" />
      </div>

      {calls.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-16 text-center">
          <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
            <PhoneOff size={22} className="text-muted-foreground" />
          </div>
          <p className="font-semibold">No active calls</p>
          <p className="text-sm text-muted-foreground mt-1">All quiet right now</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-secondary/30 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-semibold">{calls.length} calls in progress</span>
          </div>
          <div className="divide-y divide-border">
            {calls.map(call => {
              const coinsSoFar = Math.floor((Date.now() - call.started_at) / 60000) * call.coins_per_min;
              return (
                <div key={call.id} className="flex items-center gap-4 p-4 hover:bg-secondary/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <UserAvatar name={call.user} />
                        <span className="text-sm font-semibold">{call.user}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Phone size={12} />
                      </div>
                      <div className="flex items-center gap-1">
                        <UserAvatar name={call.host} color="bg-violet-500" />
                        <span className="text-sm font-semibold">{call.host}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${call.type === 'video' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                        {call.type}
                      </span>
                      <span className="text-xs text-muted-foreground">ID: {call.id}</span>
                      <span className="text-xs text-amber-600 font-semibold">{call.coins_per_min} coins/min</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-1">
                    <div className="flex items-center gap-1 justify-end">
                      <Clock size={12} className="text-muted-foreground" />
                      <Duration startedAt={call.started_at} />
                    </div>
                    <p className="text-xs text-amber-600">~{coinsSoFar} coins used</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
