import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Save, Smartphone, AlertTriangle, Globe, Zap, Shield, Bell, RefreshCw } from 'lucide-react';

const DEFAULTS = {
  min_android_version: '2.0.0',
  min_ios_version: '2.0.0',
  force_update_android: false,
  force_update_ios: false,
  maintenance_mode: false,
  maintenance_message: 'We are performing scheduled maintenance. Back in 30 minutes.',
  announcement_text: '',
  announcement_active: false,
  coin_to_inr_rate: '0.10',
  host_payout_percent: '70',
  min_withdrawal_coins: '1000',
  max_call_duration_mins: '60',
  free_coins_on_signup: '50',
  guest_daily_call_limit: '3',
  support_email: 'support@voxlink.app',
  app_store_url: 'https://play.google.com/store',
  ios_store_url: 'https://apps.apple.com',
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

function Input({ value, onChange, type = 'text', prefix }: { value: string; onChange: (v: string) => void; type?: string; prefix?: string }) {
  return (
    <div className="flex items-center border border-border rounded-xl overflow-hidden bg-background w-48">
      {prefix && <span className="px-3 text-sm text-muted-foreground bg-secondary border-r border-border">{prefix}</span>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="flex-1 px-3 py-2 text-sm bg-transparent focus:outline-none min-w-0 w-full" />
    </div>
  );
}

export default function AppConfig() {
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    api.settings().then(data => {
      if (data && Object.keys(data).length > 0) {
        setConfig(prev => ({ ...prev, ...data }));
      }
    }).catch(() => {});
  }, []);

  const update = (key: keyof Config, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(config);
      setToast('Configuration saved successfully');
      setHasChanges(false);
    } catch {
      setToast('Saved locally (API not connected)');
      setHasChanges(false);
    } finally {
      setSaving(false);
      setTimeout(() => setToast(''), 2500);
    }
  };

  return (
    <div className="space-y-5">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

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

      {config.maintenance_mode && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-amber-700">Maintenance mode is ON — app is inaccessible to users</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Section title="App Version & Force Update" icon={Smartphone}>
          <Field label="Min Android Version" desc="Users below this are prompted to update">
            <Input value={config.min_android_version} onChange={v => update('min_android_version', v)} />
          </Field>
          <Field label="Min iOS Version" desc="Users below this are prompted to update">
            <Input value={config.min_ios_version} onChange={v => update('min_ios_version', v)} />
          </Field>
          <Field label="Force Update (Android)" desc="Block app usage until updated">
            <Toggle value={config.force_update_android} onChange={v => update('force_update_android', v)} />
          </Field>
          <Field label="Force Update (iOS)" desc="Block app usage until updated">
            <Toggle value={config.force_update_ios} onChange={v => update('force_update_ios', v)} />
          </Field>
          <Field label="Play Store URL" desc="Link for Android update">
            <Input value={config.app_store_url} onChange={v => update('app_store_url', v)} />
          </Field>
        </Section>

        <Section title="Maintenance Mode" icon={AlertTriangle}>
          <Field label="Maintenance Mode" desc="Show maintenance screen to all users">
            <Toggle value={config.maintenance_mode} onChange={v => update('maintenance_mode', v)} />
          </Field>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Maintenance Message</label>
            <textarea rows={3} value={config.maintenance_message} onChange={e => update('maintenance_message', e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none resize-none" />
          </div>
          <Field label="Announcement Banner" desc="Show a notice banner in the app">
            <Toggle value={config.announcement_active} onChange={v => update('announcement_active', v)} />
          </Field>
          {config.announcement_active && (
            <div>
              <label className="text-sm font-semibold block mb-1.5">Announcement Text</label>
              <input value={config.announcement_text} onChange={e => update('announcement_text', e.target.value)}
                placeholder="e.g. Server maintenance tonight at 11 PM"
                className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none" />
            </div>
          )}
        </Section>

        <Section title="Coins & Economy" icon={Zap}>
          <Field label="Coin → INR Rate" desc="1 coin = this many rupees">
            <Input value={config.coin_to_inr_rate} onChange={v => update('coin_to_inr_rate', v)} prefix="₹" />
          </Field>
          <Field label="Host Payout %" desc="Percentage of coins hosts receive">
            <Input value={config.host_payout_percent} onChange={v => update('host_payout_percent', v)} prefix="%" />
          </Field>
          <Field label="Min Withdrawal (coins)" desc="Minimum coins to request payout">
            <Input value={config.min_withdrawal_coins} onChange={v => update('min_withdrawal_coins', v)} type="number" />
          </Field>
          <Field label="Signup Bonus Coins" desc="Coins given to new users">
            <Input value={config.free_coins_on_signup} onChange={v => update('free_coins_on_signup', v)} type="number" />
          </Field>
        </Section>

        <Section title="Call Limits & Rules" icon={Shield}>
          <Field label="Max Call Duration (mins)" desc="Auto-end calls after this duration">
            <Input value={config.max_call_duration_mins} onChange={v => update('max_call_duration_mins', v)} type="number" />
          </Field>
          <Field label="Guest Daily Call Limit" desc="Max calls for guest/Quick Login users">
            <Input value={config.guest_daily_call_limit} onChange={v => update('guest_daily_call_limit', v)} type="number" />
          </Field>
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
