import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Link } from 'wouter';
import { api } from '@/lib/api';
import { Save, Smartphone, AlertTriangle, Mail, RefreshCw, ArrowRight, Flame, Bell, ShieldAlert, Clock, LayoutList, Zap, Activity } from 'lucide-react';

// IMPORTANT: every key below is one the backend actually persists
// (api-server admin /settings allowlist) AND consumes:
//   - app_*_version_* / app_download_url_* / app_update_*  → GET /api/app/version
//   - maintenance_mode / maintenance_message               → maintenance gate
//   - support_email                                        → app support screen
//
// Economy settings (coin rate, host revenue share, withdrawals) are managed on
// the dedicated Settings page using the canonical keys (coin_to_usd_rate,
// host_revenue_share, min_withdrawal_coins). They are intentionally NOT
// duplicated here — the previous version edited `coin_to_inr_rate` /
// `host_payout_percent`, which the backend silently dropped and which used a
// different representation (percent vs fraction) than billing expects.
const DEFAULTS = {
  app_min_version_user: '0.0.0',
  app_latest_version_user: '0.0.0',
  app_download_url_user: 'https://play.google.com/store',
  app_min_version_host: '0.0.0',
  app_latest_version_host: '0.0.0',
  app_download_url_host: 'https://play.google.com/store',
  app_update_block_message: 'Please update to the latest version to continue.',
  app_update_recommend_message: 'A new version is available with improvements.',
  maintenance_mode: 'false',
  maintenance_message: 'We are performing scheduled maintenance. Back in 30 minutes.',
  support_email: 'support@voxlink.app',
  // Host engagement (daily streak) + level-up mystery-box + near-level nudge.
  host_streak_enabled: '1',
  host_streak_schedule: '[0,10,15,20,30,50,75]',
  host_streak_milestones: '{"7":100,"14":250,"30":1000,"60":3000,"100":10000}',
  level_reward_bonus_max_pct: '50',
  near_level_nudge_enabled: '1',
  near_level_nudge_hour_ist: '19',
  near_level_nudge_threshold: '80',
  // ── Smart-engines v2 (all DEFAULT OFF — pure admin opt-in). Advanced JSON
  //    weight blobs (risk_weights / instant_connect_weights / etc.) are tuned
  //    via the API, not this page; here we expose the on/off + key params.
  risk_scoring_enabled: '0',
  risk_lookback_days: '30',
  risk_velocity_burst: '4',
  risk_new_account_days: '3',
  availability_predict_enabled: '0',
  availability_predict_lookback_days: '30',
  availability_predict_threshold: '0.5',
  rail_order_enabled: '0',
  instant_connect_enabled: '0',
  instant_connect_max_wait_seconds: '300',
  quality_router_enabled: '0',
  quality_host_max_penalty: '0.3',
};

type Config = typeof DEFAULTS;

