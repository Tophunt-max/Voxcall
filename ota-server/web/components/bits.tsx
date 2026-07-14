import { Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import type { UpdateSummary } from '@/lib/api';

type StatTone = 'purple' | 'blue' | 'green' | 'orange' | 'cyan' | 'red';

const TONE_GRADIENT: Record<StatTone, string> = {
  purple: 'gradient-purple',
  blue: 'gradient-blue',
  green: 'gradient-green',
  orange: 'gradient-orange',
  cyan: 'gradient-cyan',
  red: 'gradient-red',
};

export function StatCard({
  n,
  label,
  icon: Icon,
  tone = 'purple',
}: {
  n: number | string;
  label: string;
  icon?: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-card2 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[28px] font-extrabold leading-none tracking-tight">{n}</div>
          <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
        {Icon && (
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-lg', TONE_GRADIENT[tone])}>
            <Icon size={17} />
          </div>
        )}
      </div>
    </div>
  );
}

export function RolloutBadge({ pct }: { pct: number | null | undefined }) {
  if (pct == null || pct >= 100) return null;
  return <Badge tone="roll" title="Staged rollout">{pct}%</Badge>;
}

export function UpdateBadges({ u, dc }: { u: UpdateSummary; dc: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {u.platforms.map((p) => (
        <Badge key={p} tone="plat"><Smartphone size={10} /> {p}</Badge>
      ))}
      {u.forceUpdate && <Badge tone="force">mandatory</Badge>}
      {u.liveOn.map((l) => <Badge key={l} tone="live">live · {l}</Badge>)}
      {dc > 0 && <Badge tone="dev">{dc} dev{dc === 1 ? '' : 's'}</Badge>}
    </div>
  );
}

export function Spinner() {
  return <div className="spin mx-auto my-12 h-6 w-6 rounded-full border-[2.5px] border-primary border-t-transparent" />;
}
