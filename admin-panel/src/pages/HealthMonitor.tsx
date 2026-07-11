import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Database, Globe,
  HardDrive, HeartPulse, Phone, Radio, Server, Shield, Users, Wifi, XCircle, Zap,
} from 'lucide-react';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Area, AreaChart, ComposedChart, Bar,
} from 'recharts';

// ============================================================================
// Health Monitor — Production-grade uptime & service health dashboard
// ============================================================================
// Shows:
//   1. Live service status (D1, R2, Agora, FCM, Email) with latency
//   2. Uptime percentages (1h / 24h / 7d)
//   3. 24-hour status timeline bar
//   4. Latency timeseries chart (last hour)
//   5. Active operations (calls, hosts online)
//   6. Recent incidents log
// Polls every 30 seconds for real-time monitoring.
// ============================================================================

const STATUS_CONFIG = {
  ok: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-200 dark:border-green-800', label: 'Operational' },
  degraded: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800', label: 'Degraded' },
  down: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', label: 'Down' },
  unconfigured: { icon: AlertTriangle, color: 'text-gray-500', bg: 'bg-gray-50 dark:bg-gray-900/30', border: 'border-gray-200 dark:border-gray-700', label: 'Not Configured' },
  error: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', label: 'Error' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.ok;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function UptimeBar({ value }: { value: number }) {
  const color = value >= 99.9 ? 'bg-green-500' : value >= 99 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className={`text-sm font-bold ${value >= 99.9 ? 'text-green-600' : value >= 99 ? 'text-amber-600' : 'text-red-600'}`}>
        {value.toFixed(2)}%
      </span>
    </div>
  );
}

