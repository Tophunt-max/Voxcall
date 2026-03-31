import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Save, Info } from 'lucide-react';

const settingGroups = [
  {
    group: 'General',
    settings: [
      { key: 'app_name', label: 'App Name', type: 'text', hint: 'Name displayed in the mobile app' },
      { key: 'app_version', label: 'App Version', type: 'text', hint: 'Current version string (e.g. 1.0.0)' },
    ]
  },
  {
    group: 'Economy',
    settings: [
      { key: 'coin_to_usd_rate', label: 'Coin → USD Rate', type: 'number', hint: '0.01 means 100 coins = $1.00', step: '0.001' },
      { key: 'host_revenue_share', label: 'Host Revenue Share', type: 'number', hint: '0.70 means hosts receive 70% of earned coins', step: '0.01' },
      { key: 'min_withdrawal_coins', label: 'Minimum Withdrawal (Coins)', type: 'number', hint: 'Minimum coins a host must have to request a payout' },
    ]
  },
  {
    group: 'Random Call Rates',
    settings: [
      { key: 'random_call_audio_rate', label: 'Audio Call Rate (Coins/min)', type: 'number', hint: 'Coins deducted per minute for random Voice calls — overrides individual host rates', step: '1' },
      { key: 'random_call_video_rate', label: 'Video Call Rate (Coins/min)', type: 'number', hint: 'Coins deducted per minute for random Video calls — overrides individual host rates', step: '1' },
    ]
  },
];

const DEFAULTS: Record<string, string> = {
  coin_to_usd_rate: '0.01',
  host_revenue_share: '0.70',
  min_withdrawal_coins: '100',
  app_name: 'VoxLink',
  app_version: '1.0.0',
  random_call_audio_rate: '5',
  random_call_video_rate: '8',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.settings().then(d => setSettings({ ...DEFAULTS, ...d })).finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 2500); };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      showToast('Settings saved successfully', true);
    } catch (e: any) {
      showToast('Error: ' + e.message, false);
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 text-white text-sm px-4 py-2.5 rounded-xl shadow-xl ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">App Settings</h2>
          <p className="text-sm text-muted-foreground">Configure platform-wide settings</p>
        </div>
        <button
          onClick={save} disabled={saving}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 shadow-sm"
        >
          <Save size={15} /> {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {settingGroups.map(group => (
        <div key={group.group} className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-secondary/30">
            <h3 className="font-bold text-sm">{group.group}</h3>
          </div>
          <div className="divide-y divide-border">
            {group.settings.map(s => (
              <div key={s.key} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{s.label}</p>
                  {s.hint && (
                    <div className="flex items-start gap-1 mt-0.5">
                      <Info size={11} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">{s.hint}</p>
                    </div>
                  )}
                </div>
                <input
                  type={s.type}
                  step={(s as any).step}
                  value={settings[s.key] || ''}
                  onChange={e => setSettings(prev => ({ ...prev, [s.key]: e.target.value }))}
                  className="w-full sm:w-48 border border-border rounded-xl px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Computed values display */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-4">Computed Values</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: '100 coins =', value: `$${(100 * parseFloat(settings.coin_to_usd_rate || '0.01')).toFixed(2)}` },
            { label: 'Host gets (per 100 coins)', value: `$${(100 * parseFloat(settings.coin_to_usd_rate || '0.01') * parseFloat(settings.host_revenue_share || '0.70')).toFixed(2)}` },
            { label: 'Min withdrawal =', value: `$${(parseInt(settings.min_withdrawal_coins || '100') * parseFloat(settings.coin_to_usd_rate || '0.01') * parseFloat(settings.host_revenue_share || '0.70')).toFixed(2)}` },
          ].map(c => (
            <div key={c.label} className="bg-secondary/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="font-bold text-lg mt-0.5">{c.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Random call rate preview */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-1">Random Call — User Cost Preview</h3>
        <p className="text-xs text-muted-foreground mb-4">Kitne coins katenge agar user itni der baat kare</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 5, 10, 30].map(mins => {
            const audioCoins = parseInt(settings.random_call_audio_rate || '5') * mins;
            const videoCoins = parseInt(settings.random_call_video_rate || '8') * mins;
            return (
              <div key={mins} className="bg-secondary/50 rounded-xl p-3 text-center">
                <p className="text-xs text-muted-foreground font-medium">{mins} min</p>
                <p className="font-bold text-base mt-1 text-primary">🎤 {audioCoins} coins</p>
                <p className="font-bold text-base text-purple-600">🎥 {videoCoins} coins</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
