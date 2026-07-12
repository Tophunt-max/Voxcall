import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Save, Rocket, Gift, Zap, Trophy, RotateCcw, Users, Clock, TrendingDown, Star, Signal } from 'lucide-react';

// Every key is persisted by the admin /settings allowlist AND consumed by
// lib/promotions.ts (approveDeposit) + the comeback login hook + referral
// leaderboard. Booleans use '1'/'0'.
const DEFAULTS = {
  // First-recharge bonus
  first_recharge_bonus_enabled: '0',
  first_recharge_bonus_pct: '100',
  first_recharge_bonus_max_coins: '500',
  // Happy Hour
  happy_hour_enabled: '0',
  happy_hour_start_ist: '20',
  happy_hour_end_ist: '23',
  happy_hour_bonus_pct: '20',
  happy_hour_max_coins: '1000',
  // Spend-milestone cashback
  spend_cashback_enabled: '0',
  spend_milestones: '{"1000":100,"5000":600,"10000":1500}',
  // Comeback reward
  comeback_reward_enabled: '0',
  comeback_idle_days: '7',
  comeback_bonus_coins: '50',
  comeback_cooldown_days: '30',
  // Referral contest
  referral_contest_enabled: '0',
  // ── Smart Engines suite ──────────────────────────────────────────────────
  // Best-Time-To-Notify
  smart_timing_enabled: '0',
  smart_timing_window_hours: '2',
  smart_timing_lookback_days: '21',
  // Churn Prediction
  churn_prediction_enabled: '0',
  churn_horizon_days: '30',
  churn_high_threshold: '0.7',
  churn_medium_threshold: '0.4',
  // Dynamic host ranking — performance (conversion) weight
  reco_performance_weight: '0.5',
  // Smart call-quality routing
  smart_call_quality_enabled: '0',
  smart_call_quality_samples: '20',
};

type Config = typeof DEFAULTS;
const isOn = (v: string | undefined) => v != null && v !== '0' && v.toLowerCase() !== 'false';

