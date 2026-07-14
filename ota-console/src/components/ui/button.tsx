import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background,border,filter,transform] disabled:opacity-45 disabled:pointer-events-none active:translate-y-px',
  {
    variants: {
      variant: {
        default: 'grad text-white shadow-lg shadow-primary/30 hover:brightness-110',
        outline: 'border border-border bg-card hover:bg-white/[0.04]',
        ghost: 'hover:bg-white/[0.05] text-muted-foreground hover:text-foreground',
        danger: 'bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25',
        live: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 cursor-default',
      },
      size: {
        default: 'h-9 px-4 text-sm',
        sm: 'h-8 px-3 text-xs',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
