import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Save, Rocket, Gift, Zap, Trophy, RotateCcw, Users, Sparkles } from 'lucide-react';

// Every key is persisted by the admin /settings allowlist AND consumed by
// lib/promotions.ts (approveDeposit) + the comeback login hook + referral
// leaderboard. Booleans use '1'/'0'.
const DEFAULTS = {
  // Smart Discount Engine — one personalized, segment-aware offer per user
  smart_discount_enabled: '0',
  smart_discount_welcome_hours: '24',
  smart_discount_welcome_pct: '50',
  smart_discount_first_recharge_pct: '30',
  smart_discount_winback_idle_days: '7',
  smart_discount_winback_pct: '25',
  smart_discount_vip_pct: '15',
  smart_discount_returning_pct: '10',
  smart_discount_max_pct: '100',
  smart_discount_max_coins: '100000',
  smart_discount_ends_at: '0',
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

// Date picker that stores a UNIX-SECONDS string ('0' = no expiry / always on).
// Picking a date means "discount valid THROUGH the end of that day".
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const sec = parseInt(value || '0', 10) || 0;
  const dateStr = sec > 0 ? new Date(sec * 1000).toISOString().slice(0, 10) : '';
  const now = Math.floor(Date.now() / 1000);
  const daysLeft = sec > now ? Math.ceil((sec - now) / 86400) : 0;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={dateStr}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) { onChange('0'); return; }
            // End of the chosen day, in unix seconds.
            const end = Math.floor(new Date(`${v}T23:59:59`).getTime() / 1000);
            onChange(String(end));
          }}
          className="px-3 py-2 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {sec > 0 && (
          <button onClick={() => onChange('0')} className="text-xs text-muted-foreground underline hover:text-foreground">clear</button>
        )}
      </div>
      {sec > 0 && (
        <span className={`text-[11px] ${daysLeft > 0 ? 'text-violet-600' : 'text-red-500'}`}>
          {daysLeft > 0 ? `⏳ ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Campaign ended'}
        </span>
      )}
    </div>
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
          <Section title="✨ Smart Discount Engine" desc="ONE personalized offer per user, chosen automatically by their lifecycle segment. Shown live on checkout and granted as bonus coins on payment. Recommended: use this instead of the flat first-recharge bonus below." icon={Sparkles}>
            <Field label="Enabled" desc="Master switch. When ON, every user sees a tailored offer on the checkout screen.">
              <Toggle value={isOn(config.smart_discount_enabled)} onChange={() => toggle('smart_discount_enabled')} />
            </Field>
            <Field label="⏳ Discount valid until" desc="Whole campaign ends on this date (a live countdown shows on every package). Leave empty = always on.">
              <DateInput value={config.smart_discount_ends_at} onChange={v => update('smart_discount_ends_at', v)} />
            </Field>
            <div className="rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/60 dark:bg-violet-950/20 p-3 text-xs text-violet-700 dark:text-violet-300 space-y-1">
              <p className="font-semibold">How segments are chosen (highest priority first):</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li><strong>Welcome</strong> — brand-new account, still inside the welcome window (time-limited, urgency countdown).</li>
                <li><strong>First recharge</strong> — never purchased, welcome window passed.</li>
                <li><strong>Win-back</strong> — purchased before but idle for N+ days.</li>
                <li><strong>VIP</strong> — active VIP member.</li>
                <li><strong>Loyalty</strong> — everyone else (active recent buyers).</li>
              </ul>
            </div>
            <Field label="🎁 Welcome window" desc="How long after signup the time-limited welcome offer stays live.">
              <NumInput value={config.smart_discount_welcome_hours} onChange={v => update('smart_discount_welcome_hours', v)} min={0} max={720} suffix="hrs" />
            </Field>
            <Field label="🎁 Welcome bonus %" desc="Biggest offer — drives the first purchase fast.">
              <NumInput value={config.smart_discount_welcome_pct} onChange={v => update('smart_discount_welcome_pct', v)} min={0} max={500} suffix="%" />
            </Field>
            <Field label="🚀 First-recharge bonus %" desc="For users past the welcome window who still haven't bought.">
              <NumInput value={config.smart_discount_first_recharge_pct} onChange={v => update('smart_discount_first_recharge_pct', v)} min={0} max={500} suffix="%" />
            </Field>
            <Field label="💜 Win-back idle days" desc="Idle at least this long → win-back offer.">
              <NumInput value={config.smart_discount_winback_idle_days} onChange={v => update('smart_discount_winback_idle_days', v)} min={0} max={365} suffix="days" />
            </Field>
            <Field label="💜 Win-back bonus %"><NumInput value={config.smart_discount_winback_pct} onChange={v => update('smart_discount_winback_pct', v)} min={0} max={500} suffix="%" /></Field>
            <Field label="👑 VIP bonus %" desc="Exclusive perk for active VIP members."><NumInput value={config.smart_discount_vip_pct} onChange={v => update('smart_discount_vip_pct', v)} min={0} max={500} suffix="%" /></Field>
            <Field label="⭐ Loyalty bonus %" desc="Everyday bonus for active returning buyers."><NumInput value={config.smart_discount_returning_pct} onChange={v => update('smart_discount_returning_pct', v)} min={0} max={500} suffix="%" /></Field>
            <Field label="Safety cap %" desc="Hard ceiling on any segment's bonus %."><NumInput value={config.smart_discount_max_pct} onChange={v => update('smart_discount_max_pct', v)} min={0} max={1000} suffix="%" /></Field>
            <Field label="Max bonus coins" desc="Absolute cap on coins granted per recharge."><NumInput value={config.smart_discount_max_coins} onChange={v => update('smart_discount_max_coins', v)} min={0} suffix="coins" /></Field>
          </Section>

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

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Rocket size={13} /> All bonuses are ledgered and apply exactly once per purchase.
          </div>
        </>
      )}
    </div>
  );
}
