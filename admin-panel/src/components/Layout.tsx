import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import { usePendingAlerts, QUEUES } from '@/lib/pendingAlerts';
import {
  LayoutDashboard, Users, Mic2, Wallet, Coins, Settings, LogOut,
  Menu, X, ChevronRight, HelpCircle, Phone, Bell, BellOff, Star,
  Hash, ArrowRightLeft, Trophy, ShieldCheck, TrendingUp, Tag,
  IndianRupee, MessageSquare, Flag, ShieldOff, Megaphone,
  ScrollText, Image, Gift, Radio, Sliders, CreditCard,
  CircleDollarSign, Zap, Ticket, Medal, Crown, Sparkles, Rocket,
  HeartPulse, ShieldAlert
} from 'lucide-react';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'main' },
  { href: '/analytics', label: 'Analytics', icon: TrendingUp, section: 'main' },
  { href: '/users', label: 'Users', icon: Users, section: 'main' },
  { href: '/hosts', label: 'Hosts', icon: Mic2, section: 'main' },
  { href: '/host-applications', label: 'KYC Applications', icon: ShieldCheck, section: 'main' },
  { href: '/ban-management', label: 'Ban Management', icon: ShieldOff, section: 'main' },
  { href: '/live-calls', label: 'Live Calls', icon: Radio, section: 'calls' },
  { href: '/calls', label: 'Call Sessions', icon: Phone, section: 'calls' },
  { href: '/ratings', label: 'Ratings', icon: Star, section: 'calls' },
  { href: '/withdrawals', label: 'Withdrawals', icon: Wallet, section: 'finance' },
  { href: '/payout-management', label: 'Payout Management', icon: IndianRupee, section: 'finance' },
  { href: '/coin-plans', label: 'Coin Plans', icon: Coins, section: 'finance' },
  { href: '/vip-plans', label: 'VIP Plans', icon: Crown, section: 'finance' },
  { href: '/gifts', label: 'Chat Gifts', icon: Gift, section: 'finance' },
  { href: '/deposits', label: 'Deposits', icon: TrendingUp, section: 'finance' },
  { href: '/transactions', label: 'Transactions', icon: ArrowRightLeft, section: 'finance' },
  { href: '/promo-codes', label: 'Promo Codes', icon: Tag, section: 'finance' },
  { href: '/payment-gateways', label: 'Payment Gateways', icon: CreditCard, section: 'finance' },
  { href: '/referral-system', label: 'Referral System', icon: Gift, section: 'growth' },
  { href: '/content-moderation', label: 'Moderation', icon: Flag, section: 'moderation' },
  { href: '/risk', label: 'Fraud / Risk', icon: ShieldAlert, section: 'moderation' },
  { href: '/support-tickets', label: 'Support Tickets', icon: MessageSquare, section: 'moderation' },
  { href: '/bulk-notifications', label: 'Bulk Notifications', icon: Megaphone, section: 'content' },
  { href: '/banners', label: 'Banners', icon: Image, section: 'content' },
  { href: '/reward-tasks', label: 'Reward Tasks', icon: Gift, section: 'content' },
  { href: '/reward-spin', label: 'Lucky Spin', icon: CircleDollarSign, section: 'content' },
  { href: '/reward-campaigns', label: 'Campaigns', icon: Zap, section: 'content' },
  { href: '/reward-coupons', label: 'Coupons', icon: Ticket, section: 'content' },
  { href: '/reward-achievements', label: 'Achievements', icon: Medal, section: 'content' },
  { href: '/notifications', label: 'Notifications', icon: Bell, section: 'content' },
  { href: '/talk-topics', label: 'Talk Topics', icon: Hash, section: 'content' },
  { href: '/faqs', label: 'FAQs', icon: HelpCircle, section: 'content' },
  { href: '/audit-logs', label: 'Audit Logs', icon: ScrollText, section: 'system' },
  { href: '/level-config', label: 'Level System', icon: Trophy, section: 'system' },
  { href: '/app-config', label: 'App Config', icon: Sliders, section: 'system' },
  { href: '/engagement', label: 'Engagement', icon: Sparkles, section: 'system' },
  { href: '/growth', label: 'Growth & Promotions', icon: Rocket, section: 'system' },
  { href: '/health', label: 'Health Monitor', icon: HeartPulse, section: 'system' },
  { href: '/settings', label: 'Settings', icon: Settings, section: 'system' },
];

const sections: Record<string, string> = {
  main: 'OVERVIEW',
  calls: 'CALLS',
  finance: 'FINANCE',
  growth: 'GROWTH',
  moderation: 'MODERATION',
  content: 'CONTENT',
  system: 'SYSTEM',
};

