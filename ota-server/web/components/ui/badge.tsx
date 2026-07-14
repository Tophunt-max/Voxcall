import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', {
  variants: {
    tone: {
      channel: 'bg-primary/15 text-[#b9a8ff]',
      plat: 'bg-white/[0.06] text-slate-300',
      force: 'bg-red-500/15 text-red-300 font-bold uppercase tracking-wide',
      live: 'bg-emerald-500/15 text-emerald-300 font-semibold',
      roll: 'bg-amber-400/15 text-amber-300 font-bold',
      dev: 'bg-cyan-400/12 text-cyan-300 font-semibold',
      neutral: 'bg-white/[0.05] text-muted-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
