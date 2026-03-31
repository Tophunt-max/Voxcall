import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import {
  LayoutDashboard, Users, Mic2, Wallet, Coins, Settings, LogOut, Menu, X, ChevronRight
} from 'lucide-react';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/hosts', label: 'Hosts', icon: Mic2 },
  { href: '/withdrawals', label: 'Withdrawals', icon: Wallet },
  { href: '/coin-plans', label: 'Coin Plans', icon: Coins },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const Sidebar = () => (
    <aside className="flex flex-col h-full bg-card border-r border-border">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-sm">V</span>
          </div>
          <div>
            <p className="font-bold text-sm">VoxLink</p>
            <p className="text-xs text-muted-foreground">Admin Panel</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = loc.startsWith(href);
          return (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-foreground'}`}>
                <Icon size={18} />
                <span className="text-sm font-medium">{label}</span>
                {active && <ChevronRight size={14} className="ml-auto" />}
              </div>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-primary text-sm font-bold">{user?.name?.[0] || 'A'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
          <LogOut size={16} /><span>Logout</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setOpen(false)} />}
      {/* Mobile sidebar */}
      <div className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform lg:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar />
      </div>
      {/* Desktop sidebar */}
      <div className="hidden lg:flex w-64 flex-shrink-0"><div className="w-full"><Sidebar /></div></div>
      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-border bg-card flex items-center px-4 gap-4">
          <button className="lg:hidden" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <h1 className="font-semibold text-sm">{nav.find(n => loc.startsWith(n.href))?.label || 'VoxLink Admin'}</h1>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
