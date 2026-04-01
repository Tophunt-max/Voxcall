import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Phone, PhoneOff, RefreshCw, Clock, Mic2, Users, Activity, AlertTriangle, Trash2 } from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';

function useTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

function Duration({ startedAt }: { startedAt: number }) {
  useTicker();
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  const display = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  return <span className="font-mono text-sm font-bold text-violet-600">{display}</span>;
}

function UserAvatar({ name, color }: { name: string; color?: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500'];
  const c = color || colors[(name || 'U').charCodeAt(0) % colors.length];
  return <div className={`w-7 h-7 rounded-full ${c} flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0`}>{(name || 'U')[0]}</div>;
}

function isStale(startedAt: number, hours = 1) {
  return Date.now() - startedAt > hours * 3600 * 1000;
}

export default function LiveCalls() {
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [endingId, setEndingId] = useState<string | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const intervalRef = useRef<any>(null);

  const refresh = () => {
    api.liveCalls().then(data => {
      setCalls(data || []);
    }).catch(() => {}).finally(() => {
      setLoading(false);
      setLastRefresh(new Date());
    });
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(refresh, 5000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh]);

  const handleForceEnd = async (callId: string) => {
    if (!confirm('Is call ko force-end karna chahte hain?')) return;
    setEndingId(callId);
    try {
      await api.forceEndCall(callId);
      refresh();
    } catch {
      alert('Call end karne mein error aaya');
    } finally {
      setEndingId(null);
    }
  };

  const handleStaleCleanup = async () => {
    if (!confirm('Sabhi 1+ ghante purane stuck calls ko end kar dein?')) return;
    setCleaningUp(true);
    try {
      const res = await api.cleanupStaleCalls(1);
      alert(`${res.ended ?? 0} stale calls clean up ho gayi`);
      refresh();
    } catch {
      alert('Cleanup mein error aaya');
    } finally {
      setCleaningUp(false);
    }
  };

  const totalCoinsPerMin = calls.reduce((a, c) => a + (c.coins_per_min || 0), 0);
  const voiceCalls = calls.filter(c => c.type === 'audio');
  const videoCalls = calls.filter(c => c.type === 'video');
  const staleCalls = calls.filter(c => isStale(c.started_at || Date.now(), 1));

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
          {staleCalls.length > 0 && (
            <button
              onClick={handleStaleCleanup}
              disabled={cleaningUp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              <Trash2 size={13} />
              {cleaningUp ? 'Cleaning...' : `Clean ${staleCalls.length} stale`}
            </button>
          )}
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoRefresh ? 'bg-primary' : 'bg-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoRefresh ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-muted-foreground">Auto-refresh</span>
          </div>
          <button onClick={refresh} className="p-2 rounded-xl border border-border hover:bg-secondary transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Phone} label="Active Calls" value={calls.length.toString()} gradient="gradient-green" />
        <StatCard icon={Users} label="Voice Calls" value={voiceCalls.length.toString()} gradient="gradient-purple" />
        <StatCard icon={Mic2} label="Video Calls" value={videoCalls.length.toString()} gradient="gradient-blue" />
        <StatCard icon={Activity} label="Coins/min Earning" value={totalCoinsPerMin.toString()} gradient="gradient-orange" />
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-2xl p-12 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : calls.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-16 text-center">
          <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
            <PhoneOff size={22} className="text-muted-foreground" />
          </div>
          <p className="font-semibold">No active calls</p>
          <p className="text-sm text-muted-foreground mt-1">All quiet right now — live calls will appear here automatically</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-secondary/30 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-semibold">{calls.length} call{calls.length !== 1 ? 's' : ''} in progress</span>
            {staleCalls.length > 0 && (
              <span className="ml-auto flex items-center gap-1 text-xs text-red-500 font-semibold">
                <AlertTriangle size={12} />
                {staleCalls.length} stuck/stale
              </span>
            )}
          </div>
          <div className="divide-y divide-border">
            {calls.map(call => {
              const coinsSoFar = Math.floor((Date.now() - (call.started_at || Date.now())) / 60000) * (call.coins_per_min || 0);
              const stale = isStale(call.started_at || Date.now(), 1);
              const isEnding = endingId === call.id;
              return (
                <div key={call.id} className={`flex items-center gap-4 p-4 transition-colors ${stale ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-secondary/20'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {stale && <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />}
                      <div className="flex items-center gap-1">
                        <UserAvatar name={call.user || 'U'} />
                        <span className="text-sm font-semibold">{call.user || 'User'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Phone size={12} />
                      </div>
                      <div className="flex items-center gap-1">
                        <UserAvatar name={call.host || 'H'} color="bg-violet-500" />
                        <span className="text-sm font-semibold">{call.host || 'Host'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${call.type === 'video' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                        {call.type === 'video' ? '🎥 video' : '🎤 voice'}
                      </span>
                      <span className="text-xs text-muted-foreground">ID: {(call.id || '').slice(0, 8)}</span>
                      <span className="text-xs text-amber-600 font-semibold">{call.coins_per_min} coins/min</span>
                      {stale && <span className="text-[10px] bg-red-100 text-red-600 font-semibold px-1.5 py-0.5 rounded">STUCK</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right space-y-1">
                      <div className="flex items-center gap-1 justify-end">
                        <Clock size={12} className="text-muted-foreground" />
                        <Duration startedAt={call.started_at || Date.now()} />
                      </div>
                      <p className="text-xs text-amber-600">~{coinsSoFar} coins used</p>
                    </div>
                    <button
                      onClick={() => handleForceEnd(call.id)}
                      disabled={isEnding}
                      title="Force end this call"
                      className="p-2 rounded-xl bg-red-50 border border-red-200 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      {isEnding ? (
                        <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <PhoneOff size={14} />
                      )}
                    </button>
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
