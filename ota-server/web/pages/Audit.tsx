import { useScope } from '@/scope';
import { useAudit } from '@/lib/queries';
import { rel } from '@/lib/format';
import type { AuditEntry } from '@/lib/api';
import { Spinner } from '@/components/bits';
import { Badge } from '@/components/ui/badge';
import { Rocket, Undo2, Percent, ShieldAlert, PackagePlus, Trash2, ShieldOff, ScrollText } from 'lucide-react';

const ACTION_META: Record<string, { label: string; tone: Parameters<typeof Badge>[0]['tone']; icon: typeof Rocket }> = {
  promote: { label: 'Promote', tone: 'live', icon: Rocket },
  rollback: { label: 'Rollback', tone: 'force', icon: Undo2 },
  'auto-rollback': { label: 'Auto-rollback', tone: 'force', icon: ShieldAlert },
  rollout: { label: 'Rollout', tone: 'roll', icon: Percent },
  force: { label: 'Mandatory', tone: 'force', icon: ShieldOff },
  'build.add': { label: 'Build added', tone: 'channel', icon: PackagePlus },
  'build.delete': { label: 'Build deleted', tone: 'neutral', icon: Trash2 },
};

function summarize(e: AuditEntry): string {
  const d = e.detail || {};
  const parts: string[] = [];
  if (typeof d.channel === 'string') parts.push(`channel ${d.channel}`);
  if (typeof d.updateId === 'string') parts.push(`update ${String(d.updateId).slice(0, 8)}`);
  if (typeof d.rollout === 'number') parts.push(`${d.rollout}%`);
  if (typeof d.force === 'boolean') parts.push(d.force ? 'on' : 'off');
  if (typeof d.platform === 'string') parts.push(String(d.platform));
  if (typeof d.version === 'string' && d.version) parts.push(`v${d.version}`);
  if (Array.isArray(d.channels)) parts.push(`→ ${d.channels.join(', ')}`);
  return parts.join(' · ');
}

export function Audit() {
  const { app } = useScope();
  const q = useAudit(app);

  if (q.isLoading) return <Spinner />;
  const entries = q.data?.entries ?? [];

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <ScrollText className="mx-auto mb-2 text-muted-foreground" size={22} />
        <div className="text-sm font-medium">No activity yet</div>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Promotes, rollbacks, rollout changes and builds will show up here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-b from-card to-card2">
      <table className="w-full">
        <tbody>
          {entries.map((e, i) => {
            const meta = ACTION_META[e.action] ?? { label: e.action, tone: 'neutral' as const, icon: ScrollText };
            const Icon = meta.icon;
            return (
              <tr key={e.ts + i} className="border-t border-border first:border-t-0">
                <td className="py-3 pl-4 pr-2 align-top">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-muted-foreground">
                    <Icon size={14} />
                  </div>
                </td>
                <td className="py-3 pr-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="text-[12.5px] text-muted-foreground">{summarize(e)}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap py-3 pr-4 text-right align-top">
                  <div className="text-xs text-muted-foreground">{rel(e.ts)}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">{e.actor}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
