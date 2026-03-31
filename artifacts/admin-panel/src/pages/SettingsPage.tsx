import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const DEFAULTS = {
  coin_to_usd_rate: '0.01',
  host_revenue_share: '0.70',
  min_withdrawal_coins: '100',
  app_name: 'VoxLink',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings().then(d => setSettings({ ...DEFAULTS, ...d })).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    await api.updateSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">App Settings</h2>
        <button onClick={save} className="bg-primary text-primary-foreground px-4 py-1.5 rounded-lg text-sm font-semibold hover:opacity-90">
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 max-w-lg space-y-5">
        {[
          { key: 'app_name', label: 'App Name', type: 'text' },
          { key: 'coin_to_usd_rate', label: 'Coin → USD Rate', type: 'number', hint: 'e.g. 0.01 means 100 coins = $1' },
          { key: 'host_revenue_share', label: 'Host Revenue Share', type: 'number', hint: 'e.g. 0.70 means hosts get 70%' },
          { key: 'min_withdrawal_coins', label: 'Minimum Withdrawal (Coins)', type: 'number' },
        ].map(({ key, label, type, hint }) => (
          <div key={key}>
            <label className="text-sm font-medium block mb-1.5">{label}</label>
            {hint && <p className="text-xs text-muted-foreground mb-1.5">{hint}</p>}
            <input
              type={type} value={settings[key] || ''} onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
