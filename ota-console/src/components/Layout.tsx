import * as React from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, UploadCloud, GitBranch, Download, LogOut, RefreshCw, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agoShort } from '@/lib/format';
import { useScope } from '@/scope';
import { useOtaState } from '@/lib/queries';
import type { AppId } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutGrid },
  { href: '/updates', label: 'Updates', icon: UploadCloud },
  { href: '/channels', label: 'Channels', icon: GitBranch },
  { href: '/downloads', label: 'Downloads', icon: Download },
];

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

export function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const [location] = useLocation();
  const { app, setApp } = useScope();
  const qc = useQueryClient();
  useNow();
  const state = useOtaState(app);

  const title = TITLES[location] ?? ['Overview', ''];
  const dotClass = state.isError ? 'bg-amber-400' : 'bg-emerald-400 pulse';
  const liveText = state.dataUpdatedAt ? 'updated ' + agoShort(state.dataUpdatedAt) : 'connecting…';

  function refreshNow() {
    qc.invalidateQueries({ queryKey: ['state', app] });
    qc.invalidateQueries({ queryKey: ['builds', app] });
    qc.invalidateQueries({ queryKey: ['metrics', app] });
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[250px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-1 border-r border-border bg-gradient-to-b from-card to-card2 p-3.5 md:flex">
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="grad flex h-9 w-9 items-center justify-center rounded-xl shadow-lg shadow-primary/40">
            <Zap size={18} className="text-white" fill="white" />
          </div>
          <div className="leading-tight">
            <b className="text-[15px] font-bold">VoxCall OTA</b>
            <span className="block text-[11px] text-muted-foreground">Update console</span>
          </div>
        </div>

        <div className="my-3 flex gap-1 rounded-xl border border-border bg-card2 p-1">
          {(['user', 'host'] as AppId[]).map((a) => (
            <button
              key={a}
              onClick={() => setApp(a)}
              className={cn(
                'flex-1 rounded-lg py-2 text-[12.5px] capitalize transition-colors',
                app === a ? 'grad text-white shadow' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">Menu</div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium transition-colors',
                  active
                    ? 'bg-gradient-to-r from-primary/20 to-transparent text-white before:absolute before:-left-3.5 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-[#7c5cff]'
                    : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
                )}
              >
                <Icon size={17} className={active ? 'text-[#9d7bff]' : ''} />
                {label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={onLogout}
          className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
        >
          <LogOut size={17} /> Sign out
        </button>
      </aside>

      <div className="min-w-0">
        <div className="glass sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{title[0]}</h2>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              {title[1]} · {app === 'user' ? 'User app' : 'Host app'}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', dotClass)} />
              {liveText}
            </div>
            <button
              onClick={refreshNow}
              title="Refresh now"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
            >
              <RefreshCw size={15} className={state.isFetching ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* Mobile app switcher */}
        <div className="flex gap-1 border-b border-border px-4 py-2 md:hidden">
          {(['user', 'host'] as AppId[]).map((a) => (
            <button
              key={a}
              onClick={() => setApp(a)}
              className={cn('flex-1 rounded-lg py-1.5 text-xs capitalize', app === a ? 'grad text-white' : 'bg-card text-muted-foreground')}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="fadein mx-auto max-w-5xl px-6 pb-16 pt-6">{children}</div>
      </div>
    </div>
  );
}