const Section = ({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) => (
  <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
    <div className="flex items-center gap-2 pb-2 border-b border-border">
      <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
        <Icon size={15} className="text-violet-600" />
      </div>
      <h3 className="font-bold text-base">{title}</h3>
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
    <button onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-border'}`}>
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Input({ value, onChange, type = 'text' }: { value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex items-center border border-border rounded-xl overflow-hidden bg-background w-56">
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="flex-1 px-3 py-2 text-sm bg-transparent focus:outline-none min-w-0 w-full" />
    </div>
  );
}

export default function AppConfig() {
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    api.settings().then(data => {
      if (data && Object.keys(data).length > 0) {
        // Only hydrate keys this page manages; everything is stored as strings.
        const next: Partial<Config> = {};
        (Object.keys(DEFAULTS) as (keyof Config)[]).forEach(k => {
          if (data[k] !== undefined && data[k] !== null) next[k] = String(data[k]);
        });
        setConfig(prev => ({ ...prev, ...next }));
      }
    }).catch(() => {});
  }, []);

  const update = (key: keyof Config, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const save = async () => {
    // Validate the JSON-shaped engagement fields before persisting, so a typo
    // can't silently fall back to defaults on the backend.
    try {
      const sched = JSON.parse(config.host_streak_schedule);
      if (!Array.isArray(sched) || sched.some((n) => typeof n !== 'number' || n < 0)) throw new Error();
    } catch {
      toast.error('Streak daily rewards must be a JSON array of numbers, e.g. [0,10,20]');
      return;
    }
    try {
      const ms = JSON.parse(config.host_streak_milestones);
      if (typeof ms !== 'object' || ms === null || Array.isArray(ms)) throw new Error();
    } catch {
      toast.error('Streak milestones must be a JSON object, e.g. {"7":100,"30":1000}');
      return;
    }
    setSaving(true);
    try {
      await api.updateSettings(config);
      toast.success('Configuration saved successfully');
      setHasChanges(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const maintenanceOn = config.maintenance_mode === 'true';

  return (
    <div className="space-y-5">

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">App Configuration</h2>
          <p className="text-sm text-muted-foreground">Manage app-wide settings without a code deploy</p>
        </div>
        <button onClick={save} disabled={saving || !hasChanges}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {maintenanceOn && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-amber-700">Maintenance mode is ON — app is inaccessible to users</p>
        </div>
      )}

      {/* Economy is managed on the dedicated Settings page (canonical keys). */}
      <Link href="/settings" className="flex items-center justify-between gap-3 p-4 bg-violet-50 border border-violet-200 rounded-xl hover:bg-violet-100 transition-colors">
        <p className="text-sm text-violet-700">
          <span className="font-semibold">Coins &amp; Economy</span> (coin rate, host revenue share, minimum withdrawal) are managed on the Settings page.
        </p>
        <ArrowRight size={18} className="text-violet-600 flex-shrink-0" />
      </Link>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Section title="User App — Version Gate" icon={Smartphone}>
          <Field label="Minimum Supported Version" desc="Users below this are force-blocked until they update">
            <Input value={config.app_min_version_user} onChange={v => update('app_min_version_user', v)} />
          </Field>
          <Field label="Latest Stable Version" desc="Users below this get a non-blocking update nudge">
            <Input value={config.app_latest_version_user} onChange={v => update('app_latest_version_user', v)} />
          </Field>
          <Field label="Download URL" desc="Where the update CTA sends users">
            <Input value={config.app_download_url_user} onChange={v => update('app_download_url_user', v)} />
          </Field>
        </Section>

        <Section title="Host App — Version Gate" icon={Smartphone}>
          <Field label="Minimum Supported Version" desc="Hosts below this are force-blocked until they update">
            <Input value={config.app_min_version_host} onChange={v => update('app_min_version_host', v)} />
          </Field>
          <Field label="Latest Stable Version" desc="Hosts below this get a non-blocking update nudge">
            <Input value={config.app_latest_version_host} onChange={v => update('app_latest_version_host', v)} />
          </Field>
          <Field label="Download URL" desc="Where the update CTA sends hosts">
            <Input value={config.app_download_url_host} onChange={v => update('app_download_url_host', v)} />
          </Field>
        </Section>

        <Section title="Update Messages" icon={AlertTriangle}>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Force-Update (blocking) Message</label>
            <textarea rows={2} value={config.app_update_block_message} onChange={e => update('app_update_block_message', e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none resize-none" />
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Recommended-Update (nudge) Message</label>
            <textarea rows={2} value={config.app_update_recommend_message} onChange={e => update('app_update_recommend_message', e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none resize-none" />
          </div>
        </Section>

        <Section title="Host Engagement — Daily Streak & Rewards" icon={Flame}>
          <Field label="Daily Streak" desc="Reward hosts for coming online each day">
            <Toggle value={config.host_streak_enabled !== '0'} onChange={v => update('host_streak_enabled', v ? '1' : '0')} />
          </Field>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Daily rewards (cycle)</label>
            <Input value={config.host_streak_schedule} onChange={v => update('host_streak_schedule', v)} />
            <p className="text-xs text-muted-foreground mt-1">JSON array of coins per streak day, repeating. e.g. <code>[0,10,15,20,30,50,75]</code></p>
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Milestone bonuses</label>
            <textarea rows={2} value={config.host_streak_milestones} onChange={e => update('host_streak_milestones', e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none resize-none font-mono" />
            <p className="text-xs text-muted-foreground mt-1">One-time bonus at streak day → coins. e.g. <code>{'{"7":100,"30":1000}'}</code></p>
          </div>
          <Field label="Level-up mystery bonus (max %)" desc="Extra random coins on top of a level's reward (0 = off)">
            <Input type="number" value={config.level_reward_bonus_max_pct} onChange={v => update('level_reward_bonus_max_pct', v)} />
          </Field>
        </Section>

        <Section title="Near-Level Push Nudge" icon={Bell}>
          <Field label="Enabled" desc="Daily push to hosts close to their next level">
            <Toggle value={config.near_level_nudge_enabled !== '0'} onChange={v => update('near_level_nudge_enabled', v ? '1' : '0')} />
          </Field>
          <Field label="Send hour (IST, 0–23)" desc="Hour of day the nudge is sent">
            <Input type="number" value={config.near_level_nudge_hour_ist} onChange={v => update('near_level_nudge_hour_ist', v)} />
          </Field>
          <Field label="Trigger at progress (%)" desc="Push hosts at or above this % to next level (50–99)">
            <Input type="number" value={config.near_level_nudge_threshold} onChange={v => update('near_level_nudge_threshold', v)} />
          </Field>
        </Section>

        <Section title="Smart Instant-Connect" icon={Zap}>
          <Field label="Enabled" desc="'Talk Now' connects to the best host for each user (affinity + quality + fair load). Off = normal flow.">
            <Toggle value={config.instant_connect_enabled !== '0'} onChange={v => update('instant_connect_enabled', v ? '1' : '0')} />
          </Field>
          <Field label="Max wait estimate (seconds)" desc="Cap on the 'usually ~N min' ETA shown when all hosts are busy">
            <Input type="number" value={config.instant_connect_max_wait_seconds} onChange={v => update('instant_connect_max_wait_seconds', v)} />
          </Field>
        </Section>

        <Section title="Availability Prediction" icon={Clock}>
          <Field label="Enabled" desc="Shows a data-driven 'Usually online now / around 8 PM' hint (a probability, never a false 'live')">
            <Toggle value={config.availability_predict_enabled !== '0'} onChange={v => update('availability_predict_enabled', v ? '1' : '0')} />
          </Field>
          <Field label="History window (days)" desc="How many days of activity to learn each host's online pattern from">
            <Input type="number" value={config.availability_predict_lookback_days} onChange={v => update('availability_predict_lookback_days', v)} />
          </Field>
          <Field label="'Usually online' threshold (0–1)" desc="P(active) at/above which we say a host is usually online now">
            <Input type="number" value={config.availability_predict_threshold} onChange={v => update('availability_predict_threshold', v)} />
          </Field>
        </Section>

        <Section title="Personalized Home Rails" icon={LayoutList}>
          <Field label="Enabled" desc="Reorder the home rails per user from their own tap history. Off = static order for everyone.">
            <Toggle value={config.rail_order_enabled !== '0'} onChange={v => update('rail_order_enabled', v ? '1' : '0')} />
          </Field>
        </Section>

        <Section title="Session Quality Auto-Router" icon={Activity}>
          <Field label="Enabled" desc="Recommend graceful video→audio downgrade on bad networks + softly demote consistently poor-quality hosts">
            <Toggle value={config.quality_router_enabled !== '0'} onChange={v => update('quality_router_enabled', v ? '1' : '0')} />
          </Field>
          <Field label="Max host ranking penalty (0–1)" desc="Upper bound on how much a poor-quality host is demoted in discovery">
            <Input type="number" value={config.quality_host_max_penalty} onChange={v => update('quality_host_max_penalty', v)} />
          </Field>
        </Section>

        <Section title="Fraud / Abuse Risk Scoring" icon={ShieldAlert}>
          <Field label="Enabled" desc="Score users on recharge/refund/decline patterns for the Risk view. Off = no scoring, no throttling.">
            <Toggle value={config.risk_scoring_enabled !== '0'} onChange={v => update('risk_scoring_enabled', v ? '1' : '0')} />
          </Field>
          <Field label="Lookback window (days)" desc="History window used to gather risk signals">
            <Input type="number" value={config.risk_lookback_days} onChange={v => update('risk_lookback_days', v)} />
          </Field>
          <Field label="Recharge burst count" desc="Purchases within 1h that saturate the velocity signal (card-testing pattern)">
            <Input type="number" value={config.risk_velocity_burst} onChange={v => update('risk_velocity_burst', v)} />
          </Field>
          <Field label="New-account window (days)" desc="Big spend within this many days of signup flags promo/bonus abuse">
            <Input type="number" value={config.risk_new_account_days} onChange={v => update('risk_new_account_days', v)} />
          </Field>
        </Section>

        <Section title="Maintenance & Support" icon={Mail}>
          <Field label="Maintenance Mode" desc="Show maintenance screen to all users">
            <Toggle value={maintenanceOn} onChange={v => update('maintenance_mode', v ? 'true' : 'false')} />
          </Field>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Maintenance Message</label>
            <textarea rows={3} value={config.maintenance_message} onChange={e => update('maintenance_message', e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none resize-none" />
          </div>
          <Field label="Support Email" desc="Shown in app for user support">
            <Input value={config.support_email} onChange={v => update('support_email', v)} />
          </Field>
        </Section>
      </div>

      {hasChanges && (
        <div className="sticky bottom-4 flex justify-center">
          <div className="bg-foreground text-background text-sm px-5 py-3 rounded-full shadow-xl flex items-center gap-3">
            <span>You have unsaved changes</span>
            <button onClick={save} className="bg-white text-black px-4 py-1.5 rounded-full text-xs font-bold hover:opacity-90">
              {saving ? 'Saving...' : 'Save Now'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
