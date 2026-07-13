import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { StatCard } from '@/components/ui/StatCard';
import { Gift, Users, Coins, TrendingUp, Crown, Settings2, ShieldAlert, Lock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

function UserAvatar({ name }: { name: string }) {
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-pink-500'];
  const c = colors[(name || 'U').charCodeAt(0) % colors.length];
  return <div className={`w-8 h-8 rounded-full ${c} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>{(name || 'U')[0]}</div>;
}

export default function ReferralSystem() {
  const [topReferrers, setTopReferrers] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, this_month: 0, coins_distributed: 0 });
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<any>({
    referrer_reward: 100, new_user_reward: 50, min_calls_to_unlock: 1, active: true,
    integrity_enabled: true, hold_days: 7, daily_unlock_cap: 25, total_cap: 0,
    clawback_days: 14, risk_review_enabled: true,
  });
  const [configLoading, setConfigLoading] = useState(false);
  // Anti-fraud review queue.
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);
  const [queueStats, setQueueStats] = useState({ in_review: 0, unlocked: 0, voided: 0, pending: 0, coins_on_hold: 0, coins_paid_referrers: 0 });
  const [queueLoading, setQueueLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const loadQueue = () => {
    setQueueLoading(true);
    Promise.all([
      api.referralQueue('review').then(setReviewQueue).catch(() => setReviewQueue([])),
      api.referralQueueStats().then(setQueueStats).catch(() => {}),
    ]).finally(() => setQueueLoading(false));
  };

  useEffect(() => {
    api.referrals().then((data: any) => {
      setTopReferrers(data.top || []);
      setRecentActivity(data.recent || []);
      setStats(data.stats || { total: 0, this_month: 0, coins_distributed: 0 });
    }).catch(() => toast.error('Failed to load referral data')).finally(() => setLoading(false));

    api.referralConfig().then((cfg: any) => setConfig((prev: any) => ({ ...prev, ...cfg }))).catch(() => toast.error('Failed to load referral config'));
    loadQueue();
  }, []);

  const actOnReferral = async (id: string, action: 'approve' | 'reject') => {
    setActing(id);
    try {
      await api.actOnReferral(id, { action });
      toast.success(action === 'approve' ? 'Referral approved & credited' : 'Referral rejected');
      loadQueue();
    } catch (e: any) {
      toast.error(e?.message || `Failed to ${action}`);
    } finally {
      setActing(null);
    }
  };

  const reviewCols = [
    {
      key: 'referrer', header: 'Referrer',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={r.referrer_name || 'U'} />
          <div>
            <p className="font-semibold text-sm">{r.referrer_name || '—'}</p>
            <p className="text-xs text-muted-foreground">{r.referrer_email || ''}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'referred', header: 'Referred User',
      render: (r: any) => (
        <div>
          <p className="text-sm">{r.referred_name || '—'}</p>
          <p className="text-xs text-muted-foreground">{r.referred_email || ''}</p>
        </div>
      ),
    },
    {
      key: 'flag_reason', header: 'Flagged For',
      render: (r: any) => (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-amber-700 bg-amber-100">
          {r.flag_reason === 'daily_cap' ? 'Velocity cap' : r.flag_reason === 'total_cap' ? 'Total cap' : r.flag_reason === 'high_risk' ? 'High risk' : (r.flag_reason || 'review')}
        </span>
      ),
    },
    {
      key: 'reward', header: 'Reward',
      render: (r: any) => <div className="flex items-center gap-1 text-amber-600 font-semibold text-sm"><Coins size={12} />{r.referrer_reward || 0}</div>,
    },
    {
      key: 'actions', header: 'Action',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <button disabled={acting === r.id} onClick={() => actOnReferral(r.id, 'approve')}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-600 text-white hover:opacity-90 disabled:opacity-50">Approve</button>
          <button disabled={acting === r.id} onClick={() => actOnReferral(r.id, 'reject')}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500 text-white hover:opacity-90 disabled:opacity-50">Reject</button>
        </div>
      ),
    },
  ];

  const saveConfig = async () => {
    setConfigLoading(true);
    try {
      await api.updateReferralConfig(config);
      toast.success('Configuration saved');
      setConfigOpen(false);
    } catch { toast.error('Failed to save config'); }
    finally { setConfigLoading(false); }
  };

  const topCols = [
    {
      key: 'rank', header: '#',
      render: (r: any) => {
        const i = topReferrers.indexOf(r);
        return (
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-amber-400 text-white' : 'bg-secondary text-muted-foreground'}`}>
            {i < 3 ? <Crown size={11} /> : i + 1}
          </div>
        );
      }
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
          <Coins size={13} />{(r.coins_earned || 0).toLocaleString()}
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
    { key: 'joined_at', header: 'Joined', render: (r: any) => <span className="text-xs text-muted-foreground">{r.joined_at || '—'}</span> },
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
        <StatCard icon={Users} label="Total Referrals" value={stats.total.toString()} gradient="gradient-purple" />
        <StatCard icon={Gift} label="This Month" value={stats.this_month.toString()} gradient="gradient-blue" />
        <StatCard icon={Coins} label="Coins Distributed" value={stats.coins_distributed.toLocaleString()} gradient="gradient-orange" />
        <StatCard icon={TrendingUp} label="Active Referrers" value={topReferrers.length.toString()} gradient="gradient-green" />
      </div>

      {/* Anti-fraud snapshot */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={ShieldAlert} label="Awaiting Review" value={queueStats.in_review.toString()} gradient="gradient-orange" />
        <StatCard icon={Lock} label="Coins On Hold" value={(queueStats.coins_on_hold || 0).toLocaleString()} gradient="gradient-purple" />
        <StatCard icon={Coins} label="Paid To Referrers" value={(queueStats.coins_paid_referrers || 0).toLocaleString()} gradient="gradient-blue" />
        <StatCard icon={Users} label="Voided (fraud)" value={queueStats.voided.toString()} gradient="gradient-green" />
      </div>

      {/* Review queue — genuine referrals held for a human decision */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert size={16} className="text-amber-500" />
          <h3 className="font-bold text-base">Review Queue</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Genuine referrals flagged by the anti-fraud engine (velocity cap or high risk). Approve to credit the referrer (with the payout hold), or reject to void.
        </p>
        <Table columns={reviewCols} data={reviewQueue} loading={queueLoading} empty="Nothing to review — no referrals are currently flagged. ✅" keyFn={r => r.id} />
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold text-base mb-4">Top Referrers — All Time</h3>
        <Table columns={topCols} data={topReferrers} loading={loading} empty="No referrers yet. When users refer others through unique codes, they'll appear here." keyFn={r => r.id} />
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold text-base mb-4">Recent Referral Activity</h3>
        <Table columns={recentCols} data={recentActivity} loading={loading} empty="No recent activity" keyFn={r => r.id} />
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
            <p className="text-xs text-muted-foreground mt-1">Reward credited after referred user completes this many PAID calls (a recharge or KYC-approved host also unlocks it)</p>
          </div>

          {/* Anti-fraud integrity settings */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert size={15} className="text-amber-500" />
              <span className="text-sm font-bold">Anti-Fraud Integrity</span>
            </div>
            <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl mb-3">
              <button onClick={() => setConfig({ ...config, integrity_enabled: !config.integrity_enabled })}
                className={`relative w-10 h-5 rounded-full transition-colors ${config.integrity_enabled ? 'bg-primary' : 'bg-border'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.integrity_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm font-medium">Payout hold, velocity caps & clawback {config.integrity_enabled ? 'ON' : 'OFF'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold block mb-1.5">Payout hold (days)</label>
                <input type="number" min="0" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                  value={config.hold_days} onChange={e => setConfig({ ...config, hold_days: parseInt(e.target.value) })} />
                <p className="text-xs text-muted-foreground mt-1">Referrer reward locked (non-withdrawable) for this long. 0 = instant.</p>
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1.5">Clawback window (days)</label>
                <input type="number" min="0" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                  value={config.clawback_days} onChange={e => setConfig({ ...config, clawback_days: parseInt(e.target.value) })} />
                <p className="text-xs text-muted-foreground mt-1">Reverse held rewards if referred user is banned in this window.</p>
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1.5">Daily auto-unlock cap</label>
                <input type="number" min="0" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                  value={config.daily_unlock_cap} onChange={e => setConfig({ ...config, daily_unlock_cap: parseInt(e.target.value) })} />
                <p className="text-xs text-muted-foreground mt-1">Per referrer / 24h. Beyond it → review queue. 0 = unlimited.</p>
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1.5">Lifetime auto-unlock cap</label>
                <input type="number" min="0" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none"
                  value={config.total_cap} onChange={e => setConfig({ ...config, total_cap: parseInt(e.target.value) })} />
                <p className="text-xs text-muted-foreground mt-1">0 = unlimited.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl mt-3">
              <button onClick={() => setConfig({ ...config, risk_review_enabled: !config.risk_review_enabled })}
                className={`relative w-10 h-5 rounded-full transition-colors ${config.risk_review_enabled ? 'bg-primary' : 'bg-border'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.risk_review_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm font-medium">Route high-risk referred accounts to review</span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
            <button onClick={() => setConfig({ ...config, active: !config.active })}
              className={`relative w-10 h-5 rounded-full transition-colors ${config.active ? 'bg-primary' : 'bg-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-sm font-medium">Referral program {config.active ? 'enabled' : 'disabled'}</span>
          </div>
          <button onClick={saveConfig} disabled={configLoading}
            className="w-full bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            {configLoading ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
