import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { RefreshCw, ShieldAlert, Webhook, Coins, CreditCard, Bug } from 'lucide-react';

type Alert = { id: number; user_id: string | null; message: string; context: string; platform: string; app_version: string; created_at: number };
type Summary = { context: string; count: number; last_at: number };

// Context → presentation. Money/integrity contexts are critical (red); anything
// else (client crash reports via /errors) is treated as a warning (amber).
const CONTEXT_META: Record<string, { label: string; icon: any; cls: string; critical: boolean }> = {
  coin_reconciliation: { label: 'Coin drift', icon: Coins, cls: 'text-red-700 bg-red-100', critical: true },
  payment_amount_mismatch: { label: 'Payment mismatch', icon: CreditCard, cls: 'text-red-700 bg-red-100', critical: true },
};
function metaFor(context: string) {
  return CONTEXT_META[context] ?? { label: context || 'error', icon: Bug, cls: 'text-amber-700 bg-amber-100', critical: false };
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [webhookOn, setWebhookOn] = useState(false);
  const [context, setContext] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.alerts(context || undefined)
      .then((d) => { setAlerts(d.alerts ?? []); setSummary(d.summary ?? []); setWebhookOn(!!d.webhook_configured); setErr(''); })
      .catch((e: any) => { console.error('Failed to load alerts:', e); setErr('Failed to load alerts'); })
      .finally(() => setLoading(false));
  }, [context]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><ShieldAlert size={20} className="text-red-600" /> Alerts</h2>
          <p className="text-sm text-muted-foreground">Coin-drift watchdog, payment mismatches & client errors — the events that need an operator.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-xl bg-card hover:bg-accent">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* External delivery status */}
      <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${webhookOn ? 'bg-green-50 text-green-800' : 'bg-muted text-muted-foreground'}`}>
        <Webhook size={16} />
        {webhookOn
          ? 'External alert webhook is configured — critical alerts are also delivered off-dashboard.'
          : 'No alert webhook configured. Set app_settings key "alert_webhook_url" (HTTPS, Slack-compatible) to get paged when nobody is watching.'}
      </div>

      {/* Context rollup (last 24h) — click to filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setContext('')}
          className={`px-3 py-1.5 text-xs rounded-full border ${context === '' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border'}`}
        >
          All
        </button>
        {summary.map((s) => {
          const m = metaFor(s.context);
          return (
            <button
              key={s.context}
              onClick={() => setContext(s.context)}
              className={`px-3 py-1.5 text-xs rounded-full border ${context === s.context ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border'}`}
            >
              {m.label} · {s.count}
            </button>
          );
        })}
      </div>

      {err && <div className="px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">{err}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : alerts.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-16">No alerts 🎉 — nothing needs your attention.</div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => {
            const m = metaFor(a.context);
            const Icon = m.icon;
            return (
              <div key={a.id} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${m.cls}`}><Icon size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>
                    {m.critical && <span className="text-[10px] font-bold uppercase tracking-wide text-red-600">critical</span>}
                    <span className="text-xs text-muted-foreground">{a.platform}</span>
                  </div>
                  <p className="text-sm mt-1 break-words">{a.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(a.created_at * 1000).toLocaleString()}{a.user_id ? ` · user ${a.user_id}` : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
