import * as React from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutGrid, UploadCloud, GitBranch, Download, LogOut, RefreshCw,
  Zap, Menu, X, ChevronRight, Smartphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { agoShort } from '@/lib/format';
import { useScope } from '@/scope';
import { useOtaState } from '@/lib/queries';
import type { AppId } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutGrid, section: 'overview' },
  { href: '/updates', label: 'Updates', icon: UploadCloud, section: 'deploy' },
  { href: '/channels', label: 'Channels', icon: GitBranch, section: 'deploy' },
  { href: '/downloads', label: 'Downloads', icon: Download, section: 'artifacts' },
];

const SECTIONS: Record<string, string> = {
  overview: 'OVERVIEW',
  deploy: 'DEPLOYMENTS',
  artifacts: 'ARTIFACTS',
};

const TITLES: Record<string, [string, string]> = {
  '/': ['Overview', 'Deployment status at a glance'],
  '/updates': ['Updates', 'Every published update for this app'],
  '/channels': ['Channels', 'Which update is live on each channel + runtime'],
  '/downloads': ['Downloads', 'Installable production & test builds (APK / IPA)'],
};

function useNow() {
  const [, set] = React.useState(0);
  React.useEffect(() => {
    const i = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick}>
      <div
        className={cn(
          'group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150',
          active
            ? 'bg-white/10 text-white shadow-sm'
            : 'text-white/50 hover:bg-white/5 hover:text-white/80',
        )}
      >
        <div
          className={cn(
            'rounded-lg p-1.5 transition-colors',
            active ? 'gradient-purple shadow-lg shadow-primary/30' : 'group-hover:bg-white/10',
          )}
        >
          <Icon size={15} className={active ? 'text-white' : ''} />
        </div>
        <span className="text-sm font-medium">{label}</span>
        {active && <ChevronRight size={14} className="ml-auto text-white/60" />}
      </div>
    </Link>
  );
}

function Sidebar({ onLogout, onClose }: { onLogout: () => void; onClose?: () => void }) {
  const [location] = useLocation();
  const { app, setApp } = useScope();
  let lastSection = '';

  return (
    <div className="sidebar-bg flex h-full w-64 flex-shrink-0 flex-col">
      {/* Logo */}
      <div className="border-b border-white/5 p-5">
        <div className="flex items-center gap-3">
          <div className="gradient-purple flex h-9 w-9 items-center justify-center rounded-xl shadow-lg">
            <Zap size={18} className="text-white" fill="white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-tight text-white">VoxCall OTA</p>
            <p className="text-xs font-medium text-white/40">Update Console</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="ml-auto text-white/40 hover:text-white lg:hidden">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* App scope switcher */}
      <div className="px-4 pt-4">
        <p className="px-1 pb-2 text-[10px] font-bold tracking-widest text-white/25">APP</p>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {(['user', 'host'] as AppId[]).map((a) => (
            <button
              key={a}
              onClick={() => setApp(a)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-medium capitalize transition-colors',
                app === a ? 'gradient-purple text-white shadow' : 'text-white/50 hover:text-white/80',
              )}
            >
              <Smartphone size={12} />
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV.map((item) => {
          const showLabel = item.section !== lastSection;
          lastSection = item.section;
          const active = location === item.href;
          return (
            <div key={item.href}>
              {showLabel && (
                <p className="mt-3 px-3 py-2 text-[10px] font-bold tracking-widest text-white/25 first:mt-0">
                  {SECTIONS[item.section]}
                </p>
              )}
              <NavItem
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={active}
                onClick={onClose}
              />
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/5 p-4">
        <div className="mb-1 flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-white/5">
          <div className="gradient-purple flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white">
            {app[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white capitalize">{app} app</p>
            <p className="truncate text-xs text-white/40">OTA deployments</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          <LogOut size={15} />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}

export function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const [location] = useLocation();
  const { app } = useScope();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  useNow();
  const state = useOtaState(app);

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const title = TITLES[location] ?? ['Overview', ''];
  const dotClass = state.isError ? 'bg-amber-400' : 'bg-emerald-400 pulse';
  const liveText = state.dataUpdatedAt ? 'updated ' + agoShort(state.dataUpdatedAt) : 'connecting…';

  function refreshNow() {
    qc.invalidateQueries({ queryKey: ['state', app] });
    qc.invalidateQueries({ queryKey: ['builds', app] });
    qc.invalidateQueries({ queryKey: ['metrics', app] });
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar (drawer) */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar onLogout={onLogout} onClose={() => setMobileOpen(false)} />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar onLogout={onLogout} />
      </div>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="glass sticky top-0 z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground lg:hidden"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold tracking-tight">{title[0]}</h2>
            <div className="mt-0.5 hidden truncate text-[12.5px] text-muted-foreground sm:block">
              {title[1]} · {app === 'user' ? 'User app' : 'Host app'}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', dotClass)} />
              <span className="hidden sm:inline">{liveText}</span>
            </div>
            <button
              onClick={refreshNow}
              title="Refresh now"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
            >
              <RefreshCw size={15} className={state.isFetching ? 'spin' : ''} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="fadein mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
