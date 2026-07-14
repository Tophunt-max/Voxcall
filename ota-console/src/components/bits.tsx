import { Smartphone } from 'lucide-react';
import { Badge } from './ui/badge';
import type { UpdateSummary } from '@/lib/api';

export function StatCard({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-card to-card2 p-4 transition-transform hover:-translate-y-0.5">
      <div className="grad absolute inset-x-0 top-0 h-0.5 opacity-60" />
      <div className="text-[28px] font-extrabold tracking-tight">{n}</div>
      <div className="mt-1 text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
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
