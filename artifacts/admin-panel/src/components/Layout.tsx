import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import {
  LayoutDashboard, Users, Mic2, Wallet, Coins, Settings, LogOut,
  Menu, X, ChevronRight, HelpCircle, Phone, Bell, Star,
  Hash, ArrowRightLeft, Trophy, ShieldCheck
} from 'lucide-react';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'main' },
  { href: '/users', label: 'Users', icon: Users, section: 'main' },
  { href: '/hosts', label: 'Hosts', icon: Mic2, section: 'main' },
  { href: '/host-applications', label: 'KYC Applications', icon: ShieldCheck, section: 'main' },
  { href: '/calls', label: 'Call Sessions', icon: Phone, section: 'main' },
  { href: '/ratings', label: 'Ratings', icon: Star, section: 'main' },
  { href: '/withdrawals', label: 'Withdrawals', icon: Wallet, section: 'finance' },
  { href: '/coin-plans', label: 'Coin Plans', icon: Coins, section: 'finance' },
  { href: '/transactions', label: 'Transactions', icon: ArrowRightLeft, section: 'finance' },
  { href: '/notifications', label: 'Notifications', icon: Bell, section: 'content' },
  { href: '/talk-topics', label: 'Talk Topics', icon: Hash, section: 'content' },
  { href: '/faqs', label: 'FAQs', icon: HelpCircle, section: 'content' },
  { href: '/level-config', label: 'Level System', icon: Trophy, section: 'system' },
  { href: '/settings', label: 'Settings', icon: Settings, section: 'system' },
];

const sections: Record<string, string> = { main: 'OVERVIEW', finance: 'FINANCE', content: 'CONTENT', system: 'SYSTEM' };

function NavItem({ href, label, icon: Icon, active, onClick }: any) {
  return (
    <Link href={href} onClick={onClick}>
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer group ${
        active
          ? 'bg-white/10 text-white shadow-sm'
          : 'text-white/50 hover:bg-white/5 hover:text-white/80'
      }`}>
        <div className={`p-1.5 rounded-lg transition-colors ${active ? 'bg-violet-500' : 'group-hover:bg-white/10'}`}>
          <Icon size={15} className={active ? 'text-white' : ''} />
        </div>
        <span className="text-sm font-medium">{label}</span>
        {active && <ChevronRight size={14} className="ml-auto text-white/60" />}
      </div>
    </Link>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const [loc] = useLocation();
  const { user, logout } = useAuth();
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
              <NavItem {...item} active={active} onClick={onClose} />
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
            className="lg:hidden p-2 rounded-lg hover:bg-secondary transition-colors"
          >
            <Menu size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base text-foreground">{currentPage?.label || 'Dashboard'}</h1>
            <p className="text-xs text-muted-foreground hidden sm:block">VoxLink Admin Console</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-muted-foreground hidden sm:block">System Operational</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-5 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
