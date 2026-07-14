import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-gradient-to-b from-card to-card2 p-4 transition-colors hover:border-white/15',
        className,
      )}
      {...props}
    />
  );
}