function StatusTimeline({ data }: { data: any[] }) {
  if (!data.length) return <p className="text-xs text-muted-foreground">No data yet — health checks start after first cron run.</p>;
  return (
    <div className="flex gap-0.5 h-8 items-end">
      {data.map((d, i) => {
        const color = d.status === 'down' ? 'bg-red-500' : d.status === 'degraded' ? 'bg-amber-400' : 'bg-green-500';
        const hour = new Date(d.hour_ts * 1000).getHours();
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${hour}:00 — ${d.status} (${d.checks} checks, avg ${d.avg_db_ms}ms)`}>
            <div className={`w-full h-6 rounded-sm ${color} opacity-80 hover:opacity-100 transition-opacity cursor-default`} />
            {i % 4 === 0 && <span className="text-[9px] text-muted-foreground">{hour}h</span>}
          </div>
        );
      })}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const time = new Date(label * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
      <p className="font-semibold mb-1">{time}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <strong>{Math.round(p.value)}ms</strong>
        </p>
      ))}
    </div>
  );
};

export default function HealthMonitor() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['health-full'],
    queryFn: () => api.healthFull(),
    refetchInterval: 30_000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <HeartPulse className="w-10 h-10 text-primary animate-pulse" />
          <p className="text-muted-foreground">Running health probes...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <XCircle className="w-10 h-10 text-red-500" />
          <p className="text-red-600 font-medium">Health check failed</p>
          <p className="text-sm text-muted-foreground">{(error as any)?.message ?? 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  const { live, uptime, latency, incidents, status_timeline } = data;
  const lastUpdate = new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const overallCfg = STATUS_CONFIG[live.overall_status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.ok;
  const OverallIcon = overallCfg.icon;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HeartPulse className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Health Monitor</h1>
            <p className="text-sm text-muted-foreground">Real-time service health &amp; uptime tracking</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Updated: {lastUpdate}</span>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${overallCfg.border} ${overallCfg.bg}`}>
            <OverallIcon className={`w-4 h-4 ${overallCfg.color}`} />
            <span className={`font-semibold text-sm ${overallCfg.color}`}>
              {live.overall_status === 'ok' ? 'All Systems Operational' : live.overall_status === 'degraded' ? 'Partial Degradation' : 'Service Outage'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Uptime Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Last 1 Hour', data: uptime['1h'] },
          { label: 'Last 24 Hours', data: uptime['24h'] },
          { label: 'Last 7 Days', data: uptime['7d'] },
        ].map(({ label, data: u }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">{label}</span>
              <Shield className="w-4 h-4 text-muted-foreground" />
            </div>
            <UptimeBar value={u.uptime_pct} />
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>{u.total_checks} checks</span>
              <span>{u.down_checks > 0 ? `${u.down_checks} outage(s)` : 'No outages'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 24h Status Timeline ────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">24-Hour Status Timeline</h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> OK</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Degraded</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Down</span>
          </div>
        </div>
        <StatusTimeline data={status_timeline} />
      </div>

      {/* ── Service Status Grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ServiceCard icon={Database} name="Database (D1)" status={live.db_status} latency={live.db_latency_ms} avgLatency={latency.avg.db_ms} />
        <ServiceCard icon={HardDrive} name="Storage (R2)" status={live.r2_status} latency={live.r2_latency_ms} avgLatency={latency.avg.r2_ms} />
        <ServiceCard icon={Phone} name="Voice/Video (Agora)" status={live.agora_status} />
        <ServiceCard icon={Radio} name="Push Notifications (FCM)" status={live.fcm_status} />
        <ServiceCard icon={Globe} name="Email (Resend)" status={live.email_status} />
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">Cron Scheduler</span>
            </div>
            <StatusBadge status={live.cron_age_sec < 120 ? 'ok' : live.cron_age_sec < 300 ? 'degraded' : 'down'} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Last run: {live.cron_age_sec < 120 ? `${live.cron_age_sec}s ago` : live.cron_age_sec < 3600 ? `${Math.floor(live.cron_age_sec / 60)}m ago` : 'Unknown'}
          </p>
        </div>
      </div>

      {/* ── Live Operations ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard icon={Zap} label="Active Calls" value={live.active_calls} color="text-purple-600" />
        <MetricCard icon={Users} label="Hosts Online" value={live.online_hosts} color="text-blue-600" />
        <MetricCard icon={AlertTriangle} label="Errors (1h)" value={live.error_count_hour} color={live.error_count_hour > 20 ? 'text-red-600' : 'text-green-600'} />
        <MetricCard icon={Activity} label="Avg DB Latency" value={`${latency.avg.db_ms}ms`} color={latency.avg.db_ms > 100 ? 'text-amber-600' : 'text-green-600'} />
      </div>

      {/* ── Latency Chart ──────────────────────────────────────────────── */}
      {latency.timeseries.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3">Latency (Last Hour)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={latency.timeseries}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="checked_at" tickFormatter={(t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} className="text-xs" />
              <YAxis unit="ms" className="text-xs" />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="db_latency_ms" name="D1" stroke="#7C3AED" fill="#7C3AED" fillOpacity={0.1} strokeWidth={2} />
              <Area type="monotone" dataKey="r2_latency_ms" name="R2" stroke="#06B6D4" fill="#06B6D4" fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Active Calls & Hosts Chart ─────────────────────────────────── */}
      {latency.timeseries.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3">Active Operations (Last Hour)</h3>
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={latency.timeseries}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="checked_at" tickFormatter={(t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="active_calls" name="Active Calls" fill="#7C3AED" opacity={0.7} radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="online_hosts" name="Hosts Online" stroke="#10B981" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Recent Incidents ───────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold text-sm mb-3">Recent Incidents (24h)</h3>
        {incidents.length === 0 ? (
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            <span>No incidents in the last 24 hours</span>
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {incidents.slice(0, 20).map((inc: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs p-2 rounded-lg bg-muted/50">
                <span className="text-muted-foreground whitespace-nowrap">
                  {new Date(inc.checked_at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <StatusBadge status={inc.overall_status} />
                <span className="text-muted-foreground">
                  {inc.db_status === 'error' && 'DB error · '}
                  {inc.r2_status === 'error' && 'R2 error · '}
                  {inc.agora_status === 'error' && 'Agora error · '}
                  {inc.fcm_status === 'error' && 'FCM error · '}
                  {inc.error_count_hour > 0 && `${inc.error_count_hour} API errors`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable Components ─────────────────────────────────────────────────────

function ServiceCard({ icon: Icon, name, status, latency, avgLatency }: {
  icon: any; name: string; status: string; latency?: number; avgLatency?: number;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{name}</span>
        </div>
        <StatusBadge status={status} />
      </div>
      {latency !== undefined && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span>Current: <strong className={latency > 200 ? 'text-amber-600' : 'text-foreground'}>{latency >= 0 ? `${latency}ms` : 'N/A'}</strong></span>
          {avgLatency !== undefined && <span>Avg (1h): <strong>{avgLatency}ms</strong></span>}
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 text-center">
      <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
      <div className={`text-xl font-bold ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
