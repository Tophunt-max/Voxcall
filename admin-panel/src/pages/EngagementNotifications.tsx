import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Save, Bell, Moon, Gauge, Zap, RotateCcw } from 'lucide-react';

// Every key here is persisted by the api-server admin /settings allowlist AND
// consumed by the engagement engine (lib/engagementNotify.ts + the scheduled
// crons in index.ts). Values are stored as strings; boolean flags use '1'/'0'.
const DEFAULTS = {
  // Global rails
  engagement_notifications_enabled: '1',
  engagement_quiet_start_ist: '23',
  engagement_quiet_end_ist: '8',
  engagement_daily_cap: '3',
  // Per-trigger toggles
  favorite_online_enabled: '1',
  onboarding_drip_enabled: '1',
  abandoned_recharge_enabled: '1',
  low_balance_nudge_enabled: '1',
  weekly_recap_enabled: '1',
  vip_reminder_enabled: '1',
  reengagement_enabled: '1',
  daily_streak_reminder_enabled: '1',
  near_level_nudge_enabled: '1',
  // Re-engagement tuning
  reengagement_idle_days: '3',
  reengagement_winback_days: '7',
  reengagement_cooldown_days: '3',
  reengagement_interval_hours: '6',
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

const TRIGGERS: { key: keyof Config; label: string; desc: string }[] = [
  { key: 'favorite_online_enabled', label: 'Favorite host online', desc: 'Real-time push when a favorited host comes online (highest converting).' },
  { key: 'onboarding_drip_enabled', label: 'Onboarding drip', desc: 'Day 0 / 1 / 3 nudges for users who haven\u2019t made their first call.' },
  { key: 'abandoned_recharge_enabled', label: 'Abandoned recharge', desc: 'Nudge users who started a recharge but never completed it.' },
  { key: 'low_balance_nudge_enabled', label: 'Low balance nudge', desc: 'Recharge reminder after a call when the balance is low.' },
  { key: 'weekly_recap_enabled', label: 'Weekly recap', desc: 'Weekly summary of minutes talked + calls (midday IST).' },
  { key: 'vip_reminder_enabled', label: 'VIP expiry reminder', desc: 'Remind VIP members before their membership expires.' },
  { key: 'reengagement_enabled', label: 'Re-engagement / win-back', desc: 'Bring back idle (3d) and lapsed (7d) users.' },
  { key: 'daily_streak_reminder_enabled', label: 'Daily streak reminder', desc: 'Remind users to check in and keep their streak alive.' },
  { key: 'near_level_nudge_enabled', label: 'Near-level nudge (host)', desc: 'Nudge hosts who are close to their next level.' },
];

export default function EngagementNotifications() {
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
    const startH = parseInt(config.engagement_quiet_start_ist, 10);
    const endH = parseInt(config.engagement_quiet_end_ist, 10);
    if (!Number.isFinite(startH) || startH < 0 || startH > 23 || !Number.isFinite(endH) || endH < 0 || endH > 23) {
      toast.error('Quiet-hours must be between 0 and 23 (IST hour).');
      return;
    }
    const cap = parseInt(config.engagement_daily_cap, 10);
    if (!Number.isFinite(cap) || cap < 0 || cap > 20) {
      toast.error('Daily cap must be between 0 and 20.');
      return;
    }
    setSaving(true);
    try {
      await api.updateSettings(config);
      toast.success('Engagement settings saved');
      setHasChanges(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const masterOn = isOn(config.engagement_notifications_enabled);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Engagement Notifications</h2>
          <p className="text-sm text-muted-foreground">Control automatic engagement pushes, timing and frequency — no deploy needed.</p>
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
          <Section title="Master switch" desc="Turns every engagement notification on or off in one place." icon={Bell}>
            <Field label="Engagement notifications" desc="Master kill switch for all automatic engagement pushes.">
              <Toggle value={masterOn} onChange={() => toggle('engagement_notifications_enabled')} />
            </Field>
          </Section>

          <div className={masterOn ? '' : 'opacity-50 pointer-events-none'}>
            <div className="space-y-5">
              <Section title="Quiet hours & frequency" desc="Global rails so users never get spammed." icon={Moon}>
                <Field label="Quiet hours start (IST)" desc="No engagement pushes from this hour...">
                  <NumInput value={config.engagement_quiet_start_ist} onChange={v => update('engagement_quiet_start_ist', v)} min={0} max={23} suffix=":00" />
                </Field>
                <Field label="Quiet hours end (IST)" desc="...until this hour. Default 23:00 → 08:00.">
                  <NumInput value={config.engagement_quiet_end_ist} onChange={v => update('engagement_quiet_end_ist', v)} min={0} max={23} suffix=":00" />
                </Field>
                <Field label="Daily cap per user" desc="Max engagement notifications a user can receive per 24h.">
                  <NumInput value={config.engagement_daily_cap} onChange={v => update('engagement_daily_cap', v)} min={0} max={20} suffix="/day" />
                </Field>
              </Section>

              <Section title="Triggers" desc="Enable or disable each engagement notification type." icon={Zap}>
                <div className="space-y-4">
                  {TRIGGERS.map(t => (
                    <Field key={t.key} label={t.label} desc={t.desc}>
                      <Toggle value={isOn(config[t.key])} onChange={() => toggle(t.key)} />
                    </Field>
                  ))}
                </div>
              </Section>

              <Section title="Re-engagement tuning" desc="Thresholds for the idle/win-back sweep." icon={RotateCcw}>
                <Field label="Idle after (days)" desc="A user is 'idle' after this many days of no activity.">
                  <NumInput value={config.reengagement_idle_days} onChange={v => update('reengagement_idle_days', v)} min={1} max={60} suffix="days" />
                </Field>
                <Field label="Win-back after (days)" desc="Stronger message once a user is lapsed this long.">
                  <NumInput value={config.reengagement_winback_days} onChange={v => update('reengagement_winback_days', v)} min={1} max={90} suffix="days" />
                </Field>
                <Field label="Cooldown (days)" desc="Minimum gap between re-engagement pushes per user.">
                  <NumInput value={config.reengagement_cooldown_days} onChange={v => update('reengagement_cooldown_days', v)} min={1} max={30} suffix="days" />
                </Field>
                <Field label="Sweep interval (hours)" desc="How often the re-engagement job runs.">
                  <NumInput value={config.reengagement_interval_hours} onChange={v => update('reengagement_interval_hours', v)} min={1} max={24} suffix="hrs" />
                </Field>
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