function NavItem({ href, label, icon: Icon, active, onClick, badge }: any) {
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <Link href={href} onClick={onClick}>
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer group ${
        active
          ? 'bg-white/10 text-white shadow-sm'
          : 'text-white/50 hover:bg-white/5 hover:text-white/80'
      }`}>
        <div className={`relative p-1.5 rounded-lg transition-colors ${active ? 'bg-violet-500' : 'group-hover:bg-white/10'}`}>
          <Icon size={15} className={active ? 'text-white' : ''} />
          {showBadge && (
            <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[#1a1625] animate-pulse" />
          )}
        </div>
        <span className="text-sm font-medium">{label}</span>
        {showBadge ? (
          <span className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-bold leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : (
          active && <ChevronRight size={14} className="ml-auto text-white/60" />
        )}
      </div>
    </Link>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const [loc] = useLocation();
  const { user, logout } = useAuth();
  const { counts } = usePendingAlerts();
  const badges: Record<string, number> = Object.fromEntries(
    QUEUES.map((q) => [q.route, counts[q.key]]),
  );
  let lastSection = '';

  return (
    <div className="sidebar-bg flex flex-col h-full w-64 flex-shrink-0">
      {/* Logo */}
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl gradient-purple flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-base">V</span>
          </div>
          <div>
            <p className="font-bold text-white text-sm tracking-tight">VoxLink</p>
            <p className="text-xs text-white/40 font-medium">Admin Console</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="ml-auto text-white/40 hover:text-white lg:hidden">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 overflow-y-auto space-y-0.5">
        {nav.map(item => {
          const showLabel = item.section !== lastSection;
          lastSection = item.section;
          const active = loc.startsWith(item.href);
          return (
            <div key={item.href}>
              {showLabel && (
                <p className="text-white/25 text-[10px] font-bold tracking-widest px-3 py-2 mt-3 first:mt-0">
                  {sections[item.section]}
                </p>
              )}
              <NavItem {...item} active={active} onClick={onClose} badge={badges[item.href]} />
            </div>
          );
        })}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors mb-1">
          <div className="w-8 h-8 rounded-lg gradient-purple flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {user?.name?.[0] || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">{user?.name}</p>
            <p className="text-white/40 text-xs truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-xl transition-colors font-medium"
        >
          <LogOut size={15} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentPage = nav.find(n => loc.startsWith(n.href));
  const { counts, total, soundEnabled, setSoundEnabled, testRing, acknowledge } = usePendingAlerts();

  // The queue with the most pending items — the header pill links here.
  const busiestQueue = QUEUES.reduce(
    (best, q) => (counts[q.key] > counts[best.key] ? q : best),
    QUEUES[0],
  );

  // Opening any actionable queue silences the repeating ring.
  useEffect(() => {
    if (QUEUES.some((q) => loc.startsWith(q.route))) acknowledge();
  }, [loc, acknowledge]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) testRing(); // audible confirmation + unlocks the AudioContext via user gesture
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile sidebar */}
      <div className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar onClose={() => setMobileOpen(false)} />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-card border-b border-border flex items-center px-5 gap-4 flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden relative p-2 rounded-lg hover:bg-secondary transition-colors"
          >
            <Menu size={18} />
            {total > 0 && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-card animate-pulse" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base text-foreground">{currentPage?.label || 'Dashboard'}</h1>
            <p className="text-xs text-muted-foreground hidden sm:block">VoxLink Admin Console</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Pending action queue pill */}
            {total > 0 && (
              <Link href={busiestQueue.route}>
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-red-500/10 text-red-600 border border-red-500/20 cursor-pointer hover:bg-red-500/15 transition-colors"
                  title={QUEUES.filter((q) => counts[q.key] > 0).map((q) => `${counts[q.key]} ${q.label}${counts[q.key] > 1 ? 's' : ''}`).join(', ')}
                >
                  <Bell size={14} className="animate-pulse" />
                  <span className="text-xs font-bold">{total} pending</span>
                </div>
              </Link>
            )}
            {/* Sound alert toggle */}
            <button
              onClick={toggleSound}
              title={soundEnabled ? 'Alert sound on — click to mute' : 'Alert sound off — click to enable'}
              className={`p-2 rounded-lg transition-colors ${
                soundEnabled ? 'text-violet-600 hover:bg-secondary' : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              {soundEnabled ? <Bell size={16} /> : <BellOff size={16} />}
            </button>
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">System Operational</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-5 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