const Section = ({ title, desc, icon: Icon, children }: { title: string; desc?: string; icon: any; children: React.ReactNode }) => (
  <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
    <div className="flex items-center gap-2 pb-2 border-b border-border">
      <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
        <Icon size={15} className="text-violet-600" />
      </div>
      <div>
        <h3 className="font-bold text-base">{title}</h3>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
    </div>
    {children}
  </div>
);

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} aria-pressed={value}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-border'}`}>
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function NumInput({ value, onChange, min, max, suffix }: { value: string; onChange: (v: string) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="flex items-center border border-border rounded-xl overflow-hidden bg-background w-32">
      <input type="number" min={min} max={max} value={value} onChange={e => onChange(e.target.value)}
        className="flex-1 px-3 py-2 text-sm bg-transparent focus:outline-none min-w-0 w-full" />
      {suffix && <span className="px-2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export default function GrowthPromotions() {
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.settings().then(data => {
      if (data && Object.keys(data).length > 0) {
        const next: Partial<Config> = {};
        (Object.keys(DEFAULTS) as (keyof Config)[]).forEach(k => {
          if (data[k] !== undefined && data[k] !== null) next[k] = String(data[k]);
        });
        setConfig(prev => ({ ...prev, ...next }));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const update = (key: keyof Config, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };
  const toggle = (key: keyof Config) => update(key, isOn(config[key]) ? '0' : '1');

  const save = async () => {
    try {
      const tiers = JSON.parse(config.spend_milestones);
      if (typeof tiers !== 'object' || tiers === null || Array.isArray(tiers)) throw new Error();
      for (const [k, v] of Object.entries(tiers)) {
        if (!Number.isFinite(Number(k)) || !Number.isFinite(Number(v))) throw new Error();
      }
    } catch {
      toast.error('Spend milestones must be JSON like {"1000":100,"5000":600}');
      return;
    }
    setSaving(true);
    try {
      await api.updateSettings(config);
      toast.success('Growth settings saved');
      setHasChanges(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Growth & Promotions</h2>
          <p className="text-sm text-muted-foreground">Bonuses and win-back rewards that boost conversion and retention — no deploy needed.</p>
        </div>
        <button onClick={save} disabled={saving || !hasChanges}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Save size={15} /> {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          <Section title="First-recharge bonus" desc="Extra coins on a user's very first purchase — big conversion lever." icon={Gift}>
            <Field label="Enabled"><Toggle value={isOn(config.first_recharge_bonus_enabled)} onChange={() => toggle('first_recharge_bonus_enabled')} /></Field>
            <Field label="Bonus %" desc="Extra coins as % of the purchase (100 = double).">
              <NumInput value={config.first_recharge_bonus_pct} onChange={v => update('first_recharge_bonus_pct', v)} min={0} max={500} suffix="%" />
            </Field>
            <Field label="Max bonus coins" desc="Cap on the first-recharge bonus.">
              <NumInput value={config.first_recharge_bonus_max_coins} onChange={v => update('first_recharge_bonus_max_coins', v)} min={0} suffix="coins" />
            </Field>
          </Section>

          <Section title="Happy Hour" desc="Time-boxed bonus coins on every purchase during a daily window (IST)." icon={Zap}>
            <Field label="Enabled"><Toggle value={isOn(config.happy_hour_enabled)} onChange={() => toggle('happy_hour_enabled')} /></Field>
            <Field label="Start (IST)"><NumInput value={config.happy_hour_start_ist} onChange={v => update('happy_hour_start_ist', v)} min={0} max={23} suffix=":00" /></Field>
            <Field label="End (IST)"><NumInput value={config.happy_hour_end_ist} onChange={v => update('happy_hour_end_ist', v)} min={0} max={23} suffix=":00" /></Field>
            <Field label="Bonus %" desc="Extra coins during Happy Hour."><NumInput value={config.happy_hour_bonus_pct} onChange={v => update('happy_hour_bonus_pct', v)} min={0} max={500} suffix="%" /></Field>
            <Field label="Max bonus coins"><NumInput value={config.happy_hour_max_coins} onChange={v => update('happy_hour_max_coins', v)} min={0} suffix="coins" /></Field>
          </Section>

          <Section title="Spend-milestone cashback" desc="One-time cashback when a user's lifetime purchased coins cross a milestone." icon={Trophy}>
            <Field label="Enabled"><Toggle value={isOn(config.spend_cashback_enabled)} onChange={() => toggle('spend_cashback_enabled')} /></Field>
            <div>
              <p className="text-sm font-semibold mb-1.5">Milestones (JSON)</p>
              <p className="text-xs text-muted-foreground mb-2">{'{ "lifetime_coins": cashback_coins }'} — e.g. {'{"1000":100,"5000":600}'}</p>
              <textarea rows={3} value={config.spend_milestones} onChange={e => update('spend_milestones', e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
            </div>
          </Section>

          <Section title="Comeback reward" desc="One-time bonus coins for lapsed users when they return (on Quick Login)." icon={RotateCcw}>
            <Field label="Enabled"><Toggle value={isOn(config.comeback_reward_enabled)} onChange={() => toggle('comeback_reward_enabled')} /></Field>
            <Field label="Idle threshold" desc="User must have been away at least this long."><NumInput value={config.comeback_idle_days} onChange={v => update('comeback_idle_days', v)} min={1} max={90} suffix="days" /></Field>
            <Field label="Bonus coins"><NumInput value={config.comeback_bonus_coins} onChange={v => update('comeback_bonus_coins', v)} min={0} suffix="coins" /></Field>
            <Field label="Cooldown" desc="Minimum gap between comeback rewards per user."><NumInput value={config.comeback_cooldown_days} onChange={v => update('comeback_cooldown_days', v)} min={1} max={365} suffix="days" /></Field>
          </Section>

          <Section title="Referral contest" desc="Show a referral leaderboard in the app to gamify inviting friends." icon={Users}>
            <Field label="Enabled" desc="Exposes the top-referrers leaderboard (GET /api/user/referral-leaderboard).">
              <Toggle value={isOn(config.referral_contest_enabled)} onChange={() => toggle('referral_contest_enabled')} />
            </Field>
          </Section>

          <Section title="⏰ Best-Time-To-Notify" desc="Learn each user's most-active hour and deliver engagement nudges near it (better open rates, less annoyance). A daily job computes the active hour from calls + opened notifications." icon={Clock}>
            <Field label="Enabled" desc="When ON, engagement nudges are held until the user's active window.">
              <Toggle value={isOn(config.smart_timing_enabled)} onChange={() => toggle('smart_timing_enabled')} />
            </Field>
            <Field label="Window" desc="Deliver within ±this many hours of the user's peak active hour.">
              <NumInput value={config.smart_timing_window_hours} onChange={v => update('smart_timing_window_hours', v)} min={0} max={12} suffix="hrs" />
            </Field>
            <Field label="Lookback" desc="Days of activity history used to learn the active hour.">
              <NumInput value={config.smart_timing_lookback_days} onChange={v => update('smart_timing_lookback_days', v)} min={1} max={90} suffix="days" />
            </Field>
          </Section>

          <Section title="📉 Churn Prediction" desc="Daily per-user churn-risk score (recency + call-frequency decline). View the breakdown on the dashboard and prioritize win-backs. Read-only — never messages users or moves coins." icon={TrendingDown}>
            <Field label="Enabled" desc="When ON, a daily job scores every active user's churn risk.">
              <Toggle value={isOn(config.churn_prediction_enabled)} onChange={() => toggle('churn_prediction_enabled')} />
            </Field>
            <Field label="Churn horizon" desc="Idle this many days ⇒ maximum recency risk.">
              <NumInput value={config.churn_horizon_days} onChange={v => update('churn_horizon_days', v)} min={1} max={180} suffix="days" />
            </Field>
            <Field label="High-risk threshold" desc="Risk ≥ this → 'high' tier (0–1).">
              <NumInput value={config.churn_high_threshold} onChange={v => update('churn_high_threshold', v)} min={0} max={1} />
            </Field>
            <Field label="Medium-risk threshold" desc="Risk ≥ this → 'medium' tier (0–1).">
              <NumInput value={config.churn_medium_threshold} onChange={v => update('churn_medium_threshold', v)} min={0} max={1} />
            </Field>
          </Section>

          <Section title="⭐ Dynamic Host Ranking" desc="Blend recent CONVERSION performance (how often surfacing a host led to a call) into the personalized recommendations. Higher weight = performing hosts surface more." icon={Star}>
            <Field label="Performance weight" desc="0 = ignore performance. Confidence-shrunk so low-traffic hosts aren't over-rated.">
              <NumInput value={config.reco_performance_weight} onChange={v => update('reco_performance_weight', v)} min={0} max={5} />
            </Field>
          </Section>

          <Section title="📶 Smart Call-Quality Routing" desc="Start each user's video at a tier learned from their recent network history, so chronically-poor connections don't freeze on connect. Live adaptation still takes over after connect." icon={Signal}>
            <Field label="Enabled" desc="OFF = always start at top quality (legacy).">
              <Toggle value={isOn(config.smart_call_quality_enabled)} onChange={() => toggle('smart_call_quality_enabled')} />
            </Field>
            <Field label="Samples" desc="How many recent quality samples to average per user.">
              <NumInput value={config.smart_call_quality_samples} onChange={v => update('smart_call_quality_samples', v)} min={3} max={200} />
            </Field>
          </Section>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Rocket size={13} /> All bonuses are ledgered and apply exactly once per purchase.
          </div>
        </>
      )}
    </div>
  );
}
