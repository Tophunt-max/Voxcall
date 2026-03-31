import { useState } from 'react';
import { Table } from '@/components/ui/Table';
import { StatCard } from '@/components/ui/StatCard';
import { Gift, Users, Coins, TrendingUp, Crown, Settings2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

const MOCK_REFERRALS = [
  { id: '1', referrer: 'Rahul Verma', referrer_email: 'rahul@ex.com', referred_count: 24, coins_earned: 2400, this_month: 8, status: 'active' },
  { id: '2', referrer: 'Priya S.', referrer_email: 'priya@ex.com', referred_count: 18, coins_earned: 1800, this_month: 5, status: 'active' },
  { id: '3', referrer: 'Arun Patel', referrer_email: 'arun@ex.com', referred_count: 15, coins_earned: 1500, this_month: 3, status: 'active' },
  { id: '4', referrer: 'Kavya N.', referrer_email: 'kavya@ex.com', referred_count: 12, coins_earned: 1200, this_month: 6, status: 'active' },
  { id: '5', referrer: 'Sunita R.', referrer_email: 'sunita@ex.com', referred_count: 9, coins_earned: 900, this_month: 2, status: 'active' },
  { id: '6', referrer: 'Vikram S.', referrer_email: 'vikram@ex.com', referred_count: 7, coins_earned: 700, this_month: 1, status: 'active' },
];

const MOCK_RECENT = [
  { id: 'r1', referrer: 'Rahul Verma', new_user: 'Ankit S.', joined_at: '2026-03-31', coins_given: 100, status: 'credited' },
  { id: 'r2', referrer: 'Kavya N.', new_user: 'Pooja M.', joined_at: '2026-03-30', coins_given: 100, status: 'credited' },
  { id: 'r3', referrer: 'Priya S.', new_user: 'Ravi K.', joined_at: '2026-03-29', coins_given: 100, status: 'credited' },
  { id: 'r4', referrer: 'Arun P.', new_user: 'Shweta D.', joined_at: '2026-03-28', coins_given: 100, status: 'pending' },
];

function UserAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500'];
  const c = colors[name.charCodeAt(0) % colors.length];
  return <div className={`w-8 h-8 rounded-full ${c} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>{name[0]}</div>;
}

export default function ReferralSystem() {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState({ referrer_reward: 100, new_user_reward: 50, min_calls_to_unlock: 1, active: true });
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const topCols = [
    {
      key: 'rank', header: '#',
      render: (_: any, i: number) => (
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-amber-400 text-white' : 'bg-secondary text-muted-foreground'}`}>
          {i < 3 ? <Crown size={11} /> : i + 1}
        </div>
      )
    },
    {
      key: 'referrer', header: 'Referrer',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={r.referrer} />
          <div>
            <p className="font-semibold text-sm">{r.referrer}</p>
            <p className="text-xs text-muted-foreground">{r.referrer_email}</p>
          </div>
        </div>
      )
    },
    { key: 'referred_count', header: 'Total Referred', render: (r: any) => <span className="font-bold text-sm">{r.referred_count}</span> },
    { key: 'this_month', header: 'This Month', render: (r: any) => <span className="text-sm text-violet-600 font-semibold">{r.this_month}</span> },
    {
      key: 'coins_earned', header: 'Coins Earned',
      render: (r: any) => (
        <div className="flex items-center gap-1 text-amber-600 font-bold text-sm">
          <Coins size={13} />{r.coins_earned.toLocaleString()}
        </div>
      )
    },
  ];

  const recentCols = [
    {
      key: 'new_user', header: 'New User',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={r.new_user} />
          <span className="font-semibold text-sm">{r.new_user}</span>
        </div>
      )
    },
    { key: 'referrer', header: 'Referred By', render: (r: any) => <span className="text-sm">{r.referrer}</span> },
    { key: 'joined_at', header: 'Joined', render: (r: any) => <span className="text-xs text-muted-foreground">{r.joined_at}</span> },
    {
      key: 'coins_given', header: 'Reward',
      render: (r: any) => <div className="flex items-center gap-1 text-amber-600 font-semibold text-sm"><Coins size={12} />{r.coins_given}</div>
    },
    {
      key: 'status', header: 'Status',
      render: (r: any) => (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.status === 'credited' ? 'text-green-600 bg-green-100' : 'text-amber-600 bg-amber-100'}`}>
          {r.status}
        </span>
      )
    },
  ];

  return (
    <div className="space-y-6">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Referral System</h2>
          <p className="text-sm text-muted-foreground">Track and manage user referrals</p>
        </div>
        <button onClick={() => setConfigOpen(true)}
          className="flex items-center gap-1.5 border border-border px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-secondary transition-colors">
          <Settings2 size={15} /> Configure
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Referrals" value="85" gradient="gradient-purple" />
        <StatCard icon={Gift} label="This Month" value="25" gradient="gradient-blue" />
        <StatCard icon={Coins} label="Coins Distributed" value="8,500" gradient="gradient-orange" />
        <StatCard icon={TrendingUp} label="Conversion Rate" value="34%" gradient="gradient-green" />
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold text-base mb-4">Top Referrers — All Time</h3>
        <Table columns={topCols} data={MOCK_REFERRALS} loading={false} empty="No referrers yet" keyFn={r => r.id} />
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold text-base mb-4">Recent Referral Activity</h3>
        <Table columns={recentCols} data={MOCK_RECENT} loading={false} empty="No recent activity" keyFn={r => r.id} />
      </div>

      <Modal open={configOpen} onClose={() => setConfigOpen(false)} title="Referral Configuration">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Referrer Reward (coins)</label>
              <input type="number" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                value={config.referrer_reward} onChange={e => setConfig({ ...config, referrer_reward: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">New User Reward (coins)</label>
              <input type="number" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                value={config.new_user_reward} onChange={e => setConfig({ ...config, new_user_reward: parseInt(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1.5">Min. calls before reward unlocks</label>
            <input type="number" min="0" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
              value={config.min_calls_to_unlock} onChange={e => setConfig({ ...config, min_calls_to_unlock: parseInt(e.target.value) })} />
            <p className="text-xs text-muted-foreground mt-1">Reward credited after referred user completes this many calls</p>
          </div>
          <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
            <button onClick={() => setConfig({ ...config, active: !config.active })}
              className={`relative w-10 h-5 rounded-full transition-colors ${config.active ? 'bg-primary' : 'bg-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-sm font-medium">Referral program {config.active ? 'enabled' : 'disabled'}</span>
          </div>
          <button onClick={() => { showToast('Configuration saved'); setConfigOpen(false); }}
            className="w-full bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90">
            Save Configuration
          </button>
        </div>
      </Modal>
    </div>
  );
}
